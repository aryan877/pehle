//! Typed access to Pehle's Postgres database.
//!
//! Reads are plain, compile-time-checked table queries. Every write goes through an `app.*` SQL
//! function: pooled connections run as the `pehle_api` role, which can read tables but cannot write
//! them, so the rules in `db/migrations/0002_functions.sql` cannot be bypassed.

pub mod approvals;
pub mod audience;
pub mod browse;
pub mod claims;
pub mod demo;
mod error;
pub mod events;
pub mod items;
pub mod lives;
pub mod models;
pub mod orders;
pub mod outbox;
pub mod payments;
pub mod people;
pub mod sessions;
pub mod shops;
pub mod youtube;

use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Connection, Executor, PgPool};

pub use error::{DbError, DbResult};
pub use models::*;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../db/migrations");

/// The restricted role every pooled connection switches to.
pub const API_ROLE: &str = "pehle_api";

#[derive(Clone, Debug)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    /// Run migrations as the connecting (owner) user, then open a pool whose connections act as
    /// `pehle_api`.
    pub async fn connect(url: &str, max_connections: u32) -> DbResult<Self> {
        let options: PgConnectOptions = url
            .parse::<PgConnectOptions>()?
            .application_name("pehle")
            .log_slow_statements(tracing::log::LevelFilter::Warn, Duration::from_millis(250));
        let mut owner = sqlx::PgConnection::connect_with(&options).await?;
        MIGRATOR.run(&mut owner).await?;
        owner.close().await?;
        let pool = Self::restricted_pool(PgPoolOptions::new().max_connections(max_connections))
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    /// Pool options that switch every new connection to the API role.
    pub fn restricted_pool(options: PgPoolOptions) -> PgPoolOptions {
        options
            .acquire_timeout(Duration::from_secs(5))
            .idle_timeout(Duration::from_secs(300))
            .after_connect(|conn, _| {
                Box::pin(async move {
                    conn.execute("set role pehle_api").await?;
                    Ok(())
                })
            })
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ping(&self) -> DbResult<()> {
        sqlx::query_scalar!("select 1 as \"one!\"").fetch_one(&self.pool).await?;
        Ok(())
    }
}
