use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, bail};

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub bind: SocketAddr,
    /// Public origin of the web app, for example `https://pehle.live`. Used for OAuth redirects and links.
    pub public_url: url::Url,
    pub cookie_secure: bool,
    pub dev_login: bool,
    pub media_dir: PathBuf,
    pub nexconn: Option<NexconnConfig>,
    pub google: Option<GoogleConfig>,
    pub cohost: Option<CohostConfig>,
    /// Base64 32-byte key that encrypts sellers' payment gateway secrets.
    pub secret_key: Option<String>,
    /// YouTube Data API key for reading public live chats.
    pub youtube_api_key: Option<String>,
    /// Firebase project for phone sign-in. None hides phone sign-in.
    pub firebase: Option<crate::firebase::FirebaseWebConfig>,
    /// Base64url PKCS#8 P-256 key for Web Push (`pehle-api vapid-keys`). None disables browser push.
    pub vapid_private_key: Option<String>,
    /// Contact for push services: a `mailto:` or `https:` URL.
    pub vapid_subject: String,
    /// Run the public demo shop that judges and new sellers can try.
    pub demo: bool,
    /// Photos for the demo shop's items.
    pub demo_assets: PathBuf,
}

#[derive(Clone, Debug)]
pub struct NexconnConfig {
    pub app_key: String,
    pub app_secret: String,
    pub api_url: String,
}

#[derive(Clone, Debug)]
pub struct GoogleConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Clone, Debug)]
pub struct CohostConfig {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn flag(name: &str, default: bool) -> anyhow::Result<bool> {
    match var(name).as_deref() {
        None => Ok(default),
        Some("1" | "true" | "yes") => Ok(true),
        Some("0" | "false" | "no") => Ok(false),
        Some(other) => bail!("{name} must be true or false, got {other:?}"),
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let public_url: url::Url = var("PEHLE_PUBLIC_URL")
            .unwrap_or_else(|| "http://localhost:5173".into())
            .parse()
            .context("PEHLE_PUBLIC_URL is not a URL")?;
        let cookie_secure = flag("PEHLE_COOKIE_SECURE", public_url.scheme() == "https")?;
        let dev_login = flag("PEHLE_DEV_LOGIN", false)?;
        if dev_login && public_url.scheme() == "https" && var("PEHLE_ALLOW_DEV_LOGIN_ON_HTTPS").is_none() {
            bail!("PEHLE_DEV_LOGIN is for local development; refusing to enable it on {public_url}");
        }

        let nexconn = match (var("NEXCONN_APP_KEY"), var("NEXCONN_APP_SECRET")) {
            (Some(app_key), Some(app_secret)) => Some(NexconnConfig {
                app_key,
                app_secret,
                api_url: var("NEXCONN_API_URL").unwrap_or_else(|| "https://api.sg-light-api.com".into()),
            }),
            (None, None) => None,
            _ => bail!("set both NEXCONN_APP_KEY and NEXCONN_APP_SECRET, or neither"),
        };
        let google = match (var("GOOGLE_CLIENT_ID"), var("GOOGLE_CLIENT_SECRET")) {
            (Some(client_id), Some(client_secret)) => Some(GoogleConfig { client_id, client_secret }),
            (None, None) => None,
            _ => bail!("set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither"),
        };
        let cohost = var("COHOST_API_KEY").map(|api_key| CohostConfig {
            api_key,
            api_url: var("COHOST_API_URL").unwrap_or_else(|| "https://openrouter.ai/api/v1".into()),
            model: var("COHOST_MODEL").unwrap_or_else(|| "google/gemini-2.5-flash".into()),
        });

        let firebase = match (var("FIREBASE_PROJECT_ID"), var("FIREBASE_API_KEY")) {
            (Some(project_id), Some(api_key)) => Some(crate::firebase::FirebaseWebConfig {
                auth_domain: var("FIREBASE_AUTH_DOMAIN").unwrap_or_else(|| format!("{project_id}.firebaseapp.com")),
                project_id,
                api_key,
            }),
            (None, None) => None,
            _ => bail!("set both FIREBASE_PROJECT_ID and FIREBASE_API_KEY, or neither"),
        };
        let vapid_subject = var("PEHLE_VAPID_SUBJECT").unwrap_or_else(|| public_url.as_str().trim_end_matches('/').to_string());
        if !(vapid_subject.starts_with("mailto:") || vapid_subject.starts_with("https://")) {
            tracing::warn!("PEHLE_VAPID_SUBJECT should be a mailto: or https: URL; some push services reject {vapid_subject}");
        }

        Ok(Self {
            database_url: var("DATABASE_URL").context("DATABASE_URL is required")?,
            bind: var("PEHLE_BIND").unwrap_or_else(|| "127.0.0.1:8790".into()).parse().context("PEHLE_BIND")?,
            public_url,
            cookie_secure,
            dev_login,
            media_dir: var("PEHLE_MEDIA_DIR").unwrap_or_else(|| "./data/media".into()).into(),
            nexconn,
            google,
            cohost,
            secret_key: var("PEHLE_SECRET_KEY"),
            youtube_api_key: var("YOUTUBE_API_KEY"),
            firebase,
            vapid_private_key: var("PEHLE_VAPID_PRIVATE_KEY"),
            vapid_subject,
            demo: flag("PEHLE_DEMO", true)?,
            demo_assets: var("PEHLE_DEMO_ASSETS").unwrap_or_else(|| "./scripts/demo-assets".into()).into(),
        })
    }

    pub fn google_redirect_uri(&self) -> String {
        format!("{}/api/v1/auth/google/callback", self.public_url.as_str().trim_end_matches('/'))
    }
}
