//! Webhook envelope, payloads and signature verification.
//!
//! Every request carries `AppKey`, `Nonce`, `Timestamp` and `Signature` headers, where
//! `Signature = sha1(app_secret + nonce + timestamp)`. Pre-messaging events are synchronous:
//! Nexconn waits up to five seconds for the reply and retries up to three times.

use serde::{Deserialize, Serialize};

use crate::signature;

/// How far a webhook timestamp may drift from our clock before the request is refused.
pub const MAX_CLOCK_SKEW_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, PartialEq, Eq)]
pub enum Verification {
    Valid,
    BadSignature,
    WrongApp,
    Stale,
}

/// Check the signature headers of an incoming webhook.
pub fn verify(
    app_key: &str,
    app_secret: &str,
    header_app_key: &str,
    nonce: &str,
    timestamp: &str,
    header_signature: &str,
    now_ms: i64,
) -> Verification {
    if header_app_key != app_key {
        return Verification::WrongApp;
    }
    let expected = signature(app_secret, nonce, timestamp);
    if !constant_time_eq(expected.as_bytes(), header_signature.to_ascii_lowercase().as_bytes()) {
        return Verification::BadSignature;
    }
    match timestamp.parse::<i64>() {
        Ok(ts) if (now_ms - ts).abs() <= MAX_CLOCK_SKEW_MS => Verification::Valid,
        _ => Verification::Stale,
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Every webhook body: `{ type, id, time, data: [...] }`.
#[derive(Debug, Deserialize)]
pub struct Envelope {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub time: i64,
    #[serde(default)]
    pub data: Vec<serde_json::Value>,
}

/// Channel type numbers used in webhook payloads.
pub mod channel_type {
    pub const DIRECT: i64 = 1;
    pub const GROUP: i64 = 3;
    pub const OPEN: i64 = 4;
}

/// `*:pre_messaging` data item.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreMessaging {
    pub user_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub channel_type: i64,
    pub message_type: String,
    #[serde(default)]
    pub content: String,
    /// When Nexconn's server received the message (Unix ms).
    pub time: i64,
    pub message_id: String,
    #[serde(default)]
    pub os: String,
}

/// `message:send` data item.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSent {
    pub user_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub channel_type: i64,
    pub message_type: String,
    #[serde(default)]
    pub content: String,
    pub time: i64,
    pub message_id: String,
}

/// `user:connection_status` data item. Status "0" is online.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub user_id: String,
    pub status: String,
    #[serde(default)]
    pub os: String,
    pub time: i64,
}

/// Reply to a pre-messaging event.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreMessagingReply {
    /// 0 blocks delivery, 1 delivers and continues other callbacks.
    pub pass: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace_push_content: Option<String>,
    /// Returned to the sender's interception callback when blocked. At most 1024 characters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
}

impl PreMessagingReply {
    pub fn deliver() -> Self {
        Self { pass: 1, ..Self::default() }
    }

    pub fn replace(content_json: String) -> Self {
        Self { pass: 1, replace_content: Some(content_json), ..Self::default() }
    }

    pub fn block(reason: impl Into<String>) -> Self {
        let mut reason = reason.into();
        reason.truncate(1024);
        Self { pass: 0, extra: Some(reason), ..Self::default() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_signed_request() {
        let sig = signature("s3cret", "abc", "1700000000000");
        assert_eq!(verify("key", "s3cret", "key", "abc", "1700000000000", &sig, 1_700_000_001_000), Verification::Valid);
        assert_eq!(
            verify("key", "s3cret", "key", "abc", "1700000000000", &sig.to_uppercase(), 1_700_000_001_000),
            Verification::Valid
        );
    }

    #[test]
    fn rejects_tampering_and_replays() {
        let sig = signature("s3cret", "abc", "1700000000000");
        assert_eq!(verify("key", "s3cret", "other", "abc", "1700000000000", &sig, 1_700_000_000_000), Verification::WrongApp);
        assert_eq!(verify("key", "s3cret", "key", "abd", "1700000000000", &sig, 1_700_000_000_000), Verification::BadSignature);
        assert_eq!(verify("key", "s3cret", "key", "abc", "1700000000000", &sig, 1_700_000_000_000 + MAX_CLOCK_SKEW_MS + 1), Verification::Stale);
    }

    #[test]
    fn parses_pre_messaging_payload() {
        let body = r#"{"type":"open_channel:pre_messaging","id":"e1","time":1730192400000,"data":[{"appKey":"k","userId":"u1","channelId":"liveab12cd34","channelType":4,"messageType":"RC:TxtMsg","content":"{\"content\":\"mine\"}","time":1730192400001,"messageId":"m1","os":"Websocket"}]}"#;
        let envelope: Envelope = serde_json::from_str(body).unwrap();
        assert_eq!(envelope.kind, "open_channel:pre_messaging");
        let item: PreMessaging = serde_json::from_value(envelope.data[0].clone()).unwrap();
        assert_eq!(item.channel_type, channel_type::OPEN);
        assert_eq!(item.message_id, "m1");
    }

    #[test]
    fn reply_serialises_camel_case() {
        let reply = PreMessagingReply::block("too many holds");
        assert_eq!(serde_json::to_string(&reply).unwrap(), r#"{"pass":0,"extra":"too many holds"}"#);
    }
}
