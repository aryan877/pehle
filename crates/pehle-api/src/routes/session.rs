//! Who is signed in, buyer guest sessions, staff sign-in and the Nexconn chat token.

use axum::Json;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use chrono::Duration;
use pehle_db::people::VerifiedPhone;
use pehle_db::sessions::SessionOwner;
use pehle_db::{Buyer, Principal, ShopMembership, Staff};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::{self, MaybeSignedIn, clear_cookie, new_token, session_cookie};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::state::AppState;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Me {
    Anonymous,
    Buyer { buyer: Buyer },
    Staff { staff: Staff, shops: Vec<ShopMembership> },
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub me: Me,
    /// Which sign-in methods this server offers.
    pub google_sign_in: bool,
    /// Firebase settings for phone sign-in; absent when the server has no Firebase project.
    pub phone_sign_in: Option<crate::firebase::FirebaseWebConfig>,
    pub dev_sign_in: bool,
    /// False when the server has no Nexconn App Key yet; chat then runs in preview mode.
    pub chat_live: bool,
    /// Browser push key; absent when notifications are not configured.
    pub push_key: Option<String>,
    /// The public demo drop is available at /try.
    pub demo: bool,
}

async fn me_for(state: &AppState, principal: Option<Principal>) -> ApiResult<Me> {
    Ok(match principal {
        None => Me::Anonymous,
        Some(Principal::Buyer(buyer)) => Me::Buyer { buyer },
        Some(Principal::Staff(staff)) => {
            let shops = state.db.shops_for_staff(staff.id).await?;
            Me::Staff { staff, shops }
        }
    })
}

fn session_info(state: &AppState, me: Me) -> SessionInfo {
    SessionInfo {
        me,
        google_sign_in: state.config.google.is_some(),
        phone_sign_in: state.firebase.as_ref().map(|f| f.web.clone()),
        dev_sign_in: state.config.dev_login,
        chat_live: state.nexconn.is_live(),
        push_key: state.vapid.as_ref().map(|v| v.public_key().to_string()),
        demo: state.config.demo,
    }
}

pub async fn session_info_for(state: &AppState, principal: Option<Principal>) -> ApiResult<SessionInfo> {
    Ok(session_info(state, me_for(state, principal).await?))
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers.get("user-agent").and_then(|v| v.to_str().ok()).map(|s| s.chars().take(300).collect())
}

#[utoipa::path(get, path = "/api/v1/session", tag = "session", responses((status = 200, body = SessionInfo)))]
pub async fn get_session(State(state): State<AppState>, MaybeSignedIn(principal): MaybeSignedIn) -> ApiResult<Json<SessionInfo>> {
    let me = me_for(&state, principal).await?;
    Ok(Json(session_info(&state, me)))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinAsBuyer {
    /// Shown next to claims in the room. 1 to 40 characters.
    pub display_name: String,
    /// ISO 639-1 code for translation, for example `hi` or `en`.
    #[serde(default)]
    pub preferred_language: Option<String>,
}

fn clean_name(name: &str) -> ApiResult<String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = name.chars().count();
    if !(1..=40).contains(&length) {
        return Err(ApiError::Unprocessable("Use a name between 1 and 40 characters.".into()));
    }
    Ok(name)
}

fn clean_language(language: Option<&str>) -> String {
    match language.map(str::trim).map(str::to_lowercase) {
        Some(l) if (2..=3).contains(&l.len()) && l.chars().all(|c| c.is_ascii_lowercase()) => l,
        _ => "en".into(),
    }
}

/// Change the signed-in buyer's display name and language. In local development (no Google) this
/// also creates a buyer from just a name.
#[utoipa::path(post, path = "/api/v1/session/buyer", tag = "session", request_body = JoinAsBuyer,
    responses((status = 200, body = SessionInfo), (status = 422, body = ErrorBody)))]
