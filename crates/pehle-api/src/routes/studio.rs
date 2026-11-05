//! Seller studio: shop settings, catalogue, lives and orders. Staff only.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use pehle_db::audience::Conversation;
use pehle_db::events::Stats;
use pehle_db::items::NewItem;
use pehle_db::lives::{DropInput, DropReport};
use pehle_db::orders::OrderFilter;
use pehle_db::shops::{ShopImage, ShopUpdate};
use pehle_db::{Item, ItemWithCounts, Live, OrderView, PublicItem, QueueEntry, Seller, StaffRole};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth::SignedInStaff;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::state::AppState;

/// Open channels Nexconn keeps for a day after they empty, so the waitlist chat survives the live.
const ROOM_TTL_MINUTES: u32 = 24 * 60;

async fn require_team(state: &AppState, shop_id: Uuid, staff_id: Uuid) -> ApiResult<StaffRole> {
    state
        .db
        .staff_role(shop_id, staff_id)
        .await?
        .ok_or_else(|| ApiError::Forbidden("You are not on this shop's team.".into()))
}

async fn live_for_team(state: &AppState, live_id: Uuid, staff_id: Uuid) -> ApiResult<Live> {
    let live = state.db.get_live(live_id).await?;
    require_team(state, live.seller_id, staff_id).await?;
    Ok(live)
}

