use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;
use std::time::{Duration, Instant};

use pehle_db::Db;
use pehle_nexconn::Client as Nexconn;
use tokio::sync::Mutex;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub config: Config,
    pub db: Db,
    pub nexconn: Nexconn,
    /// Outbound HTTP for Google and the co-host model.
    pub http: reqwest::Client,
    pub razorpay: crate::payments::razorpay::Razorpay,
    /// Encrypts sellers' gateway secrets; None when PEHLE_SECRET_KEY is missing (payments disabled).
    pub sealer: Option<crate::payments::sealer::Sealer>,
    /// Serialises payment link creation so one order never gets two live links.
    pub link_lock: Mutex<()>,
    /// Browser push signing key; None when PEHLE_VAPID_PRIVATE_KEY is missing.
    pub vapid: Option<crate::push::Vapid>,
    /// Phone sign-in verification; None when no Firebase project is configured.
    pub firebase: Option<crate::firebase::Firebase>,
    /// One demo race at a time.
    pub demo_lock: Mutex<()>,
    chat_tokens: Mutex<HashMap<String, (String, Instant)>>,
}

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

/// Chat tokens are reused for a while so a refresh does not create a new Nexconn token every time.
const CHAT_TOKEN_TTL: Duration = Duration::from_secs(6 * 60 * 60);

impl AppState {
    pub fn new(config: Config, db: Db, nexconn: Nexconn) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("pehle/", env!("CARGO_PKG_VERSION")))
            .build()?;
        let sealer = match config.secret_key.as_deref() {
            Some(key) => Some(crate::payments::sealer::Sealer::from_base64(key)?),
            None => {
                tracing::warn!("PEHLE_SECRET_KEY is not set: sellers cannot connect a payment gateway");
                None
            }
        };
        let vapid = match config.vapid_private_key.as_deref() {
            Some(key) => Some(crate::push::Vapid::from_pkcs8(key, config.vapid_subject.clone())?),
            None => {
                tracing::warn!("PEHLE_VAPID_PRIVATE_KEY is not set: browser notifications are off");
                None
            }
        };
        let firebase = config.firebase.clone().map(crate::firebase::Firebase::new);
        Ok(Self(Arc::new(Inner {
            config,
            db,
            nexconn,
            http,
            razorpay: crate::payments::razorpay::Razorpay::new()?,
            sealer,
            link_lock: Mutex::new(()),
            vapid,
            firebase,
            demo_lock: Mutex::new(()),
            chat_tokens: Mutex::new(HashMap::new()),
        })))
    }

    /// A Nexconn token for `user_id`, issued by our server so the browser never sees the App Secret.
    pub async fn chat_token(&self, user_id: &str, name: &str, avatar: Option<&str>) -> Result<String, pehle_nexconn::Error> {
        {
            let tokens = self.chat_tokens.lock().await;
            if let Some((token, at)) = tokens.get(user_id)
                && at.elapsed() < CHAT_TOKEN_TTL
            {
                return Ok(token.clone());
            }
        }
        let token = self.nexconn.issue_token(user_id, name, avatar).await?;
        let mut tokens = self.chat_tokens.lock().await;
        tokens.retain(|_, (_, at)| at.elapsed() < CHAT_TOKEN_TTL);
        tokens.insert(user_id.to_string(), (token.clone(), Instant::now()));
        Ok(token)
    }

    /// Absolute URL for a stored media path such as `media/ab12.webp`.
    pub fn media_url(&self, path: &str) -> String {
        format!("{}/{}", self.config.public_url.as_str().trim_end_matches('/'), path.trim_start_matches('/'))
    }

    pub fn room_url(&self, slug: &str) -> String {
        format!("{}/l/{slug}", self.config.public_url.as_str().trim_end_matches('/'))
    }

    pub fn order_url(&self, order_id: uuid::Uuid) -> String {
        format!("{}/o/{order_id}", self.config.public_url.as_str().trim_end_matches('/'))
    }
}
