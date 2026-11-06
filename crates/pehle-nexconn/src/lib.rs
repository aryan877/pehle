//! Nexconn Chat server API client and webhook types.
//!
//! Every server API call is a signed JSON `POST`: the `Signature` header is
//! `sha1(app_secret + nonce + timestamp)` in lowercase hex. Webhooks are signed the same way.
//!
//! The client runs in one of two modes. `Live` calls Nexconn. `Dry` logs each request and returns
//! a successful empty response, so the rest of the system can be developed and tested without keys.

pub mod ids;
mod message;
pub mod webhook;

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rand::Rng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

pub use message::{Message, MessageType, TextMessage};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("nexconn request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("nexconn returned code {code} for {path}: {message}")]
    Api { path: &'static str, code: i64, message: String },
    #[error("nexconn response for {path} had no result")]
    MissingResult { path: &'static str },
    #[error("invalid nexconn configuration: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug)]
pub struct Credentials {
    pub app_key: String,
    pub app_secret: String,
}

#[derive(Clone, Debug)]
enum Mode {
    Live { base: url::Url },
    Dry,
}

#[derive(Clone, Debug)]
pub struct Client {
    http: reqwest::Client,
    credentials: Credentials,
    mode: Mode,
}

/// `sha1(secret + nonce + timestamp)` as lowercase hex.
pub fn signature(app_secret: &str, nonce: &str, timestamp: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(app_secret.as_bytes());
    hasher.update(nonce.as_bytes());
    hasher.update(timestamp.as_bytes());
    hex::encode(hasher.finalize())
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default()
}

#[derive(Deserialize)]
struct Envelope<T> {
    code: i64,
    #[serde(default, alias = "errorMessage", alias = "msg")]
    message: Option<String>,
    result: Option<T>,
}

/// Responses whose only meaningful field is `code`.
#[derive(Debug, Default, Deserialize)]
pub struct Empty {}

impl Client {
    /// A client that calls Nexconn at `base_url` (for example `https://api.sg-light-api.com`).
    pub fn live(credentials: Credentials, base_url: &str) -> Result<Self> {
        if credentials.app_key.is_empty() || credentials.app_secret.is_empty() {
            return Err(Error::Config("app key and app secret are required".into()));
        }
        let base = url::Url::parse(base_url).map_err(|e| Error::Config(e.to_string()))?;
        Ok(Self { http: http_client()?, credentials, mode: Mode::Live { base } })
    }

    /// A client that only logs requests. Used when no App Key is configured.
    pub fn dry() -> Self {
        Self {
            http: reqwest::Client::new(),
            credentials: Credentials { app_key: "dry-run".into(), app_secret: "dry-run".into() },
            mode: Mode::Dry,
        }
    }

    pub fn is_live(&self) -> bool {
        matches!(self.mode, Mode::Live { .. })
    }

    pub fn app_key(&self) -> &str {
        &self.credentials.app_key
    }

    pub fn app_secret(&self) -> &str {
        &self.credentials.app_secret
    }

    async fn post<B: Serialize + ?Sized, R: DeserializeOwned + Default>(
        &self,
        path: &'static str,
        body: &B,
    ) -> Result<R> {
        let base = match &self.mode {
            Mode::Dry => {
                tracing::info!(target: "nexconn::dry", path, body = %serde_json::to_string(body).unwrap_or_default());
                return Ok(R::default());
            }
            Mode::Live { base } => base,
        };
        let url = base.join(path).map_err(|e| Error::Config(e.to_string()))?;
        let nonce: u64 = rand::rng().random();
        let nonce = nonce.to_string();
        let timestamp = now_ms().to_string();
        let started = std::time::Instant::now();
        let response = self
            .http
            .post(url)
            .header("App-Key", &self.credentials.app_key)
            .header("Nonce", &nonce)
            .header("Timestamp", &timestamp)
            .header("Signature", signature(&self.credentials.app_secret, &nonce, &timestamp))
            .json(body)
            .send()
            .await?
            .error_for_status()?;
        let envelope: Envelope<R> = response.json().await?;
        tracing::debug!(target: "nexconn", path, code = envelope.code, ms = started.elapsed().as_millis() as u64);
        if envelope.code != 0 {
            return Err(Error::Api { path, code: envelope.code, message: envelope.message.unwrap_or_default() });
        }
        Ok(envelope.result.unwrap_or_default())
    }

    /// Issue a chat token for a user, creating the user on first use.
    pub async fn issue_token(&self, user_id: &str, name: &str, avatar_url: Option<&str>) -> Result<String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            user_id: &'a str,
            name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            avatar_url: Option<&'a str>,
        }
        #[derive(Default, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Issued {
            access_token: String,
        }
        if !self.is_live() {
            return Ok(format!("dry-token-{user_id}"));
        }
        let issued: Issued =
            self.post("/v4/auth/access-token/issue", &Body { user_id, name, avatar_url }).await?;
        if issued.access_token.is_empty() {
            return Err(Error::MissingResult { path: "/v4/auth/access-token/issue" });
        }
        Ok(issued.access_token)
    }

    pub async fn update_user(&self, user_id: &str, name: &str, avatar_url: Option<&str>) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            user_id: &'a str,
            name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            avatar_url: Option<&'a str>,
        }
        self.post::<_, Empty>("/v4/user/update", &Body { user_id, name, avatar_url }).await.map(drop)
    }

    /// Create an open channel that Nexconn destroys `ttl_minutes` after it empties.
    pub async fn create_open_channel(&self, channel_id: &str, ttl_minutes: u32) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            destroy_type: u8,
            ttl_minutes: u32,
        }
        self.post::<_, Empty>("/v4/open-channel/create", &Body { channel_id, destroy_type: 1, ttl_minutes })
            .await
            .map(drop)
    }

    pub async fn destroy_open_channel(&self, channel_id: &str) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_ids: [&'a str; 1],
        }
        self.post::<_, Empty>("/v4/open-channel/destroy", &Body { channel_ids: [channel_id] }).await.map(drop)
    }

    /// Write room state. Every participant receives `onMetadataChanged`.
    pub async fn set_open_channel_metadata(
        &self,
        channel_id: &str,
        owner_id: &str,
        metadata: &BTreeMap<String, String>,
    ) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            should_auto_delete: u8,
            metadata_owner_id: &'a str,
            metadata: &'a BTreeMap<String, String>,
        }
        self.post::<_, Empty>(
            "/v4/open-channel/metadata/batch/set",
            &Body { channel_id, should_auto_delete: 0, metadata_owner_id: owner_id, metadata },
        )
        .await
        .map(drop)
    }

    /// Messages from these users are delivered first when the room is flooded.
    pub async fn add_priority_senders(&self, channel_id: &str, user_ids: &[&str]) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            participant_ids: &'a [&'a str],
        }
        self.post::<_, Empty>(
            "/v4/open-channel/priority-sender-list/add",
            &Body { channel_id, participant_ids: user_ids },
        )
        .await
        .map(drop)
    }

    pub async fn mute_participant(&self, channel_id: &str, user_id: &str, minutes: u32) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            participant_ids: [&'a str; 1],
            duration_minutes: u32,
        }
        self.post::<_, Empty>(
            "/v4/open-channel/participant/mute-list/add",
            &Body { channel_id, participant_ids: [user_id], duration_minutes: minutes },
        )
        .await
        .map(drop)
    }

    pub async fn send_open_channel_message(&self, from: &str, channel_id: &str, message: &Message) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            from_user_id: &'a str,
            to_channel_ids: [&'a str; 1],
            message_type: &'a str,
            content: String,
            /// 2 = high: drop cards and receipts are delivered ahead of chatter when the room floods.
            priority: u8,
        }
        self.post::<_, Empty>(
            "/v4/open-channel/message/send",
            &Body {
                from_user_id: from,
                to_channel_ids: [channel_id],
                message_type: message.kind.as_str(),
                content: message.content_json(),
                priority: 2,
            },
        )
        .await
        .map(drop)
    }

    /// Send a direct message. Returns the message ID so it can be updated later.
    pub async fn send_direct_message(
        &self,
        from: &str,
        to: &str,
        message: &Message,
        push: Option<&str>,
    ) -> Result<Option<String>> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            from_user_id: &'a str,
            to_user_ids: [&'a str; 1],
            message_type: &'a str,
            content: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            push_content: Option<&'a str>,
            should_persist: u8,
            is_echo_to_sender: u8,
        }
        #[derive(Default, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Sent {
            #[serde(default)]
            message_ids: Vec<SentId>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct SentId {
            message_id: String,
        }
        let sent: Sent = self
            .post(
                "/v4/direct-channel/message/send",
                &Body {
                    from_user_id: from,
                    to_user_ids: [to],
                    message_type: message.kind.as_str(),
                    content: message.content_json(),
                    push_content: push,
                    should_persist: 1,
                    is_echo_to_sender: 1,
                },
            )
            .await?;
        Ok(sent.message_ids.into_iter().next().map(|m| m.message_id))
    }

    pub async fn update_direct_message(&self, from: &str, to: &str, message_id: &str, message: &Message) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            from_user_id: &'a str,
            target_id: &'a str,
            message_id: &'a str,
            content: String,
        }
        self.post::<_, Empty>(
            "/v4/direct-channel/message/update",
            &Body { from_user_id: from, target_id: to, message_id, content: message.content_json() },
        )
        .await
        .map(drop)
    }

    pub async fn create_group(&self, channel_id: &str, name: &str, owner: &str, members: &[&str]) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            name: &'a str,
            owner: &'a str,
            user_ids: &'a [&'a str],
        }
        self.post::<_, Empty>("/v4/group-channel/create", &Body { channel_id, name, owner, user_ids: members })
            .await
            .map(drop)
    }

    pub async fn join_group(&self, channel_id: &str, user_ids: &[&str]) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            user_ids: &'a [&'a str],
        }
        #[derive(Default, Deserialize)]
        struct Joined {}
        self.post::<_, Joined>("/v4/group-channel/join", &Body { channel_id, user_ids }).await.map(drop)
    }

    pub async fn quit_group(&self, channel_id: &str, user_ids: &[&str]) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            channel_id: &'a str,
            user_ids: &'a [&'a str],
        }
        #[derive(Default, Deserialize)]
        struct Quit {}
        self.post::<_, Quit>("/v4/group-channel/quit", &Body { channel_id, user_ids }).await.map(drop)
    }

    pub async fn send_group_message(&self, from: &str, channel_id: &str, message: &Message, push: Option<&str>) -> Result<()> {
        self.send_group_message_to(from, channel_id, None, message, push).await
    }

    /// A group message that only `to` (up to 10 members) receive, or everyone when `to` is None.
    pub async fn send_group_message_to(
        &self,
        from: &str,
        channel_id: &str,
        to: Option<&[&str]>,
        message: &Message,
        push: Option<&str>,
    ) -> Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            from_user_id: &'a str,
            to_channel_ids: [&'a str; 1],
            #[serde(skip_serializing_if = "Option::is_none")]
            to_user_ids: Option<&'a [&'a str]>,
            message_type: &'a str,
            content: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            push_content: Option<&'a str>,
            should_persist: u8,
            is_echo_to_sender: u8,
        }
        self.post::<_, Empty>(
            "/v4/group-channel/message/send",
            &Body {
                from_user_id: from,
                to_channel_ids: [channel_id],
                to_user_ids: to,
                message_type: message.kind.as_str(),
                content: message.content_json(),
                push_content: push,
                should_persist: 1,
                is_echo_to_sender: 0,
            },
        )
        .await
        .map(drop)
    }
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        // Nexconn closes idle connections after 55 seconds; drop ours first.
        .pool_idle_timeout(Duration::from_secs(45))
        .user_agent(concat!("pehle/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(Error::Http)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_matches_reference() {
        // sha1("secret" + "nonce" + "1700000000000")
        let expected = {
            let mut h = Sha1::new();
            h.update(b"secretnonce1700000000000");
            hex::encode(h.finalize())
        };
        assert_eq!(signature("secret", "nonce", "1700000000000"), expected);
        assert_eq!(expected.len(), 40);
    }

    #[tokio::test]
    async fn dry_client_succeeds_without_keys() {
        let client = Client::dry();
        assert!(!client.is_live());
        assert_eq!(client.issue_token("u1", "Asha", None).await.unwrap(), "dry-token-u1");
        client.create_open_channel("liveabc", 120).await.unwrap();
    }
}