pub async fn join_as_buyer(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    MaybeSignedIn(principal): MaybeSignedIn,
    Json(body): Json<JoinAsBuyer>,
) -> ApiResult<(CookieJar, Json<SessionInfo>)> {
    let name = clean_name(&body.display_name)?;
    let language = clean_language(body.preferred_language.as_deref());
    // An existing buyer renames instead of creating a second identity.
    if let Some(Principal::Buyer(buyer)) = principal {
        let buyer = state.db.rename_buyer(buyer.id, &name, &language).await?;
        let _ = state.nexconn.update_user(&buyer.nexconn_user_id, &buyer.display_name, None).await;
        return Ok((jar, Json(session_info(&state, Me::Buyer { buyer }))));
    }
    // New buyers sign in with Google in production; the name-only join is for local development.
    if !state.config.dev_login {
        return Err(ApiError::Forbidden("Sign in with Google to join.".into()));
    }
    let buyer = state.db.create_buyer(&name, &language).await?;
    let token = new_token();
    state
        .db
        .create_session(&token, SessionOwner::Buyer(buyer.id), Duration::days(auth::BUYER_SESSION_DAYS), user_agent(&headers).as_deref())
        .await?;
    let jar = jar.add(session_cookie(&state, token, auth::BUYER_SESSION_DAYS));
    Ok((jar, Json(session_info(&state, Me::Buyer { buyer }))))
}

#[utoipa::path(post, path = "/api/v1/session/logout", tag = "session", responses((status = 204)))]
pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> ApiResult<(CookieJar, axum::http::StatusCode)> {
    if let Some(cookie) = jar.get(auth::SESSION_COOKIE) {
        state.db.delete_session(cookie.value()).await?;
    }
    Ok((jar.add(clear_cookie(&state)), axum::http::StatusCode::NO_CONTENT))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatCredentials {
    pub app_key: String,
    pub user_id: String,
    pub token: String,
    /// False when the server has no Nexconn App Key; the client should show a preview banner.
    pub live: bool,
}

/// Cookie holding a signed-out viewer's anonymous chat identity, so a refresh keeps the same one.
const VIEWER_COOKIE: &str = "pehle_viewer";

/// A Nexconn token issued by the server. Signed-out visitors get a read-only viewer identity
/// (`v_…`): they can watch the room and its chat, and the pre-messaging webhook refuses anything
/// they try to send.
#[utoipa::path(get, path = "/api/v1/chat/token", tag = "session", responses((status = 200, body = ChatCredentials)))]
pub async fn chat_token(
    State(state): State<AppState>,
    jar: CookieJar,
    MaybeSignedIn(principal): MaybeSignedIn,
) -> ApiResult<(CookieJar, Json<ChatCredentials>)> {
    let (jar, user_id, name, avatar) = match principal {
        Some(Principal::Buyer(b)) => (jar, b.nexconn_user_id, b.display_name, b.avatar_url),
        Some(Principal::Staff(s)) => (jar, s.nexconn_user_id, s.display_name, s.avatar_url),
        None => {
            let existing = jar
                .get(VIEWER_COOKIE)
                .map(|c| c.value().to_string())
                .filter(|v| v.len() == 32 && v.chars().all(|c| c.is_ascii_hexdigit()));
            let id = existing.unwrap_or_else(|| {
                use rand::RngCore;
                let mut bytes = [0u8; 16];
                rand::rng().fill_bytes(&mut bytes);
                bytes.iter().map(|b| format!("{b:02x}")).collect()
            });
            let cookie = Cookie::build((VIEWER_COOKIE, id.clone()))
                .http_only(true)
                .secure(state.config.cookie_secure)
                .same_site(SameSite::Lax)
                .path("/")
                .max_age(time::Duration::days(30))
                .build();
            (jar.add(cookie), format!("v{id}"), "Viewer".to_string(), None)
        }
    };
    let token = state.chat_token(&user_id, &name, avatar.as_deref()).await?;
    let credentials = ChatCredentials { app_key: state.nexconn.app_key().to_string(), user_id, token, live: state.nexconn.is_live() };
    Ok((jar, Json(credentials)))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DevSignIn {
    pub email: String,
    pub display_name: String,
}

/// Local development only: sign in as a shop team member without Google.
#[utoipa::path(post, path = "/api/v1/auth/dev", tag = "session", request_body = DevSignIn,
    responses((status = 200, body = SessionInfo), (status = 404, body = ErrorBody)))]
pub async fn dev_sign_in(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<DevSignIn>,
) -> ApiResult<(CookieJar, Json<SessionInfo>)> {
    if !state.config.dev_login {
        return Err(ApiError::NotFound("Not found.".into()));
    }
    let staff = state.db.upsert_dev_staff(body.email.trim(), &clean_name(&body.display_name)?).await?;
    let (jar, me) = start_staff_session(&state, jar, &headers, staff).await?;
    Ok((jar, Json(session_info(&state, me))))
}

