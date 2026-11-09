use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Nexconn built-in message types used by Pehle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageType {
    Text,
    Image,
}

impl MessageType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "RC:TxtMsg",
            Self::Image => "RC:ImgMsg",
        }
    }
}

/// Body of an `RC:TxtMsg`. `extra` carries Pehle's structured payload (claim receipts, product
/// cards, order cards) as a JSON string, so clients without Pehle's renderer still show the text.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct TextMessage {
    pub content: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub extra: String,
}

impl TextMessage {
    pub fn parse(content_json: &str) -> Option<Self> {
        serde_json::from_str(content_json).ok()
    }

    /// The `pehle` object inside `extra`, if this message carries one.
    pub fn pehle_payload(&self) -> Option<Value> {
        if self.extra.is_empty() {
            return None;
        }
        let extra: Value = serde_json::from_str(&self.extra).ok()?;
        extra.get("pehle").cloned()
    }
}

#[derive(Clone, Debug)]
pub struct Message {
    pub kind: MessageType,
    pub text: TextMessage,
}

impl Message {
    /// A text message with an optional structured payload under `extra.pehle`.
    pub fn text(content: impl Into<String>, payload: Option<Value>) -> Self {
        let extra = payload
            .map(|p| serde_json::json!({ "pehle": p }).to_string())
            .unwrap_or_default();
        Self { kind: MessageType::Text, text: TextMessage { content: content.into(), extra } }
    }

    pub fn content_json(&self) -> String {
        serde_json::to_string(&self.text).unwrap_or_else(|_| "{}".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_round_trips_through_extra() {
        let message = Message::text("Claimed #1", Some(serde_json::json!({ "t": "receipt", "position": 1 })));
        let parsed = TextMessage::parse(&message.content_json()).unwrap();
        assert_eq!(parsed.content, "Claimed #1");
        assert_eq!(parsed.pehle_payload().unwrap()["position"], 1);
    }

    #[test]
    fn plain_text_has_no_payload() {
        let parsed = TextMessage::parse(r#"{"content":"mine"}"#).unwrap();
        assert!(parsed.pehle_payload().is_none());
    }
}
