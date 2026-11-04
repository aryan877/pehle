//! Buyer side: the live room, claims, checkout and following a shop.

use axum::Json;
use axum::extract::{Path, Query, State};
use pehle_db::claims::ClaimRequest;
use pehle_db::events::Stats;
use pehle_db::orders::PaymentReport;
use pehle_db::audience::Conversation;
use pehle_db::{Buyer, ClaimResult, ClaimSource, Event, Live, LiveStatus, OrderView, Principal, PublicItem, PublicShop, QueueEntry};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth::{MaybeSignedIn, SignedInBuyer};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::money::order_reference;
use crate::state::AppState;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicLive {
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub stream_url: Option<String>,
    pub status: LiveStatus,
    pub scheduled_for: Option<chrono::DateTime<chrono::Utc>>,
    pub nexconn_channel_id: String,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    /// True when claims typed in the stream's YouTube chat also count.
    pub youtube_chat: bool,
}

impl From<Live> for PublicLive {
    fn from(live: Live) -> Self {
        Self {
            slug: live.slug,
            title: live.title,
            description: live.description,
            stream_url: live.stream_url,
            status: live.status,
            scheduled_for: live.scheduled_for,
            nexconn_channel_id: live.nexconn_channel_id,
            started_at: live.started_at,
            ended_at: live.ended_at,
            youtube_chat: live.youtube_live_chat_id.is_some(),
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoomView {
    pub shop: PublicShop,
    pub live: PublicLive,
    /// Same document the room's Nexconn metadata carries, for the first paint before chat connects.
    #[schema(value_type = Object)]
    pub snapshot: serde_json::Value,
    pub open_items: Vec<PublicItem>,
    /// What the seller announced for this drop, in order.
    pub lineup: Vec<PublicItem>,
    pub following: bool,
    /// The signed-in buyer asked to be reminded when this drop starts.
    pub reminded: bool,
    pub reminders: i64,
    /// The signed-in buyer's own claims in this live.
    pub my_claims: Vec<QueueEntry>,
}

#[utoipa::path(get, path = "/api/v1/rooms/{slug}", tag = "room", params(("slug" = String, Path)),
    responses((status = 200, body = RoomView), (status = 404, body = ErrorBody)))]
pub async fn get_room(
    State(state): State<AppState>,
    MaybeSignedIn(principal): MaybeSignedIn,
    Path(slug): Path<String>,
) -> ApiResult<Json<RoomView>> {
    let live = state.db.live_by_slug(&slug).await?;
    let (shop, snapshot, open_items, lineup, reminders) = tokio::try_join!(
        state.db.public_shop_by_id(live.seller_id),
        state.db.live_snapshot(live.id),
        state.db.open_items(live.id),
        state.db.lineup(live.id),
        state.db.reminder_count(live.id),
    )?;
    let (following, reminded, my_claims) = match &principal {
        Some(Principal::Buyer(buyer)) => {
            if live.status == LiveStatus::Live {
                state
                    .db
                    .record_event("room.joined", Some(live.seller_id), Some(live.id), Some(buyer.id), json!({}))
                    .await?;
            }
            tokio::try_join!(
                state.db.is_following(live.seller_id, buyer.id),
                state.db.has_reminder(live.id, buyer.id),
                state.db.buyer_claims_in_live(live.id, buyer.id),
            )?
        }
        _ => (false, false, Vec::new()),
    };
    Ok(Json(RoomView { shop, live: live.into(), snapshot, open_items, lineup, following, reminded, reminders, my_claims }))
}

/// Demo buyers exist to try the demo shop; they cannot claim in real shops.
pub(crate) async fn require_claim_access(state: &AppState, buyer: &Buyer, seller_id: Uuid) -> ApiResult<()> {
    if buyer.is_demo && !state.db.public_shop_by_id(seller_id).await?.is_demo {
        return Err(ApiError::Forbidden("Sign in with Google or your phone to claim in real shops.".into()));
    }
    Ok(())
}

#[derive(Serialize, ToSchema)]
pub struct Reminder {
    pub reminded: bool,
}

/// Turn "Remind me" on or off for an upcoming drop.
#[utoipa::path(post, path = "/api/v1/rooms/{slug}/remind", tag = "room", params(("slug" = String, Path)),
    responses((status = 200, body = Reminder), (status = 409, body = ErrorBody)))]