async fn start_staff_session(state: &AppState, jar: CookieJar, headers: &HeaderMap, staff: Staff) -> ApiResult<(CookieJar, Me)> {
    let token = new_token();
    state
        .db
        .create_session(&token, SessionOwner::Staff(staff.id), Duration::days(auth::STAFF_SESSION_DAYS), user_agent(headers).as_deref())
        .await?;
    let jar = jar.add(session_cookie(state, token, auth::STAFF_SESSION_DAYS));
    let shops = state.db.shops_for_staff(staff.id).await?;
    Ok((jar, Me::Staff { staff, shops }))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhoneSignIn {
    /// The Firebase ID token from `user.getIdToken()` after the SMS code was confirmed.
    pub id_token: String,
    /// `buyer` (default) or `staff`.
    #[serde(default, rename = "as")]
    pub role: Option<String>,
    /// Shown in rooms for new accounts. Defaults to "Buyer 1234" from the number's last digits.
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Sign in with a phone number verified by Firebase Authentication.
#[utoipa::path(post, path = "/api/v1/auth/phone", tag = "session", request_body = PhoneSignIn,
    responses((status = 200, body = SessionInfo), (status = 403, body = ErrorBody), (status = 404, body = ErrorBody)))]
pub async fn phone_sign_in(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<PhoneSignIn>,
) -> ApiResult<(CookieJar, Json<SessionInfo>)> {
    let firebase = state.firebase.as_ref().ok_or_else(|| ApiError::NotFound("Phone sign-in is not set up on this server.".into()))?;
    let verified = firebase.verify(&state.http, body.id_token.trim()).await?;
    let phone = VerifiedPhone { firebase_uid: &verified.uid, phone_e164: &verified.phone_e164 };
    let name = match body.display_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => clean_name(n)?,
        None => String::new(),
    };
    if body.role.as_deref() == Some("staff") {
        let staff = state.db.upsert_phone_staff(phone, &name).await?;
        let (jar, me) = start_staff_session(&state, jar, &headers, staff).await?;
        return Ok((jar, Json(session_info(&state, me))));
    }
    let buyer = state.db.upsert_phone_buyer(phone, &name).await?;
    let token = new_token();
    state
        .db
        .create_session(&token, SessionOwner::Buyer(buyer.id), Duration::days(auth::BUYER_SESSION_DAYS), user_agent(&headers).as_deref())
        .await?;
    let jar = jar.add(session_cookie(&state, token, auth::BUYER_SESSION_DAYS));
    Ok((jar, Json(session_info(&state, Me::Buyer { buyer }))))
}

// ---------------------------------------------------------------------------------------------
// Google sign-in (authorization code flow with a state cookie). The ID token comes straight from
// Google's token endpoint over TLS, so it is trusted without verifying its signature locally.
// ---------------------------------------------------------------------------------------------

const OAUTH_STATE_COOKIE: &str = "pehle_oauth_state";

#[derive(Deserialize)]
pub struct GoogleStart {
    #[serde(default)]
    next: Option<String>,
    /// `buyer` to claim and chat in rooms, or `staff` (default) for the seller studio.
    #[serde(default, rename = "as")]
    role: Option<String>,
}

fn safe_next(next: Option<&str>) -> String {
    match next {
        Some(n) if n.starts_with('/') && !n.starts_with("//") && n.len() < 200 => n.to_string(),
        _ => "/studio".to_string(),
    }
}

pub async fn google_start(State(state): State<AppState>, jar: CookieJar, Query(query): Query<GoogleStart>) -> ApiResult<Response> {
    let google = state.config.google.as_ref().ok_or_else(|| ApiError::NotFound("Google sign-in is not set up.".into()))?;
    let csrf = new_token();
    let next = safe_next(query.next.as_deref());
    let role = if query.role.as_deref() == Some("buyer") { "buyer" } else { "staff" };
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", &google.client_id)
        .append_pair("redirect_uri", &state.config.google_redirect_uri())
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &csrf)
        .append_pair("prompt", "select_account");
    let cookie = Cookie::build((OAUTH_STATE_COOKIE, format!("{csrf}|{role}|{next}")))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path("/api/v1/auth/google")
        .max_age(time::Duration::minutes(10))
        .build();
    Ok((jar.add(cookie), Redirect::to(url.as_str())).into_response())
}

