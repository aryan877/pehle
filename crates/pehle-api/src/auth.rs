//! Sessions, request extractors and the CSRF guard.
//!
//! A session is a random 256-bit token in an HttpOnly cookie; the database stores only its SHA-256.
//! Mutating API requests must carry `X-Pehle: 1`, which a cross-site form or image tag cannot send.

use axum::extract::{FromRef, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use pehle_db::{Buyer, Principal, Staff};
use rand::RngCore;

use crate::error::ApiError;
use crate::state::AppState;

pub const SESSION_COOKIE: &str = "pehle_session";
pub const BUYER_SESSION_DAYS: i64 = 180;
pub const STAFF_SESSION_DAYS: i64 = 30;

pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn session_cookie(state: &AppState, token: String, days: i64) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time_days(days))
        .build()
}

pub fn clear_cookie(state: &AppState) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, ""))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time_days(0))
        .build()
}

fn time_days(days: i64) -> time::Duration {
    time::Duration::days(days)
}

/// Whoever is signed in, if anyone.
pub struct MaybeSignedIn(pub Option<Principal>);

pub struct SignedInBuyer(pub Buyer);

pub struct SignedInStaff(pub Staff);

async fn principal(parts: &mut Parts, state: &AppState) -> Result<Option<Principal>, ApiError> {
    if let Some(cached) = parts.extensions.get::<Option<Principal>>() {
        return Ok(cached.clone());
    }
    let jar = CookieJar::from_headers(&parts.headers);
    let principal = match jar.get(SESSION_COOKIE) {
        Some(cookie) if !cookie.value().is_empty() => state.db.session_principal(cookie.value()).await?,
        _ => None,
    };
    parts.extensions.insert(principal.clone());
    Ok(principal)
}

impl<S> FromRequestParts<S> for MaybeSignedIn
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self(principal(parts, &AppState::from_ref(state)).await?))
    }
}

impl<S> FromRequestParts<S> for SignedInBuyer
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match principal(parts, &AppState::from_ref(state)).await? {
            Some(Principal::Buyer(buyer)) => Ok(Self(buyer)),
            _ => Err(ApiError::Unauthorized),
        }
    }
}

impl<S> FromRequestParts<S> for SignedInStaff
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match principal(parts, &AppState::from_ref(state)).await? {
            Some(Principal::Staff(staff)) => Ok(Self(staff)),
            Some(Principal::Buyer(_)) => Err(ApiError::Forbidden("This page is for shop teams. Sign in with Google.".into())),
            None => Err(ApiError::Unauthorized),
        }
    }
}

/// Refuse state-changing API calls that lack the `X-Pehle: 1` header.
pub async fn csrf_guard(request: Request, next: Next) -> Response {
    let safe = matches!(*request.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let is_api = request.uri().path().starts_with("/api/");
    let has_header = request.headers().get("x-pehle").is_some_and(|v| v == "1");
    if is_api && !safe && !has_header {
        return (StatusCode::FORBIDDEN, "missing X-Pehle header").into_response();
    }
    next.run(request).await
}
