//! Browser notifications over Web Push (RFC 8030), signed with VAPID (RFC 8292) and encrypted with
//! `aes128gcm` (RFC 8291). Works on Android Chrome, desktop browsers and installed iPhone web apps.
//! No third-party push service account is needed: the browser vendor's endpoint accepts any server
//! that signs with the VAPID key the subscription was created for.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use futures::StreamExt;
use hkdf::Hkdf;
use pehle_db::audience::PushTarget;
use ring::agreement;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
use serde::Serialize;
use sha2::Sha256;

use crate::state::AppState;

/// Record size advertised in the header; one record holds the whole (small) payload.
const RECORD_SIZE: u32 = 4096;
/// Payloads above this are refused before encryption (the services cap bodies near 4 KB).
const MAX_PAYLOAD: usize = 3000;

pub struct Vapid {
    key_pair: EcdsaKeyPair,
    public_key: String,
    subject: String,
    rng: SystemRandom,
}

/// What the service worker shows.
#[derive(Clone, Debug, Serialize)]
pub struct Notification {
    pub title: String,
    pub body: String,
    /// Path to open on tap, for example `/l/ab12cd34`.
    pub url: String,
    /// Notifications with the same tag replace each other.
    pub tag: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Delivery {
    Delivered,
    /// The subscription expired or was revoked (404/410): forget it.
    Gone,
    Failed,
}

impl Vapid {
    /// `pkcs8` is the base64url PKCS#8 document printed by `pehle-api vapid-keys`.
    pub fn from_pkcs8(pkcs8: &str, subject: String) -> Result<Self> {
        let rng = SystemRandom::new();
        let der = B64.decode(pkcs8.trim()).context("PEHLE_VAPID_PRIVATE_KEY is not base64url")?;
        let key_pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &der, &rng)
            .map_err(|_| anyhow!("PEHLE_VAPID_PRIVATE_KEY is not a P-256 PKCS#8 key"))?;
        let public_key = B64.encode(key_pair.public_key().as_ref());
        Ok(Self { key_pair, public_key, subject, rng })
    }

    /// A fresh key pair as base64url PKCS#8.
    pub fn generate_pkcs8() -> Result<String> {
        let document = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
            .map_err(|_| anyhow!("could not generate a VAPID key"))?;
        Ok(B64.encode(document.as_ref()))
    }

    /// The application server key browsers subscribe with (uncompressed P-256 point, base64url).
    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    /// `Authorization: vapid t=<jwt>, k=<key>` for an endpoint, valid for 12 hours.
    fn authorization(&self, endpoint: &url::Url) -> Result<String> {
        let audience = endpoint.origin().ascii_serialization();
        let expires = chrono::Utc::now().timestamp() + 12 * 3600;
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = B64.encode(serde_json::to_vec(&serde_json::json!({ "aud": audience, "exp": expires, "sub": self.subject }))?);
        let signing_input = format!("{header}.{claims}");
        let signature = self
            .key_pair
            .sign(&self.rng, signing_input.as_bytes())
            .map_err(|_| anyhow!("VAPID signing failed"))?;
        Ok(format!("vapid t={signing_input}.{}, k={}", B64.encode(signature.as_ref()), self.public_key))
    }
}

/// Encrypt a payload for one subscription (RFC 8291, single record).
pub fn encrypt(p256dh: &str, auth: &str, plaintext: &[u8], rng: &dyn SecureRandom) -> Result<Vec<u8>> {
    if plaintext.len() > MAX_PAYLOAD {
        bail!("push payload too large");
    }
    let receiver = B64.decode(p256dh.trim_end_matches('=')).context("p256dh")?;
    let auth_secret = B64.decode(auth.trim_end_matches('=')).context("auth")?;
    if receiver.len() != 65 || auth_secret.len() != 16 {
        bail!("subscription keys have the wrong length");
    }
    let sender_private = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, rng).map_err(|_| anyhow!("ecdh key"))?;
    let sender_public = sender_private.compute_public_key().map_err(|_| anyhow!("ecdh public key"))?;
    let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, &receiver);
    let shared = agreement::agree_ephemeral(sender_private, &peer, |secret| secret.to_vec())
        .map_err(|_| anyhow!("ecdh agreement failed"))?;

    let mut salt = [0u8; 16];
    rng.fill(&mut salt).map_err(|_| anyhow!("random salt"))?;
    let (cek, nonce) = derive_keys(&shared, &auth_secret, &receiver, sender_public.as_ref(), &salt)?;

    let mut padded = Vec::with_capacity(plaintext.len() + 1);
    padded.extend_from_slice(plaintext);
    padded.push(0x02); // last-record delimiter
    let cipher = Aes128Gcm::new_from_slice(&cek).map_err(|_| anyhow!("cek"))?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), padded.as_slice()).map_err(|_| anyhow!("encrypt"))?;

    let mut body = Vec::with_capacity(16 + 4 + 1 + 65 + ciphertext.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(65);
    body.extend_from_slice(sender_public.as_ref());
    body.extend_from_slice(&ciphertext);
    Ok(body)
}