#[derive(Deserialize)]
pub struct GoogleCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct GoogleTokens {
    id_token: String,
}

#[derive(Deserialize)]
struct GoogleClaims {
    sub: String,
    email: String,
    #[serde(default)]
    email_verified: bool,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    picture: Option<String>,
    #[serde(default)]
    given_name: Option<String>,
    #[serde(default)]
    family_name: Option<String>,
    aud: String,
}

/// "Priya Sharma" -> "Priya S.": enough to recognise yourself in a public room.
fn public_name(claims: &GoogleClaims) -> String {
    let first = claims
        .given_name
        .clone()
        .or_else(|| claims.name.as_deref().and_then(|n| n.split_whitespace().next()).map(str::to_string))
        .unwrap_or_else(|| claims.email.split('@').next().unwrap_or("Buyer").to_string());
    let initial = claims.family_name.as_deref().and_then(|f| f.chars().next());
    let name = match initial {
        Some(c) => format!("{first} {}.", c.to_uppercase()),
        None => first,
    };
    name.chars().take(40).collect()
}

fn decode_id_token_claims(id_token: &str) -> ApiResult<GoogleClaims> {
    use base64::Engine;
    let payload = id_token.split('.').nth(1).ok_or_else(|| ApiError::BadRequest("Malformed Google token.".into()))?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| ApiError::BadRequest("Malformed Google token.".into()))?;
    serde_json::from_slice(&bytes).map_err(|_| ApiError::BadRequest("Malformed Google token.".into()))
}

pub async fn google_callback(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Query(query): Query<GoogleCallback>,
) -> ApiResult<Response> {
    let google = state.config.google.as_ref().ok_or_else(|| ApiError::NotFound("Google sign-in is not set up.".into()))?;
    let saved = jar.get(OAUTH_STATE_COOKIE).map(|c| c.value().to_string()).unwrap_or_default();
    let mut parts = saved.splitn(3, '|');
    let (saved_state, role, next) = (
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or("staff"),
        parts.next().unwrap_or("/studio"),
    );
    let jar = jar.remove(Cookie::build(OAUTH_STATE_COOKIE).path("/api/v1/auth/google"));
    if query.error.is_some() {
        return Ok((jar, Redirect::to(&safe_next(Some(next)))).into_response());
    }
    let (Some(code), Some(returned_state)) = (query.code, query.state) else {
        return Err(ApiError::BadRequest("Google did not return a sign-in code.".into()));
    };
    if saved_state.is_empty() || saved_state != returned_state {
        return Err(ApiError::BadRequest("Sign-in expired. Start again.".into()));
    }

    let tokens: GoogleTokens = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", google.client_id.as_str()),
            ("client_secret", google.client_secret.as_str()),
            ("redirect_uri", state.config.google_redirect_uri().as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(ApiError::internal)?
        .json()
        .await
        .map_err(ApiError::internal)?;
    let claims = decode_id_token_claims(&tokens.id_token)?;
    if claims.aud != google.client_id || !claims.email_verified {
        return Err(ApiError::Forbidden("Use a verified Google account.".into()));
    }
    let jar = if role == "buyer" {
        let buyer = state
            .db
            .upsert_google_buyer(&claims.sub, &claims.email, &public_name(&claims), claims.picture.as_deref())
            .await?;
        let token = new_token();
        state
            .db
            .create_session(&token, SessionOwner::Buyer(buyer.id), Duration::days(auth::BUYER_SESSION_DAYS), user_agent(&headers).as_deref())
            .await?;
        jar.add(session_cookie(&state, token, auth::BUYER_SESSION_DAYS))
    } else {
        let name = claims.name.clone().unwrap_or_else(|| claims.email.split('@').next().unwrap_or("Seller").to_string());
        let staff = state.db.upsert_google_staff(&claims.sub, &claims.email, &name, claims.picture.as_deref()).await?;
        start_staff_session(&state, jar, &headers, staff).await?.0
    };
    Ok((jar, Redirect::to(&safe_next(Some(next)))).into_response())
}
