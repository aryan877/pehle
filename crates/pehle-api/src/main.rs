//! Pehle API server.
//!
//! ```text
//! pehle-api            run migrations, then serve HTTP and the background workers
//! pehle-api openapi    print the OpenAPI document (used to generate the TypeScript client)
//! pehle-api migrate    run migrations and exit
//! pehle-api vapid-keys print a new Web Push key for PEHLE_VAPID_PRIVATE_KEY
//! ```

mod auth;
mod cards;
mod cohost;
mod config;
mod demo;
mod error;
mod firebase;
mod intent;
mod money;
mod payments;
mod privacy;
mod push;
mod routes;
mod state;
mod workers;
mod youtube;

use anyhow::Context;
use pehle_db::Db;
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::AppState;

fn main() -> anyhow::Result<()> {
    let command = std::env::args().nth(1).unwrap_or_else(|| "serve".into());
    if command == "openapi" {
        println!("{}", routes::openapi().to_pretty_json()?);
        return Ok(());
    }
    if command == "vapid-keys" {
        println!("PEHLE_VAPID_PRIVATE_KEY={}", push::Vapid::generate_pkcs8()?);
        return Ok(());
    }
    // Load .env before the runtime starts any threads.
    let _ = dotenvy::dotenv();
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(run(command))
}

async fn run(command: String) -> anyhow::Result<()> {
    let json_logs = std::env::var("PEHLE_LOG_JSON").is_ok_and(|v| v == "1");
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));
    if json_logs {
        tracing_subscriber::fmt().with_env_filter(filter).json().init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).compact().init();
    }

    let config = Config::from_env()?;
    // Connecting runs migrations as the owner, then every pooled connection acts as pehle_api.
    let db = Db::connect(&config.database_url, 20).await.context("connect to Postgres and migrate")?;
    if command == "migrate" {
        tracing::info!("migrations applied");
        return Ok(());
    }

    let nexconn = match &config.nexconn {
        Some(n) => pehle_nexconn::Client::live(
            pehle_nexconn::Credentials { app_key: n.app_key.clone(), app_secret: n.app_secret.clone() },
            &n.api_url,
        )?,
        None => {
            tracing::warn!("NEXCONN_APP_KEY is not set: chat calls are logged, not sent");
            pehle_nexconn::Client::dry()
        }
    };
    let bind = config.bind;
    let state = AppState::new(config, db, nexconn)?;
    if state.config.demo
        && let Err(error) = demo::setup(&state).await
    {
        tracing::warn!(error = %format!("{error:#}"), "demo shop setup failed");
    }

    let (stop, stopped) = watch::channel(false);
    let workers = workers::spawn(state.clone(), stopped);

    let listener = tokio::net::TcpListener::bind(bind).await.with_context(|| format!("bind {bind}"))?;
    tracing::info!(%bind, "pehle api listening");
    axum::serve(listener, routes::router(state))
        .with_graceful_shutdown(async {
            shutdown_signal().await;
            tracing::info!("shutting down");
        })
        .await?;

    let _ = stop.send(true);
    for worker in workers {
        let _ = worker.await;
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