/// Content key and nonce from the ECDH secret, the subscription's auth secret and the salt.
fn derive_keys(shared: &[u8], auth_secret: &[u8], receiver: &[u8], sender: &[u8], salt: &[u8]) -> Result<([u8; 16], [u8; 12])> {
    let mut key_info = Vec::with_capacity(14 + 65 + 65);
    key_info.extend_from_slice(b"WebPush: info\0");
    key_info.extend_from_slice(receiver);
    key_info.extend_from_slice(sender);
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth_secret), shared).expand(&key_info, &mut ikm).map_err(|_| anyhow!("hkdf ikm"))?;
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).map_err(|_| anyhow!("hkdf cek"))?;
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).map_err(|_| anyhow!("hkdf nonce"))?;
    Ok((cek, nonce))
}

async fn deliver(state: &AppState, vapid: &Vapid, target: &PushTarget, payload: &[u8]) -> Delivery {
    let attempt = async {
        let endpoint: url::Url = target.endpoint.parse().context("endpoint")?;
        let body = encrypt(&target.p256dh, &target.auth, payload, &vapid.rng)?;
        let response = state
            .http
            .post(endpoint.clone())
            .header("Authorization", vapid.authorization(&endpoint)?)
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .header("TTL", "3600")
            .header("Urgency", "high")
            .body(body)
            .send()
            .await?;
        Ok::<_, anyhow::Error>(response.status())
    };
    match attempt.await {
        Ok(status) if status.is_success() => Delivery::Delivered,
        Ok(status) if status.as_u16() == 404 || status.as_u16() == 410 => Delivery::Gone,
        Ok(status) => {
            tracing::debug!(%status, "push rejected");
            Delivery::Failed
        }
        Err(error) => {
            tracing::debug!(error = %format!("{error:#}"), "push failed");
            Delivery::Failed
        }
    }
}

/// Send one notification to many browsers, eight at a time, and record each outcome.
pub async fn notify(state: &AppState, targets: Vec<PushTarget>, notification: &Notification) -> Result<usize> {
    let Some(vapid) = state.vapid.as_ref() else {
        return Ok(0);
    };
    let payload = serde_json::to_vec(notification)?;
    let outcomes: Vec<(String, Delivery)> = futures::stream::iter(targets)
        .map(|target| {
            let payload = &payload;
            async move {
                let outcome = deliver(state, vapid, &target, payload).await;
                (target.endpoint, outcome)
            }
        })
        .buffer_unordered(8)
        .collect()
        .await;
    let mut delivered = 0;
    for (endpoint, outcome) in outcomes {
        delivered += usize::from(outcome == Delivery::Delivered);
        state.db.push_delivered(&endpoint, outcome == Delivery::Delivered, outcome == Delivery::Gone).await?;
    }
    Ok(delivered)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decrypt the way a browser does, to prove the payload format.
    fn decrypt(receiver_private: agreement::EphemeralPrivateKey, receiver_public: &[u8], auth: &[u8], body: &[u8]) -> Vec<u8> {
        let salt = &body[..16];
        assert_eq!(u32::from_be_bytes(body[16..20].try_into().unwrap()), RECORD_SIZE);
        assert_eq!(body[20], 65);
        let sender = &body[21..86];
        let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, sender);
        let shared = agreement::agree_ephemeral(receiver_private, &peer, |s| s.to_vec()).unwrap();
        let (cek, nonce) = derive_keys(&shared, auth, receiver_public, sender, salt).unwrap();
        let mut plain = Aes128Gcm::new_from_slice(&cek).unwrap().decrypt(Nonce::from_slice(&nonce), &body[86..]).unwrap();
        assert_eq!(plain.pop(), Some(0x02));
        plain
    }

    #[test]
    fn payload_round_trips_like_a_browser_would_decrypt_it() {
        let rng = SystemRandom::new();
        let receiver = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).unwrap();
        let receiver_public = receiver.compute_public_key().unwrap().as_ref().to_vec();
        let mut auth = [0u8; 16];
        rng.fill(&mut auth).unwrap();
        let message = br#"{"title":"Meera Sarees is live","body":"Friday silk drop","url":"/l/ab12cd34","tag":"drop"}"#;
        let body = encrypt(&B64.encode(&receiver_public), &B64.encode(auth), message, &rng).unwrap();
        assert_eq!(decrypt(receiver, &receiver_public, &auth, &body), message);
    }

    #[test]
    fn vapid_header_is_a_signed_es256_token_for_the_endpoint_origin() {
        let vapid = Vapid::from_pkcs8(&Vapid::generate_pkcs8().unwrap(), "mailto:hello@pehle.app".into()).unwrap();
        let endpoint: url::Url = "https://fcm.googleapis.com/fcm/send/abc:def".parse().unwrap();
        let header = vapid.authorization(&endpoint).unwrap();
        let token = header.strip_prefix("vapid t=").unwrap().split(", k=").next().unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value = serde_json::from_slice(&B64.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["sub"], "mailto:hello@pehle.app");
        let public = ring::signature::UnparsedPublicKey::new(&ring::signature::ECDSA_P256_SHA256_FIXED, B64.decode(vapid.public_key()).unwrap());
        public.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &B64.decode(parts[2]).unwrap()).unwrap();
        assert_eq!(B64.decode(vapid.public_key()).unwrap().len(), 65);
    }

    #[test]
    fn malformed_subscriptions_are_refused() {
        let rng = SystemRandom::new();
        assert!(encrypt("short", "short", b"x", &rng).is_err());
        assert!(encrypt(&B64.encode([4u8; 65]), &B64.encode([0u8; 16]), &[0u8; 4000], &rng).is_err());
    }
}