// --- Shops -----------------------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewShop {
    /// Lowercase letters, digits and hyphens; 3 to 30 characters. Appears in links.
    pub handle: String,
    pub display_name: String,
    /// One of the shop categories, for example `sarees` or `thrift`.
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub upi_vpa: Option<String>,
    #[serde(default)]
    pub upi_payee_name: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/shops", tag = "studio", request_body = NewShop,
    responses((status = 200, body = Seller), (status = 409, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn create_shop(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Json(body): Json<NewShop>,
) -> ApiResult<Json<Seller>> {
    let handle = body.handle.trim().to_lowercase();
    if !(3..=30).contains(&handle.len())
        || !handle.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || handle.starts_with('-')
    {
        return Err(ApiError::Unprocessable("Use 3 to 30 lowercase letters, digits or hyphens for the handle.".into()));
    }
    check_category(&body.category)?;
    let seller = state
        .db
        .create_shop(
            staff.id,
            pehle_db::shops::NewShop {
                handle: &handle,
                display_name: body.display_name.trim(),
                category: &body.category,
                city: blank_to_none(&body.city),
                upi_vpa: blank_to_none(&body.upi_vpa),
                upi_payee_name: blank_to_none(&body.upi_payee_name),
            },
        )
        .await?;
    Ok(Json(seller))
}

/// Shop categories buyers can browse by.
pub const CATEGORIES: &[&str] = &["sarees", "ethnic", "thrift", "jewellery", "sneakers", "plants", "beauty", "home", "merch", "creator", "other"];

fn default_category() -> String {
    "other".into()
}

fn check_category(category: &str) -> ApiResult<()> {
    if CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(ApiError::Unprocessable("Pick one of the listed categories.".into()))
    }
}

fn check_media_path(path: &str) -> ApiResult<()> {
    if path.starts_with("media/") && !path.contains("..") && path.len() <= 120 {
        Ok(())
    } else {
        Err(ApiError::Unprocessable("Upload the photo first.".into()))
    }
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = Seller), (status = 403, body = ErrorBody)))]
pub async fn get_shop(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<Seller>> {
    require_team(&state, shop_id, staff.id).await?;
    Ok(Json(state.db.get_seller(shop_id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShopSettings {
    pub display_name: String,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub city: Option<String>,
    /// Paths returned by `POST /api/v1/media`.
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub upi_vpa: Option<String>,
    #[serde(default)]
    pub upi_payee_name: Option<String>,
    /// Minutes a winner has to pay before the next buyer is offered the item. 2 to 60.
    pub hold_minutes: i32,
    /// Unpaid holds one buyer may have at once in a live. 1 to 20.
    pub max_holds_per_buyer: i32,
    /// Shipping, cash on delivery, returns and sizing, in the seller's words. The co-host quotes these.
    #[serde(default)]
    pub policies: std::collections::BTreeMap<String, String>,
}

fn blank_to_none(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

#[utoipa::path(patch, path = "/api/v1/shops/{shop_id}", tag = "studio", params(("shop_id" = Uuid, Path)), request_body = ShopSettings,
    responses((status = 200, body = Seller), (status = 403, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn update_shop(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Json(body): Json<ShopSettings>,
) -> ApiResult<Json<Seller>> {
    if require_team(&state, shop_id, staff.id).await? != StaffRole::Owner {
        return Err(ApiError::Forbidden("Only the shop owner can change settings.".into()));
    }
    let policies: serde_json::Map<String, serde_json::Value> = body
        .policies
        .into_iter()
        .filter(|(k, v)| !k.trim().is_empty() && !v.trim().is_empty())
        .take(12)
        .map(|(k, v)| (k.trim().chars().take(40).collect(), serde_json::Value::String(v.trim().chars().take(600).collect())))
        .collect();
    let policies = serde_json::Value::Object(policies);
    check_category(&body.category)?;
    for (image, path) in [(ShopImage::Avatar, &body.avatar_path), (ShopImage::Cover, &body.cover_path)] {
        if let Some(path) = blank_to_none(path) {
            check_media_path(path)?;
            state.db.set_shop_image(shop_id, staff.id, image, path).await?;
        }
    }
    let seller = state
        .db
        .update_shop(
            shop_id,
            staff.id,
            ShopUpdate {
                display_name: body.display_name.trim(),
                tagline: blank_to_none(&body.tagline),
                category: &body.category,
                city: blank_to_none(&body.city),
                upi_vpa: blank_to_none(&body.upi_vpa),
                upi_payee_name: blank_to_none(&body.upi_payee_name),
                hold_minutes: body.hold_minutes,
                max_holds_per_buyer: body.max_holds_per_buyer,
                policies: &policies,
            },
        )
        .await?;
    Ok(Json(seller))
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/stats", tag = "studio", params(("shop_id" = Uuid, Path), StatsQuery),
    responses((status = 200, body = Stats)))]
pub async fn shop_stats(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Query(query): Query<StatsQuery>,
) -> ApiResult<Json<Stats>> {
    require_team(&state, shop_id, staff.id).await?;
    let since = query.days.filter(|d| (1..=365).contains(d)).map(|d| chrono::Utc::now() - chrono::Duration::days(d));
    Ok(Json(state.db.stats(Some(shop_id), since).await?))
}

#[derive(Deserialize, IntoParams)]
pub struct StatsQuery {
    /// Only count the last N days (1 to 365). Omit for all time.
    #[serde(default)]
    days: Option<i64>,
}

// --- Catalogue -------------------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    /// What the seller says on stream, for example `S12`. 1 to 8 letters or digits.
    pub code: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Price in paise (₹1 = 100).
    pub price_paise: i64,
    pub quantity: i32,
    /// A path returned by `POST /api/v1/media`.
    #[serde(default)]
    pub image_path: Option<String>,
    /// Up to eight more photo paths, shown after the cover.
    #[serde(default)]
    pub gallery_paths: Vec<String>,
    /// Shown only to buyers who win the item: a coupon code, a link, a thank-you note.
    #[serde(default)]
    pub winner_note: Option<String>,
}

fn validate_item(input: &ItemInput) -> ApiResult<()> {
    let code = input.code.trim();
    if code.is_empty() || code.len() > 8 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(ApiError::Unprocessable("Use 1 to 8 letters or digits for the item code.".into()));
    }
    if input.title.trim().is_empty() || input.title.chars().count() > 120 {
        return Err(ApiError::Unprocessable("Give the item a title of up to 120 characters.".into()));
    }
    if input.price_paise != 0 && !(100..=100_000_000).contains(&input.price_paise) {
        return Err(ApiError::Unprocessable("Price must be free (₹0) or between ₹1 and ₹10,00,000.".into()));
    }
    if !(1..=999).contains(&input.quantity) {
        return Err(ApiError::Unprocessable("Quantity must be between 1 and 999.".into()));
    }
    if let Some(path) = &input.image_path {
        check_media_path(path)?;
    }
    if input.gallery_paths.len() > 8 {
        return Err(ApiError::Unprocessable("Add up to nine photos per item.".into()));
    }
    for path in &input.gallery_paths {
        check_media_path(path)?;
    }
    if input.winner_note.as_deref().is_some_and(|n| n.chars().count() > 500) {
        return Err(ApiError::Unprocessable("Keep the winner note under 500 characters.".into()));
    }
    Ok(())
}

fn new_item(input: &ItemInput) -> NewItem<'_> {
    NewItem {
        code: input.code.trim(),
        title: input.title.trim(),
        description: blank_to_none(&input.description),
        price_paise: input.price_paise,
        quantity: input.quantity,
        image_path: input.image_path.as_deref(),
        gallery_paths: Some(&input.gallery_paths),
        winner_note: blank_to_none(&input.winner_note),
    }
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/items", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = Vec<ItemWithCounts>)))]
pub async fn list_items(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<Vec<ItemWithCounts>>> {
    require_team(&state, shop_id, staff.id).await?;
    Ok(Json(state.db.items_with_counts(shop_id).await?))
}

#[utoipa::path(post, path = "/api/v1/shops/{shop_id}/items", tag = "studio", params(("shop_id" = Uuid, Path)), request_body = ItemInput,
    responses((status = 200, body = Item), (status = 409, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn create_item(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Json(body): Json<ItemInput>,
) -> ApiResult<Json<Item>> {
    require_team(&state, shop_id, staff.id).await?;
    validate_item(&body)?;
    Ok(Json(state.db.create_item(shop_id, staff.id, new_item(&body)).await?))
}

#[utoipa::path(put, path = "/api/v1/shops/{shop_id}/items/{item_id}", tag = "studio",
    params(("shop_id" = Uuid, Path), ("item_id" = Uuid, Path)), request_body = ItemInput,
    responses((status = 200, body = Item), (status = 422, body = ErrorBody)))]
pub async fn update_item(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path((shop_id, item_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ItemInput>,
) -> ApiResult<Json<Item>> {
    require_team(&state, shop_id, staff.id).await?;
    validate_item(&body)?;
    if state.db.get_item(item_id).await?.seller_id != shop_id {
        return Err(ApiError::NotFound("Item not found.".into()));
    }
    Ok(Json(state.db.update_item(item_id, staff.id, new_item(&body)).await?))
}

#[utoipa::path(delete, path = "/api/v1/shops/{shop_id}/items/{item_id}", tag = "studio",
    params(("shop_id" = Uuid, Path), ("item_id" = Uuid, Path)), responses((status = 204), (status = 409, body = ErrorBody)))]
pub async fn archive_item(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path((shop_id, item_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    require_team(&state, shop_id, staff.id).await?;
    if state.db.get_item(item_id).await?.seller_id != shop_id {
        return Err(ApiError::NotFound("Item not found.".into()));
    }
    state.db.archive_item(item_id, staff.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// --- Lives -----------------------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// The seller's YouTube or Instagram live link, shown in the room.
    #[serde(default)]
    pub stream_url: Option<String>,
    /// When the drop starts. Upcoming drops appear on the home page with a Remind me button.
    #[serde(default)]
    pub scheduled_for: Option<chrono::DateTime<chrono::Utc>>,
    /// Catalogue items in this drop, in the order buyers see them.
    #[serde(default)]
    pub item_ids: Vec<Uuid>,
}

fn validate_live(input: &LiveInput) -> ApiResult<Option<String>> {
    if input.title.trim().is_empty() || input.title.chars().count() > 120 {
        return Err(ApiError::Unprocessable("Give the drop a title of up to 120 characters.".into()));
    }
    if input.description.as_deref().is_some_and(|d| d.chars().count() > 1000) {
        return Err(ApiError::Unprocessable("Keep the description under 1,000 characters.".into()));
    }
    match blank_to_none(&input.stream_url) {
        None => Ok(None),
        Some(url) => {
            let parsed = url::Url::parse(url).map_err(|_| ApiError::Unprocessable("Paste the full live link.".into()))?;
            if parsed.scheme() != "https" {
                return Err(ApiError::Unprocessable("The live link must start with https://".into()));
            }
            Ok(Some(parsed.to_string()))
        }
    }
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/lives", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = Vec<Live>)))]
pub async fn list_lives(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<Vec<Live>>> {
    require_team(&state, shop_id, staff.id).await?;
    Ok(Json(state.db.lives_for_seller(shop_id).await?))
}

#[utoipa::path(post, path = "/api/v1/shops/{shop_id}/lives", tag = "studio", params(("shop_id" = Uuid, Path)), request_body = LiveInput,
    responses((status = 200, body = Live), (status = 422, body = ErrorBody)))]
pub async fn create_live(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Json(body): Json<LiveInput>,
) -> ApiResult<Json<Live>> {
    let stream_url = validate_live(&body)?;
    let video = stream_url.as_deref().and_then(crate::youtube::video_id);
    Ok(Json(state.db.create_live(shop_id, staff.id, drop_input(&body, stream_url.as_deref(), video.as_deref())).await?))
}

fn drop_input<'a>(body: &'a LiveInput, stream_url: Option<&'a str>, video: Option<&'a str>) -> DropInput<'a> {
    DropInput {
        title: body.title.trim(),
        description: blank_to_none(&body.description),
        stream_url,
        youtube_video_id: video,
        scheduled_for: body.scheduled_for,
        item_ids: &body.item_ids,
    }
}

#[utoipa::path(patch, path = "/api/v1/lives/{live_id}", tag = "studio", params(("live_id" = Uuid, Path)), request_body = LiveInput,
    responses((status = 200, body = Live)))]
pub async fn update_live(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(live_id): Path<Uuid>,
    Json(body): Json<LiveInput>,
) -> ApiResult<Json<Live>> {
    live_for_team(&state, live_id, staff.id).await?;
    let stream_url = validate_live(&body)?;
    let video = stream_url.as_deref().and_then(crate::youtube::video_id);
    Ok(Json(state.db.update_live(live_id, staff.id, drop_input(&body, stream_url.as_deref(), video.as_deref())).await?))
}

/// The items announced for a drop, in order, with live availability.
#[utoipa::path(get, path = "/api/v1/lives/{live_id}/lineup", tag = "studio", params(("live_id" = Uuid, Path)),
    responses((status = 200, body = Vec<PublicItem>)))]
pub async fn lineup(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(live_id): Path<Uuid>) -> ApiResult<Json<Vec<PublicItem>>> {
    live_for_team(&state, live_id, staff.id).await?;
    Ok(Json(state.db.lineup(live_id).await?))
}

/// How the drop went: sell-through, money collected, non-payers replaced and leftover demand.
#[utoipa::path(get, path = "/api/v1/lives/{live_id}/report", tag = "studio", params(("live_id" = Uuid, Path)),
    responses((status = 200, body = DropReport)))]
pub async fn report(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(live_id): Path<Uuid>) -> ApiResult<Json<DropReport>> {
    live_for_team(&state, live_id, staff.id).await?;
    Ok(Json(state.db.drop_report(live_id).await?))
}

/// Buyer conversations for the shop's inbox, most recent first.
#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/conversations", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = Vec<Conversation>)))]
pub async fn conversations(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<Vec<Conversation>>> {
    require_team(&state, shop_id, staff.id).await?;
    Ok(Json(state.db.conversations_for_seller(shop_id).await?))
}

/// Orders between the shop and one buyer, for the inbox side panel.
#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/buyers/{buyer_id}/orders", tag = "studio",
    params(("shop_id" = Uuid, Path), ("buyer_id" = Uuid, Path)), responses((status = 200, body = Vec<OrderView>)))]
