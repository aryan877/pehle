//! The public demo drop for judges and new sellers: one tap to join, one tap to race.

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use axum_extra::extract::CookieJar;
use pehle_db::Principal;
use pehle_db::sessions::SessionOwner;
use rand::Rng;

use crate::auth::{MaybeSignedIn, new_token, session_cookie};
use crate::demo::DemoRace;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::routes::session::{SessionInfo, session_info_for};
use crate::state::AppState;

/// Start a race for a fresh piece in the demo drop, or join the one already running.
#[utoipa::path(post, path = "/api/v1/demo/race", tag = "room",
    responses((status = 200, body = DemoRace), (status = 404, body = ErrorBody)))]
pub async fn race(State(state): State<AppState>) -> ApiResult<Json<DemoRace>> {
    if !state.config.demo {
        return Err(ApiError::NotFound("The demo is switched off on this server.".into()));
    }
    Ok(Json(crate::demo::race(&state).await.map_err(ApiError::internal)?))
}

/// Try the seller side: a private practice shop with sample items, signed in as its owner. Open the
/// drop link in another browser (or a private window) to race yourself as a buyer.
#[utoipa::path(post, path = "/api/v1/demo/seller", tag = "session", responses((status = 200, body = SessionInfo)))]
pub async fn seller(
    State(state): State<AppState>,
    MaybeSignedIn(principal): MaybeSignedIn,
    jar: CookieJar,
    headers: HeaderMap,
) -> ApiResult<(CookieJar, Json<SessionInfo>)> {
    if !state.config.demo {
        return Err(ApiError::NotFound("The demo is switched off on this server.".into()));
    }
    if let Some(principal @ Principal::Staff(_)) = principal {
        return Ok((jar, Json(session_info_for(&state, Some(principal)).await?)));
    }
    let id: String = {
        use rand::RngCore;
        let mut bytes = [0u8; 6];
        rand::rng().fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    };
    let staff = state.db.upsert_dev_staff(&format!("practice-{id}@try.pehle.app"), "Practice seller").await?;
    crate::demo::practice_shop(&state, staff.id).await.map_err(ApiError::internal)?;
    let token = new_token();
    let user_agent = headers.get("user-agent").and_then(|v| v.to_str().ok());
    state.db.create_session(&token, SessionOwner::Staff(staff.id), chrono::Duration::days(2), user_agent).await?;
    let jar = jar.add(session_cookie(&state, token, 2));
    Ok((jar, Json(session_info_for(&state, Some(Principal::Staff(staff))).await?)))
}

/// Join the demo as a guest buyer without signing in. Guests can only claim in the demo shop.
/// Already signed-in people keep their session.
#[utoipa::path(post, path = "/api/v1/demo/join", tag = "session", responses((status = 200, body = SessionInfo)))]
pub async fn join(
    State(state): State<AppState>,
    MaybeSignedIn(principal): MaybeSignedIn,
    jar: CookieJar,
    headers: HeaderMap,
) -> ApiResult<(CookieJar, Json<SessionInfo>)> {
    if !state.config.demo {
        return Err(ApiError::NotFound("The demo is switched off on this server.".into()));
    }
    if let Some(principal @ Principal::Buyer(_)) = principal {
        return Ok((jar, Json(session_info_for(&state, Some(principal)).await?)));
    }
    let name = format!("Guest {}", rand::rng().random_range(1000..10000));
    let buyer = state.db.create_demo_buyer(&name).await?;
    let token = new_token();
    let user_agent = headers.get("user-agent").and_then(|v| v.to_str().ok());
    state.db.create_session(&token, SessionOwner::Buyer(buyer.id), chrono::Duration::days(2), user_agent).await?;
    let jar = jar.add(session_cookie(&state, token, 2));
    Ok((jar, Json(session_info_for(&state, Some(Principal::Buyer(buyer))).await?)))
}
