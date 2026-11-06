//! The small slice of Razorpay's REST API Pehle needs, called with each seller's own keys:
//! Payment Links (create, fetch, cancel), payments (fetch for the UPI reference) and refunds.
//! Docs: https://razorpay.com/docs/api/payments/payment-links/

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

const BASE: &str = "https://api.razorpay.com/v1";

#[derive(Clone, Debug)]
pub struct Keys {
    pub key_id: String,
    pub key_secret: String,
}

#[derive(Clone)]
pub struct Razorpay {
    http: reqwest::Client,
}

#[derive(Debug, Serialize)]
pub struct NewLink<'a> {
    pub amount: i64,
    pub currency: &'static str,
    pub accept_partial: bool,
    /// Unix seconds; Razorpay requires at least 15 minutes ahead.
    pub expire_by: i64,
    /// Unique per link, at most 40 characters.
    pub reference_id: &'a str,
    pub description: &'a str,
    pub customer: Customer<'a>,
    pub notify: Notify,
    pub reminder_enable: bool,
    pub notes: BTreeMap<&'static str, String>,
    pub callback_url: &'a str,
    pub callback_method: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Customer<'a> {
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact: Option<&'a str>,
}

#[derive(Debug, Serialize)]
pub struct Notify {
    pub sms: bool,
    pub email: bool,
}

#[derive(Debug, Deserialize)]
pub struct Link {
    pub id: String,
    #[serde(default)]
    pub short_url: String,
    /// created, partially_paid, paid, expired, cancelled
    pub status: String,
    #[serde(default)]
    pub payments: Option<Vec<LinkPayment>>,
}

#[derive(Debug, Deserialize)]
pub struct LinkPayment {
    pub payment_id: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct Payment {
    pub id: String,
    pub amount: i64,
    pub status: String,
    #[serde(default)]
    pub acquirer_data: Option<Value>,
}

impl Payment {
    /// The UPI reference (RRN) the buyer sees in their app, when the payment was by UPI.
    pub fn rrn(&self) -> Option<String> {
        self.acquirer_data.as_ref()?.get("rrn")?.as_str().map(str::to_string).filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Deserialize)]
pub struct Refund {
    pub id: String,
}

#[derive(Debug, Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    #[serde(default)]
    description: String,
}

impl Razorpay {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("pehle/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { http })
    }

    async fn send<T: for<'de> Deserialize<'de>>(&self, request: reqwest::RequestBuilder, what: &str) -> Result<T> {
        let response = request.send().await.with_context(|| format!("razorpay {what}"))?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            let reason = serde_json::from_str::<ErrorBody>(&text).map(|e| e.error.description).unwrap_or(text);
            bail!("razorpay {what} failed ({status}): {reason}");
        }
        serde_json::from_str(&text).with_context(|| format!("razorpay {what}: unexpected response"))
    }

    /// Cheap authenticated call used to check pasted keys.
    pub async fn verify_keys(&self, keys: &Keys) -> Result<()> {
        let _: Value = self
            .send(
                self.http.get(format!("{BASE}/payment_links")).query(&[("count", "1")]).basic_auth(&keys.key_id, Some(&keys.key_secret)),
                "key check",
            )
            .await?;
        Ok(())
    }

    pub async fn create_link(&self, keys: &Keys, link: &NewLink<'_>) -> Result<Link> {
        self.send(
            self.http.post(format!("{BASE}/payment_links")).basic_auth(&keys.key_id, Some(&keys.key_secret)).json(link),
            "create payment link",
        )
        .await
    }

    pub async fn fetch_link(&self, keys: &Keys, link_id: &str) -> Result<Link> {
        self.send(
            self.http.get(format!("{BASE}/payment_links/{link_id}")).basic_auth(&keys.key_id, Some(&keys.key_secret)),
            "fetch payment link",
        )
        .await
    }

    /// Only works on links that have not been paid.
    pub async fn cancel_link(&self, keys: &Keys, link_id: &str) -> Result<Link> {
        self.send(
            self.http.post(format!("{BASE}/payment_links/{link_id}/cancel")).basic_auth(&keys.key_id, Some(&keys.key_secret)),
            "cancel payment link",
        )
        .await
    }

    pub async fn fetch_payment(&self, keys: &Keys, payment_id: &str) -> Result<Payment> {
        self.send(
            self.http.get(format!("{BASE}/payments/{payment_id}")).basic_auth(&keys.key_id, Some(&keys.key_secret)),
            "fetch payment",
        )
        .await
    }

    pub async fn refund(&self, keys: &Keys, payment_id: &str, amount: i64, reason: &str) -> Result<Refund> {
        #[derive(Serialize)]
        struct Body<'a> {
            amount: i64,
            speed: &'static str,
            notes: BTreeMap<&'static str, &'a str>,
        }
        self.send(
            self.http
                .post(format!("{BASE}/payments/{payment_id}/refund"))
                .basic_auth(&keys.key_id, Some(&keys.key_secret))
                .json(&Body { amount, speed: "normal", notes: BTreeMap::from([("reason", reason)]) }),
            "refund",
        )
        .await
    }
}

/// `X-Razorpay-Signature` is the hex HMAC-SHA256 of the raw request body, keyed with the webhook secret.
pub fn webhook_signature_valid(secret: &str, body: &[u8], signature: &str) -> bool {
    let Ok(expected) = hex::decode(signature.trim()) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &str, body: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn accepts_genuine_and_rejects_forged_webhooks() {
        let body = br#"{"event":"payment_link.paid"}"#;
        let sig = sign("whsec", body);
        assert!(webhook_signature_valid("whsec", body, &sig));
        assert!(!webhook_signature_valid("other", body, &sig));
        assert!(!webhook_signature_valid("whsec", br#"{"event":"payment_link.paid","x":1}"#, &sig));
        assert!(!webhook_signature_valid("whsec", body, "not-hex"));
    }

    #[test]
    fn reads_rrn_from_upi_payments() {
        let payment: Payment = serde_json::from_str(
            r#"{"id":"pay_1","amount":450000,"status":"captured","acquirer_data":{"rrn":"412345678901","upi_transaction_id":"x"}}"#,
        )
        .unwrap();
        assert_eq!(payment.rrn().as_deref(), Some("412345678901"));
        let card: Payment = serde_json::from_str(r#"{"id":"pay_2","amount":1,"status":"captured","acquirer_data":{"auth_code":"1"}}"#).unwrap();
        assert_eq!(card.rrn(), None);
    }
}