pub async fn buyer_orders(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path((shop_id, buyer_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Vec<OrderView>>> {
    require_team(&state, shop_id, staff.id).await?;
    Ok(Json(state.db.orders_between(shop_id, buyer_id).await?))
}

/// Create the drop's Nexconn open channel and give the team and co-host priority delivery.
pub async fn open_room(state: &AppState, live: &Live) -> ApiResult<()> {
    let seller = state.db.get_seller(live.seller_id).await?;
    state.nexconn.create_open_channel(&live.nexconn_channel_id, ROOM_TTL_MINUTES).await?;
    let mut priority = state.db.staff_chat_ids(seller.id).await?;
    priority.push(seller.cohost_user_id.clone());
    let priority: Vec<&str> = priority.iter().map(String::as_str).collect();
    if let Err(error) = state.nexconn.add_priority_senders(&live.nexconn_channel_id, &priority).await {
        tracing::warn!(%error, "could not set priority senders");
    }
    Ok(())
}

/// Create the Nexconn room, give the team and co-host priority, then open the live.
#[utoipa::path(post, path = "/api/v1/lives/{live_id}/start", tag = "studio", params(("live_id" = Uuid, Path)),
    responses((status = 200, body = Live), (status = 409, body = ErrorBody), (status = 502, body = ErrorBody)))]
pub async fn start_live(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(live_id): Path<Uuid>) -> ApiResult<Json<Live>> {
    let live = live_for_team(&state, live_id, staff.id).await?;
    open_room(&state, &live).await?;
    Ok(Json(state.db.start_live(live_id, staff.id).await?))
}

#[utoipa::path(post, path = "/api/v1/lives/{live_id}/end", tag = "studio", params(("live_id" = Uuid, Path)),
    responses((status = 200, body = Live), (status = 409, body = ErrorBody)))]
