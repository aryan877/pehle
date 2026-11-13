use axum::Json;
use axum::extract::{Path, State};
use pehle_db::approvals::Approval;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::SignedInStaff;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::state::AppState;

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/approvals", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = Vec<Approval>)))]
pub async fn pending(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<Vec<Approval>>> {
    if state.db.staff_role(shop_id, staff.id).await?.is_none() {
        return Err(ApiError::Forbidden("You are not on this shop's team.".into()));
    }
    Ok(Json(state.db.pending_approvals(shop_id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub approve: bool,
    /// Optional edited reply to post instead of the co-host's draft.
    #[serde(default)]
    pub reply: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/approvals/{approval_id}", tag = "studio", params(("approval_id" = Uuid, Path)), request_body = Decision,
    responses((status = 200, body = Approval), (status = 409, body = ErrorBody)))]
pub async fn decide(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(approval_id): Path<Uuid>,
    Json(body): Json<Decision>,
) -> ApiResult<Json<Approval>> {
    let approval = state.db.decide_approval(approval_id, staff.id, body.approve, body.reply.as_deref()).await?;
    if let Err(error) = crate::cohost::post_decision(&state, &approval).await {
        tracing::warn!(error = %format!("{error:#}"), "could not post approval decision");
    }
    Ok(Json(approval))
}