pub async fn remind(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(slug): Path<String>) -> ApiResult<Json<Reminder>> {
    let live = state.db.live_by_slug(&slug).await?;
    Ok(Json(Reminder { reminded: state.db.toggle_reminder(live.id, buyer.id).await? }))
}

#[derive(Deserialize, ToSchema)]
pub struct ButtonClaim {
    /// Item code; omit to claim the pinned item.
    #[serde(default)]
    pub code: Option<String>,
}

/// Claim without chat (used when the chat connection is down). The same rules apply, and the
/// server posts the receipt into the room.
#[utoipa::path(post, path = "/api/v1/rooms/{slug}/claims", tag = "room", params(("slug" = String, Path)), request_body = ButtonClaim,
    responses((status = 200, body = ClaimResult), (status = 401, body = ErrorBody)))]
pub async fn claim(
    State(state): State<AppState>,
    SignedInBuyer(buyer): SignedInBuyer,
    Path(slug): Path<String>,
    Json(body): Json<ButtonClaim>,
) -> ApiResult<Json<ClaimResult>> {
    let live = state.db.live_by_slug(&slug).await?;
    require_claim_access(&state, &buyer, live.seller_id).await?;
    let result = state
        .db
        .claim(ClaimRequest {
            live_id: live.id,
            buyer_id: buyer.id,
            item_code: body.code.as_deref().map(str::trim).filter(|c| !c.is_empty()),
            source: ClaimSource::Button,
            said: "Claim",
            message_id: None,
            received_at: None,
        })
        .await?;
    Ok(Json(result))
}

#[derive(Deserialize, IntoParams)]
pub struct FairnessQuery {
    /// Return events after this ID, for paging.
    #[serde(default)]
    after: Option<i64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FairnessLog {
    pub live: PublicLive,
    pub shop: PublicShop,
    /// Every claim decision in order, as recorded in the same transaction that made it.
    pub events: Vec<Event>,
    pub queue: Vec<FairEntry>,
}

/// A queue position without anything that identifies the buyer beyond their chosen display name.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FairEntry {
    pub item_code: String,
    /// Where the claim came from: Pehle chat, the claim button, the seller, or YouTube chat.
    pub source: pehle_db::ClaimSource,
    pub position: i32,
    pub status: pehle_db::ClaimStatus,
    pub buyer_name: String,
    pub decided_at: chrono::DateTime<chrono::Utc>,
    pub nexconn_received_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The public record of who claimed what, and when. Anyone can check the queue.
#[utoipa::path(get, path = "/api/v1/rooms/{slug}/fairness", tag = "room", params(("slug" = String, Path), FairnessQuery),
    responses((status = 200, body = FairnessLog)))]
pub async fn fairness(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(query): Query<FairnessQuery>,
) -> ApiResult<Json<FairnessLog>> {
    let live = state.db.live_by_slug(&slug).await?;
    let (shop, events, queue) = tokio::try_join!(
        state.db.public_shop_by_id(live.seller_id),
        state.db.claim_events(live.id, query.after.unwrap_or(0), 500),
        state.db.queue_for_live(live.id),
    )?;
    let events = events
        .into_iter()
        .map(|mut e| {
            // Message IDs and raw text stay out of the public log.
            if let Some(map) = e.data.as_object_mut() {
                map.remove("nexconn_message_id");
                map.remove("said");
                map.remove("confirmed_by");
                map.remove("cancelled_by");
            }
            e
        })
        .collect();
    let queue = queue
        .into_iter()
        .map(|q| FairEntry {
            item_code: q.item_code,
            source: q.source,
            position: q.position,
            status: q.status,
            buyer_name: q.buyer_name,
            decided_at: q.decided_at,
            nexconn_received_at: q.nexconn_received_at,
        })
        .collect();
    Ok(Json(FairnessLog { live: live.into(), shop, events, queue }))
}

#[utoipa::path(post, path = "/api/v1/shops/by-handle/{handle}/follow", tag = "room", params(("handle" = String, Path)),
    responses((status = 200, body = bool)))]
pub async fn follow(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(handle): Path<String>) -> ApiResult<Json<bool>> {
    let shop = state.db.public_shop(&handle).await?;
    state.db.follow(shop.id, buyer.id).await?;
    Ok(Json(true))
}

#[utoipa::path(delete, path = "/api/v1/shops/by-handle/{handle}/follow", tag = "room", params(("handle" = String, Path)),
    responses((status = 200, body = bool)))]