pub async fn end_live(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(live_id): Path<Uuid>) -> ApiResult<Json<Live>> {
    live_for_team(&state, live_id, staff.id).await?;
    Ok(Json(state.db.end_live(live_id, staff.id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub item_id: Uuid,
}

#[utoipa::path(post, path = "/api/v1/lives/{live_id}/drop", tag = "studio", params(("live_id" = Uuid, Path)), request_body = ItemRef,
    responses((status = 200, body = Item), (status = 409, body = ErrorBody)))]
pub async fn drop_item(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(live_id): Path<Uuid>,
    Json(body): Json<ItemRef>,
) -> ApiResult<Json<Item>> {
    live_for_team(&state, live_id, staff.id).await?;
    Ok(Json(state.db.drop_item(live_id, body.item_id, staff.id).await?))
}

#[utoipa::path(post, path = "/api/v1/lives/{live_id}/close", tag = "studio", params(("live_id" = Uuid, Path)), request_body = ItemRef,
    responses((status = 200, body = Item), (status = 409, body = ErrorBody)))]
pub async fn close_item(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(live_id): Path<Uuid>,
    Json(body): Json<ItemRef>,
) -> ApiResult<Json<Item>> {
    live_for_team(&state, live_id, staff.id).await?;
    Ok(Json(state.db.close_item(live_id, body.item_id, staff.id).await?))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveConsole {
    pub live: Live,
    pub room_url: String,
    #[schema(value_type = Object)]
    pub snapshot: serde_json::Value,
    pub queue: Vec<QueueEntry>,
    pub items: Vec<ItemWithCounts>,
}

/// Everything the seller's live console shows.
#[utoipa::path(get, path = "/api/v1/lives/{live_id}/console", tag = "studio", params(("live_id" = Uuid, Path)),
    responses((status = 200, body = LiveConsole)))]
