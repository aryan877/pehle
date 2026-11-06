//! Connecting a seller's payment gateway, paying an order through it, and the gateway's webhook.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use pehle_db::StaffRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::{MaybeSignedIn, SignedInBuyer, SignedInStaff};
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::payments::{self, razorpay};
use crate::routes::rooms::{Checkout, checkout_for};
use crate::state::AppState;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSetup {
    pub connected: bool,
    pub provider: Option<String>,
    pub key_id: Option<String>,
    /// Test keys move no real money.
    pub live_mode: bool,
    /// Paste into Razorpay: Settings > Webhooks > Add new webhook.
    pub webhook_url: String,
    pub webhook_secret: Option<String>,
    pub webhook_events: Vec<&'static str>,
    /// False when the server cannot store gateway secrets (missing PEHLE_SECRET_KEY).
    pub available: bool,
}

async fn require_owner(state: &AppState, shop_id: Uuid, staff_id: Uuid) -> ApiResult<()> {
    match state.db.staff_role(shop_id, staff_id).await? {
        Some(StaffRole::Owner) => Ok(()),
        Some(_) => Err(ApiError::Forbidden("Only the shop owner can manage payments.".into())),
        None => Err(ApiError::Forbidden("You are not on this shop's team.".into())),
    }
}

async fn setup_for(state: &AppState, shop_id: Uuid) -> ApiResult<PaymentSetup> {
    let webhook_url = format!("{}/webhooks/razorpay/{shop_id}", state.config.public_url.as_str().trim_end_matches('/'));
    let connected = payments::connected(state, shop_id).await.map_err(ApiError::internal)?;
    Ok(PaymentSetup {
        connected: connected.is_some(),
        provider: connected.as_ref().map(|c| c.account.provider.clone()),
        key_id: connected.as_ref().map(|c| c.keys.key_id.clone()),
        live_mode: connected.as_ref().is_some_and(|c| c.account.live_mode),
        webhook_url,
        webhook_secret: connected.map(|c| c.webhook_secret),
        webhook_events: vec!["payment_link.paid", "payment_link.cancelled", "payment_link.expired"],
        available: state.sealer.is_some(),
    })
}

#[utoipa::path(get, path = "/api/v1/shops/{shop_id}/payments", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 200, body = PaymentSetup)))]
pub async fn get_setup(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<Json<PaymentSetup>> {
    require_owner(&state, shop_id, staff.id).await?;
    Ok(Json(setup_for(&state, shop_id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRazorpay {
    /// From Razorpay Dashboard > Account & Settings > API Keys. Starts with rzp_test_ or rzp_live_.
    pub key_id: String,
    pub key_secret: String,
}

/// Connect the shop's own Razorpay account. Keys are checked with Razorpay, then stored encrypted.
#[utoipa::path(put, path = "/api/v1/shops/{shop_id}/payments", tag = "studio", params(("shop_id" = Uuid, Path)), request_body = ConnectRazorpay,
    responses((status = 200, body = PaymentSetup), (status = 422, body = ErrorBody)))]
pub async fn connect(
    State(state): State<AppState>,
    SignedInStaff(staff): SignedInStaff,
    Path(shop_id): Path<Uuid>,
    Json(body): Json<ConnectRazorpay>,
) -> ApiResult<Json<PaymentSetup>> {
    require_owner(&state, shop_id, staff.id).await?;
    let sealer = state.sealer.as_ref().ok_or_else(|| ApiError::Conflict("Payments are not enabled on this server yet.".into()))?;
    let keys = razorpay::Keys { key_id: body.key_id.trim().to_string(), key_secret: body.key_secret.trim().to_string() };
    if !(keys.key_id.starts_with("rzp_test_") || keys.key_id.starts_with("rzp_live_")) || keys.key_secret.len() < 10 {
        return Err(ApiError::Unprocessable("Paste the Key ID (starts with rzp_) and the Key Secret from Razorpay.".into()));
    }
    state
        .razorpay
        .verify_keys(&keys)
        .await
        .map_err(|_| ApiError::Unprocessable("Razorpay did not accept these keys. Check the Key ID and Key Secret.".into()))?;
    // Keep the existing webhook secret when reconnecting, so the seller's Razorpay setting still works.
    let webhook_secret = match payments::connected(&state, shop_id).await.ok().flatten() {
        Some(existing) => existing.webhook_secret,
        None => {
            use rand::RngCore;
            let mut bytes = [0u8; 24];
            rand::rng().fill_bytes(&mut bytes);
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
        }
    };
    state
        .db
        .save_payment_account(
            shop_id,
            &keys.key_id,
            &sealer.seal(keys.key_secret.as_bytes()).map_err(ApiError::internal)?,
            &sealer.seal(webhook_secret.as_bytes()).map_err(ApiError::internal)?,
            staff.id,
        )
        .await?;
    Ok(Json(setup_for(&state, shop_id).await?))
}

#[utoipa::path(delete, path = "/api/v1/shops/{shop_id}/payments", tag = "studio", params(("shop_id" = Uuid, Path)),
    responses((status = 204)))]
pub async fn disconnect(State(state): State<AppState>, SignedInStaff(staff): SignedInStaff, Path(shop_id): Path<Uuid>) -> ApiResult<StatusCode> {
    require_owner(&state, shop_id, staff.id).await?;
    state.db.delete_payment_account(shop_id, staff.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayOrder {
    pub ship_name: String,
    pub ship_phone: String,
    pub ship_address: String,
    pub ship_pincode: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPage {
    /// Razorpay's hosted page: UPI apps on phones, a QR on computers, cards and netbanking too.
    pub url: String,
}

/// Save delivery details and get the shop's payment page for this order.
#[utoipa::path(post, path = "/api/v1/orders/{order_id}/pay", tag = "room", params(("order_id" = Uuid, Path)), request_body = PayOrder,
    responses((status = 200, body = PaymentPage), (status = 409, body = ErrorBody), (status = 422, body = ErrorBody)))]
pub async fn pay(
    State(state): State<AppState>,
    SignedInBuyer(buyer): SignedInBuyer,
    Path(order_id): Path<Uuid>,
    Json(body): Json<PayOrder>,
) -> ApiResult<Json<PaymentPage>> {
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
    let order = state.db.order_view(order_id).await?;
    if order.order.buyer_id != buyer.id {
        return Err(ApiError::NotFound("Order not found.".into()));
    }
    state.db.set_shipping(order_id, buyer.id, body.ship_name.trim(), &phone, body.ship_address.trim(), pincode).await?;
    let url = payments::ensure_link(&state, order_id).await.map_err(|error| {
        tracing::error!(error = %format!("{error:#}"), %order_id, "payment link failed");
        ApiError::Conflict("The shop's payment page is unavailable right now. Pay by UPI below instead.".into())
    })?;
    Ok(Json(PaymentPage { url }))
}

/// Ask the gateway now (used when the buyer returns from the payment page).
#[utoipa::path(post, path = "/api/v1/orders/{order_id}/check", tag = "room", params(("order_id" = Uuid, Path)),
    responses((status = 200, body = Checkout)))]
