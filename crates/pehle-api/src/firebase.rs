//! Phone sign-in. The browser verifies the number with Firebase Authentication (SMS code plus
//! reCAPTCHA) and sends us the resulting ID token. We check its RS256 signature against Google's
//! published keys and its claims against our Firebase project, then trust the phone number in it.
//! No service account or Admin SDK is needed.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use ring::signature::{RSA_PKCS1_2048_8192_SHA256, RsaPublicKeyComponents};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use utoipa::ToSchema;

use crate::error::ApiError;

const JWKS_URL: &str = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
/// Clock skew tolerated on `iat` and `auth_time`.
const SKEW_SECONDS: i64 = 60;
/// A sign-in must be recent: the token is exchanged for our own session right away.
const MAX_AUTH_AGE_SECONDS: i64 = 15 * 60;

/// What the browser needs to start Firebase Authentication.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseWebConfig {
    pub api_key: String,
    pub auth_domain: String,
    pub project_id: String,
}

#[derive(Clone, Debug)]
pub struct VerifiedPhone {
    pub uid: String,
    pub phone_e164: String,
}

/// RSA public keys by key ID: (modulus, exponent).
type KeySet = HashMap<String, (Vec<u8>, Vec<u8>)>;

pub struct Firebase {
    pub web: FirebaseWebConfig,
    /// Google's signing keys, when fetched, and how long they may be cached.
    keys: RwLock<Option<(Instant, Duration, KeySet)>>,
}

#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
}

#[derive(Deserialize)]
struct Claims {
    aud: String,
    iss: String,
    sub: String,
    exp: i64,
    iat: i64,
    auth_time: i64,
    phone_number: Option<String>,
    firebase: Option<FirebaseClaim>,
}

#[derive(Deserialize)]
struct FirebaseClaim {
    sign_in_provider: Option<String>,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

fn invalid() -> ApiError {
    ApiError::Forbidden("That sign-in did not verify. Try again.".into())
}

impl Firebase {
    pub fn new(web: FirebaseWebConfig) -> Self {
        Self { web, keys: RwLock::new(None) }
    }

    async fn key(&self, http: &reqwest::Client, kid: &str) -> Result<(Vec<u8>, Vec<u8>), ApiError> {
        if let Some((fetched, max_age, keys)) = self.keys.read().await.as_ref()
            && fetched.elapsed() < *max_age
            && let Some(key) = keys.get(kid)
        {
            return Ok(key.clone());
        }
        let response = http.get(JWKS_URL).send().await.map_err(|e| ApiError::internal(anyhow::anyhow!("Google signing keys: {e}")))?;
        let max_age = response
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').find_map(|p| p.trim().strip_prefix("max-age=")?.parse::<u64>().ok()))
            .map_or(Duration::from_secs(3600), Duration::from_secs);
        let jwks: Jwks = response.json().await.map_err(|e| ApiError::internal(anyhow::anyhow!("Google signing keys: {e}")))?;
        let mut keys = HashMap::new();
        for jwk in jwks.keys {
            if let (Ok(n), Ok(e)) = (B64.decode(&jwk.n), B64.decode(&jwk.e)) {
                keys.insert(jwk.kid, (n, e));
            }
        }
        let key = keys.get(kid).cloned();
        *self.keys.write().await = Some((Instant::now(), max_age, keys));
        key.ok_or_else(invalid)
    }

    /// Verify a Firebase ID token from a phone sign-in.
    pub async fn verify(&self, http: &reqwest::Client, token: &str) -> Result<VerifiedPhone, ApiError> {
        let mut parts = token.split('.');
        let (Some(header), Some(payload), Some(signature), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
            return Err(invalid());
        };
        let header: Header = serde_json::from_slice(&B64.decode(header).map_err(|_| invalid())?).map_err(|_| invalid())?;
        if header.alg != "RS256" {
            return Err(invalid());
        }
        let (n, e) = self.key(http, &header.kid).await?;
        let signature = B64.decode(signature).map_err(|_| invalid())?;
        let signing_input = &token[..token.rfind('.').ok_or_else(invalid)?];
        RsaPublicKeyComponents { n: &n, e: &e }
            .verify(&RSA_PKCS1_2048_8192_SHA256, signing_input.as_bytes(), &signature)
            .map_err(|_| invalid())?;
        let claims: Claims = serde_json::from_slice(&B64.decode(payload).map_err(|_| invalid())?).map_err(|_| invalid())?;
        check_claims(&claims, &self.web.project_id, chrono::Utc::now().timestamp())
    }
}

fn check_claims(claims: &Claims, project_id: &str, now: i64) -> Result<VerifiedPhone, ApiError> {
    let issuer = format!("https://securetoken.google.com/{project_id}");
    let valid = claims.aud == project_id
        && claims.iss == issuer
        && !claims.sub.is_empty()
        && claims.sub.len() <= 128
        && claims.exp > now
        && claims.iat <= now + SKEW_SECONDS
        && claims.auth_time <= now + SKEW_SECONDS
        && now - claims.auth_time <= MAX_AUTH_AGE_SECONDS
        && claims.firebase.as_ref().and_then(|f| f.sign_in_provider.as_deref()) == Some("phone");
    if !valid {
        return Err(invalid());
    }
    let phone = claims.phone_number.clone().filter(|p| p.starts_with('+') && p.len() <= 16).ok_or_else(invalid)?;
    Ok(VerifiedPhone { uid: claims.sub.clone(), phone_e164: phone })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(now: i64) -> Claims {
        Claims {
            aud: "pehle-live".into(),
            iss: "https://securetoken.google.com/pehle-live".into(),
            sub: "uid-1".into(),
            exp: now + 3600,
            iat: now - 10,
            auth_time: now - 10,
            phone_number: Some("+919810000000".into()),
            firebase: Some(FirebaseClaim { sign_in_provider: Some("phone".into()) }),
        }
    }

    #[test]
    fn accepts_a_fresh_phone_sign_in_for_our_project() {
        let now = 1_800_000_000;
        let verified = check_claims(&claims(now), "pehle-live", now).unwrap();
        assert_eq!(verified.phone_e164, "+919810000000");
        assert_eq!(verified.uid, "uid-1");
    }

    #[test]
    fn rejects_other_projects_stale_sign_ins_and_non_phone_providers() {
        let now = 1_800_000_000;
        assert!(check_claims(&claims(now), "someone-else", now).is_err());
        assert!(check_claims(&Claims { exp: now - 1, ..claims(now) }, "pehle-live", now).is_err());
        assert!(check_claims(&Claims { auth_time: now - 3600, ..claims(now) }, "pehle-live", now).is_err());
        assert!(check_claims(&Claims { phone_number: None, ..claims(now) }, "pehle-live", now).is_err());
        let google = Claims { firebase: Some(FirebaseClaim { sign_in_provider: Some("google.com".into()) }), ..claims(now) };
        assert!(check_claims(&google, "pehle-live", now).is_err());
    }
}