pub async fn unfollow(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(handle): Path<String>) -> ApiResult<Json<bool>> {
    let shop = state.db.public_shop(&handle).await?;
    state.db.unfollow(shop.id, buyer.id).await?;
    Ok(Json(false))
}

/// The signed-in buyer's conversations with shops, most recent first.
#[utoipa::path(get, path = "/api/v1/conversations", tag = "room", responses((status = 200, body = Vec<Conversation>)))]
pub async fn my_conversations(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer) -> ApiResult<Json<Vec<Conversation>>> {
    Ok(Json(state.db.conversations_for_buyer(buyer.id).await?))
}

/// Open (or create) the buyer's conversation with a shop. The Nexconn group is ready when this returns.
#[utoipa::path(post, path = "/api/v1/shops/by-handle/{handle}/conversation", tag = "room", params(("handle" = String, Path)),
    responses((status = 200, body = Conversation), (status = 502, body = ErrorBody)))]
pub async fn open_conversation(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(handle): Path<String>) -> ApiResult<Json<Conversation>> {
    let shop = state.db.public_shop(&handle).await?;
    let conversation = state.db.ensure_conversation(shop.id, buyer.id).await?;
    if !conversation.provisioned {
        crate::workers::provision_conversation(&state, conversation.id).await.map_err(ApiError::internal)?;
    }
    Ok(Json(state.db.conversation(conversation.id).await?))
}

/// Orders between the signed-in buyer and one shop, for the conversation side panel.
#[utoipa::path(get, path = "/api/v1/shops/by-handle/{handle}/orders", tag = "room", params(("handle" = String, Path)),
    responses((status = 200, body = Vec<OrderView>)))]
pub async fn orders_with_shop(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(handle): Path<String>) -> ApiResult<Json<Vec<OrderView>>> {
    let shop = state.db.public_shop(&handle).await?;
    Ok(Json(state.db.orders_between(shop.id, buyer.id).await?))
}

#[utoipa::path(post, path = "/api/v1/claims/{claim_id}/release", tag = "room", params(("claim_id" = Uuid, Path)),
    responses((status = 204), (status = 409, body = ErrorBody)))]
pub async fn release(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(claim_id): Path<Uuid>) -> ApiResult<axum::http::StatusCode> {
    state.db.release_claim(claim_id, buyer.id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// --- Checkout --------------------------------------------------------------------------------

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Checkout {
    #[serde(flatten)]
    pub order: OrderView,
    pub reference: String,
    /// `upi://pay` link with amount and note filled in; null if the shop has not set a UPI ID.
    pub upi_url: Option<String>,
    /// True when the viewer is on the shop's team rather than the buyer.
    pub viewer_is_staff: bool,
    /// True when the shop has a payment gateway connected, so payment is confirmed automatically.
    pub gateway: bool,
}

pub(crate) async fn checkout_for(state: &AppState, principal: Option<Principal>, order_id: Uuid) -> ApiResult<Checkout> {
    let order = state.db.order_view(order_id).await?;
    let viewer_is_staff = match principal {
        Some(Principal::Buyer(b)) if b.id == order.order.buyer_id => false,
        Some(Principal::Staff(s)) if state.db.staff_role(order.order.seller_id, s.id).await?.is_some() => true,
        Some(_) => return Err(ApiError::NotFound("Order not found.".into())),
        None => return Err(ApiError::Unauthorized),
    };
    let reference = order_reference(order.order.id);
    let upi_url = order.upi_vpa.as_deref().map(|vpa| {
        crate::money::upi_link(
            vpa,
            order.upi_payee_name.as_deref().unwrap_or(&order.shop_name),
            order.order.amount_paise,
            &format!("{} {}", order.item_code, order.item_title),
            &reference,
        )
    });
    let gateway = state.db.payment_account(order.order.seller_id).await?.is_some() && state.sealer.is_some();
    Ok(Checkout { order, reference, upi_url, viewer_is_staff, gateway })
}

#[utoipa::path(get, path = "/api/v1/orders/{order_id}", tag = "room", params(("order_id" = Uuid, Path)),
    responses((status = 200, body = Checkout), (status = 404, body = ErrorBody)))]
pub async fn get_order(State(state): State<AppState>, MaybeSignedIn(principal): MaybeSignedIn, Path(order_id): Path<Uuid>) -> ApiResult<Json<Checkout>> {
    Ok(Json(checkout_for(&state, principal, order_id).await?))
}