pub async fn live_console(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(live_id): Path<Uuid>) -> ApiResult<Json<LiveConsole>> {
    let live = live_for_team(&state, live_id, staff.id).await?;
    let (snapshot, queue, items) = tokio::try_join!(
        state.db.live_snapshot(live_id),
        state.db.queue_for_live(live_id),
        state.db.items_with_counts(live.seller_id),
    )?;
    Ok(Json(LiveConsole { room_url: state.room_url(&live.slug), live, snapshot, queue, items }))
}

// --- Orders ----------------------------------------------------------------------------------

#[derive(Deserialize, IntoParams)]
pub struct OrdersQuery {
    /// `open` (default), `paid` or `all`.
    #[serde(default)]
    filter: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/orders", tag = "studio", params(("shop_id" = Uuid, Path), OrdersQuery),
    responses((status = 200, body = Vec<OrderView>)))]
pub async fn shop_orders(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Query(query): Query<OrdersQuery>,
) -> ApiResult<Json<Vec<OrderView>>> {
    require_team(&state, shop_id, staff.id).await?;
    let filter = match query.filter.as_deref() {
        Some("paid") => OrderFilter::Paid,
        Some("all") => OrderFilter::All,
        _ => OrderFilter::Open,
    };
    Ok(Json(state.db.orders_for_seller(shop_id, filter).await?))
}