pub async fn check(State(state): State<AppState>, MaybeSignedIn(principal): MaybeSignedIn, Path(order_id): Path<Uuid>) -> ApiResult<Json<Checkout>> {
    let checkout = checkout_for(&state, principal.clone(), order_id).await?;
    if let (Some(link_id), true) = (
        sqlx::query_scalar::<_, Option<String>>("select payment_link_id from orders where id = $1")
            .bind(order_id)
            .fetch_one(&state.db.pool)
            .await
            .map_err(ApiError::internal)?,
        matches!(checkout.order.order.status, pehle_db::OrderStatus::AwaitingPayment | pehle_db::OrderStatus::PaymentReported),
    ) {
        if let Err(error) = payments::check_link(&state, checkout.order.order.seller_id, order_id, &link_id).await {
            tracing::warn!(error = %format!("{error:#}"), "payment check failed");
        }
        return Ok(Json(checkout_for(&state, principal, order_id).await?));
    }
    Ok(Json(checkout))
}

/// `POST /webhooks/razorpay/{seller_id}`: Razorpay calls this on the seller's account events.
pub async fn webhook(State(state): State<AppState>, Path(seller_id): Path<Uuid>, headers: HeaderMap, body: Bytes) -> Response {
    let connected = match payments::connected(&state, seller_id).await {
        Ok(Some(c)) => c,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => {
            tracing::error!(error = %format!("{error:#}"), "razorpay webhook: account unavailable");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let signature = headers.get("x-razorpay-signature").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !razorpay::webhook_signature_valid(&connected.webhook_secret, &body, signature) {
        tracing::warn!(%seller_id, "razorpay webhook with a bad signature");
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let event_id = headers.get("x-razorpay-event-id").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !event_id.is_empty() {
        match state.db.first_sighting(&format!("rzp:{event_id}"), "razorpay").await {
            Ok(false) => return StatusCode::OK.into_response(),
            Ok(true) => {}
            Err(error) => tracing::warn!(%error, "razorpay webhook dedupe failed"),
        }
    }
    let Ok(event) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if event["event"] == "payment_link.paid"
        && let Err(error) = payments::on_link_paid(&state, &connected, &event).await
    {
        tracing::error!(error = %format!("{error:#}"), "razorpay payment_link.paid handling failed");
        // Ask Razorpay to retry; polling will also catch it.
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::OK.into_response()
}
