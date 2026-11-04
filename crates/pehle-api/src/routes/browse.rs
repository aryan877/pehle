//! Public discovery: the home feed and shop pages.

use axum::Json;
use axum::extract::{Path, Query, State};
use pehle_db::{Principal, PublicShop};
use pehle_db::browse::{BrowseFeed, BrowseQuery, ShopPage};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::auth::{MaybeSignedIn, SignedInBuyer};
use crate::error::{ApiResult, ErrorBody};
use crate::routes::studio::CATEGORIES;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
pub struct BrowseParams {
    /// A shop category such as `sarees` or `thrift`.
    #[serde(default)]
    category: Option<String>,
    /// Words to find in drop titles, item titles and shop names.
    #[serde(default)]
    q: Option<String>,
    /// Include the demo shop (the home page shows it in its own banner instead).
    #[serde(default)]
    demo: Option<bool>,
}

/// What is live now, what is coming up, items to claim, and recent drops.
#[utoipa::path(get, path = "/api/v1/browse", tag = "public", params(BrowseParams), responses((status = 200, body = BrowseFeed)))]
pub async fn browse(
    State(state): State<AppState>,
    MaybeSignedIn(principal): MaybeSignedIn,
    Query(params): Query<BrowseParams>,
) -> ApiResult<Json<BrowseFeed>> {
    let category = params.category.as_deref().filter(|c| CATEGORIES.contains(c));
    let search = params.q.as_deref().map(str::trim).filter(|q| (2..=60).contains(&q.chars().count()));
    let viewer = match principal {
        Some(Principal::Buyer(buyer)) => Some(buyer.id),
        _ => None,
    };
    Ok(Json(state.db.browse(BrowseQuery { category, search, include_demo: params.demo.unwrap_or(false), viewer }).await?))
}

/// Shops in the signed-in buyer's club list.
#[utoipa::path(get, path = "/api/v1/me/following", tag = "room", responses((status = 200, body = Vec<PublicShop>)))]
pub async fn following(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer) -> ApiResult<Json<Vec<PublicShop>>> {
    Ok(Json(state.db.following(buyer.id).await?))
}

/// A shop's public page: its record, drops and catalogue.
#[utoipa::path(get, path = "/api/v1/shops/by-handle/{handle}/page", tag = "public", params(("handle" = String, Path)),
    responses((status = 200, body = ShopPage), (status = 404, body = ErrorBody)))]
pub async fn shop_page(State(state): State<AppState>, MaybeSignedIn(principal): MaybeSignedIn, Path(handle): Path<String>) -> ApiResult<Json<ShopPage>> {
    let viewer = match principal {
        Some(Principal::Buyer(buyer)) => Some(buyer.id),
        _ => None,
    };
    Ok(Json(state.db.shop_page(&handle, viewer).await?))
}