#[utoipa::path(post, path = "/api/v1/orders/{order_id}/confirm", tag = "studio", params(("order_id" = Uuid, Path)),
    responses((status = 200, body = OrderView), (status = 409, body = ErrorBody)))]
pub async fn confirm_payment(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(order_id): Path<Uuid>) -> ApiResult<Json<OrderView>> {
    Ok(Json(state.db.confirm_payment(order_id, staff.id).await?))
}

#[derive(Deserialize, ToSchema)]
pub struct CancelOrder {
    pub reason: String,
}

#[utoipa::path(post, path = "/api/v1/orders/{order_id}/cancel", tag = "studio", params(("order_id" = Uuid, Path)), request_body = CancelOrder,
    responses((status = 200, body = OrderView), (status = 409, body = ErrorBody)))]
pub async fn cancel_order(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(order_id): Path<Uuid>,
    Json(body): Json<CancelOrder>,
) -> ApiResult<Json<OrderView>> {
    Ok(Json(state.db.cancel_order(order_id, staff.id, body.reason.trim()).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuyerRef {
    pub buyer_id: Uuid,
}

/// Stop a buyer from claiming in this shop's rooms and mute them in the current live's chat.
#[utoipa::path(post, path = "/api/v1/shops/{shop_id}/blocked", tag = "studio", params(("shop_id" = Uuid, Path)), request_body = BuyerRef,
    responses((status = 204), (status = 403, body = ErrorBody)))]
pub async fn block_buyer(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Json(body): Json<BuyerRef>,
) -> ApiResult<StatusCode> {
    require_team(&state, shop_id, staff.id).await?;
    state.db.block_buyer(shop_id, staff.id, body.buyer_id).await?;
    if let Some(live) = state.db.current_live(shop_id).await? {
        let buyer = state.db.get_buyer(body.buyer_id).await?;
        if let Err(error) = state.nexconn.mute_participant(&live.nexconn_channel_id, &buyer.nexconn_user_id, 24 * 60).await {
            tracing::warn!(%error, "could not mute blocked buyer");
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/v1/shops/{shop_id}/blocked/{buyer_id}", tag = "studio",
    params(("shop_id" = Uuid, Path), ("buyer_id" = Uuid, Path)), responses((status = 204)))]
pub async fn unblock_buyer(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path((shop_id, buyer_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    require_team(&state, shop_id, staff.id).await?;
    state.db.unblock_buyer(shop_id, staff.id, buyer_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