#[utoipa::path(get, path = "/api/v1/orders/mine", tag = "room", responses((status = 200, body = Vec<OrderView>)))]
pub async fn my_orders(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer) -> ApiResult<Json<Vec<OrderView>>> {
    Ok(Json(state.db.orders_for_buyer(buyer.id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportPayment {
    /// The 12-digit UPI reference (UTR) from the buyer's payment app.
    pub upi_reference: String,
    pub ship_name: String,
    pub ship_phone: String,
    pub ship_address: String,
    pub ship_pincode: String,
}

#[utoipa::path(post, path = "/api/v1/orders/{order_id}/payment", tag = "room", params(("order_id" = Uuid, Path)), request_body = ReportPayment,
    responses((status = 200, body = Checkout), (status = 409, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn report_payment(
    State(state): State<AppState>,
    SignedInBuyer(buyer): SignedInBuyer,
    Path(order_id): Path<Uuid>,
    Json(body): Json<ReportPayment>,
) -> ApiResult<Json<Checkout>> {
    let reference: String = body.upi_reference.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if !(6..=40).contains(&reference.len()) {
        return Err(ApiError::Unprocessable("Enter the UPI reference number from your payment app.".into()));
    }
    let phone: String = body.ship_phone.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
    if !(10..=15).contains(&phone.trim_start_matches('+').len()) {
        return Err(ApiError::Unprocessable("Enter a 10-digit phone number.".into()));
    }
    let pincode = body.ship_pincode.trim();
    if pincode.len() != 6 || !pincode.chars().all(|c| c.is_ascii_digit()) || pincode.starts_with('0') {
        return Err(ApiError::Unprocessable("Enter a 6-digit pincode.".into()));
    }
    if body.ship_name.trim().is_empty() || body.ship_address.trim().len() < 8 {
        return Err(ApiError::Unprocessable("Enter the name and full address for delivery.".into()));
    }
    state
        .db
        .report_payment(
            order_id,
            buyer.id,
            PaymentReport {
                upi_reference: &reference,
                ship_name: body.ship_name.trim(),
                ship_phone: &phone,
                ship_address: body.ship_address.trim(),
                ship_pincode: pincode,
            },
        )
        .await?;
    let checkout = checkout_for(&state, Some(Principal::Buyer(buyer)), order_id).await?;
    if state.db.public_shop_by_id(checkout.order.order.seller_id).await?.is_demo {
        crate::demo::confirm_soon(&state, order_id);
    }
    Ok(Json(checkout))
}

// --- Public ----------------------------------------------------------------------------------

/// Usage across all shops: the traction numbers in the submission come from here.
#[utoipa::path(get, path = "/api/v1/stats", tag = "public", responses((status = 200, body = Stats)))]
pub async fn public_stats(State(state): State<AppState>) -> ApiResult<Json<Stats>> {
    Ok(Json(state.db.stats(None, None).await?))
}

#[utoipa::path(get, path = "/api/v1/shops/by-handle/{handle}", tag = "public", params(("handle" = String, Path)),
    responses((status = 200, body = PublicShop), (status = 404, body = ErrorBody)))]
pub async fn public_shop(State(state): State<AppState>, Path(handle): Path<String>) -> ApiResult<Json<PublicShop>> {
    Ok(Json(state.db.public_shop(&handle).await?))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeLinkCode {
    /// Type `pehle <code>` in the stream's YouTube chat.
    pub code: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    /// Already linked YouTube name, if any.
    pub linked_as: Option<String>,
}

/// A one-time code that links the signed-in buyer's YouTube name, so "mine" typed in the YouTube
/// chat claims for this account and any earlier YouTube claims move over.
#[utoipa::path(post, path = "/api/v1/rooms/{slug}/youtube-code", tag = "room", params(("slug" = String, Path)),
    responses((status = 200, body = YoutubeLinkCode)))]
pub async fn youtube_code(State(state): State<AppState>, SignedInBuyer(buyer): SignedInBuyer, Path(slug): Path<String>) -> ApiResult<Json<YoutubeLinkCode>> {
    let live = state.db.live_by_slug(&slug).await?;
    if live.youtube_video_id.is_none() {
        return Err(ApiError::Conflict("This live is not on YouTube.".into()));
    }
    let (code, expires_at) = state.db.youtube_link_code(live.id, buyer.id).await?;
    let linked_as = state.db.youtube_name(buyer.id).await?;
    Ok(Json(YoutubeLinkCode { code, expires_at, linked_as }))
}
