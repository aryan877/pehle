//! Browser push subscriptions for buyers (drop alerts, "it's yours") and sellers (payments).

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use pehle_db::Principal;
use pehle_db::audience::PushOwner;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::MaybeSignedIn;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::state::AppState;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushKey {
    /// Pass to `pushManager.subscribe({ applicationServerKey })`. Null when push is not configured.
    pub public_key: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/push/key", tag = "session", responses((status = 200, body = PushKey)))]
pub async fn key(State(state): State<AppState>) -> Json<PushKey> {
    Json(PushKey { public_key: state.vapid.as_ref().map(|v| v.public_key().to_string()) })
}

#[derive(Deserialize, ToSchema)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

/// The JSON a browser's `PushSubscription.toJSON()` returns.
#[derive(Deserialize, ToSchema)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
}

#[utoipa::path(post, path = "/api/v1/push/subscriptions", tag = "session", request_body = Subscription,
    responses((status = 204), (status = 401, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn subscribe(
    State(state): State<AppState>,
    MaybeSignedIn(principal): MaybeSignedIn,
    headers: HeaderMap,
    Json(body): Json<Subscription>,
) -> ApiResult<StatusCode> {
    let owner = match principal {
        Some(Principal::Buyer(buyer)) => PushOwner::Buyer(buyer.id),
        Some(Principal::Staff(staff)) => PushOwner::Staff(staff.id),
        None => return Err(ApiError::Unauthorized),
    };
    let user_agent = headers.get("user-agent").and_then(|v| v.to_str().ok());
    state.db.save_push_subscription(owner, &body.endpoint, &body.keys.p256dh, &body.keys.auth, user_agent).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub struct Unsubscribe {
    pub endpoint: String,
}

#[utoipa::path(delete, path = "/api/v1/push/subscriptions", tag = "session", request_body = Unsubscribe, responses((status = 204)))]
pub async fn unsubscribe(State(state): State<AppState>, Json(body): Json<Unsubscribe>) -> ApiResult<StatusCode> {
    state.db.delete_push_subscription(&body.endpoint).await?;
    Ok(StatusCode::NO_CONTENT)
}
