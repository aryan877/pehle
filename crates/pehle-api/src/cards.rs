//! Chat messages Pehle sends or rewrites. Each is an `RC:TxtMsg` whose text reads well on its own,
//! with a structured payload in `extra.pehle` that the web app renders as a card.

use chrono::{DateTime, Utc};
use pehle_db::{ClaimOutcome, ClaimResult, ClaimStatus, Item, OrderStatus, OrderView};
use pehle_nexconn::Message;
use serde_json::json;

use crate::money::{format_inr, order_reference, upi_link};
use crate::state::AppState;

fn minutes_left(until: Option<DateTime<Utc>>) -> i64 {
    until.map(|t| ((t - Utc::now()).num_seconds().max(0) + 59) / 60).unwrap_or(0)
}

/// The rewritten buyer message: what they said, plus the decision everyone in the room can see.
pub fn claim_receipt(said: &str, buyer_name: &str, result: &ClaimResult, source: Option<&str>) -> Message {
    let code = result.item_code.as_deref().unwrap_or("");
    let position = result.position.unwrap_or_default();
    let text = match (result.outcome, result.status) {
        (ClaimOutcome::Already, _) => format!("{buyer_name} is already #{position} for {code}"),
        (_, Some(ClaimStatus::Paid)) => format!("🎉 {buyer_name} won {code} (#{position})"),
        (_, Some(ClaimStatus::Held)) => format!("✅ {buyer_name} claimed {code} (#{position})"),
        (_, Some(ClaimStatus::Waitlisted)) => format!("⏳ {buyer_name} is #{position} in line for {code}"),
        _ => said.to_string(),
    };
    Message::text(
        text,
        Some(json!({
            "t": "receipt",
            "source": source,
            "said": said,
            "buyerName": buyer_name,
            "outcome": result.outcome,
            "claimId": result.claim_id,
            "itemId": result.item_id,
            "itemCode": result.item_code,
            "itemTitle": result.item_title,
            "position": result.position,
            "status": result.status,
            "holdExpiresAt": result.hold_expires_at,
            "unitsLeft": result.units_left,
            "waitlist": result.waitlist_length,
        })),
    )
}

/// Beyond this many people waiting, a new place in line is told only to the buyer, so a big drop's
/// chat stays readable. Holds and the first few places are always public.
pub const PUBLIC_WAITLIST: i32 = 3;

/// A place deep in the line, returned to the sender only (pre-messaging `extra`).
pub fn private_waitlist(result: &ClaimResult) -> String {
    let code = result.item_code.as_deref().unwrap_or("this item");
    let position = result.position.unwrap_or_default();
    json!({ "pehle": {
        "t": "refused", "outcome": "waitlisted", "position": position, "itemCode": code,
        "message": format!("You're #{position} in line for {code}. We'll tell you if it moves to you."),
    } })
    .to_string()
}

/// Why a claim was refused, returned to the sender only (pre-messaging `extra`).
pub fn refusal(result: &ClaimResult, hold_limit: i32) -> Option<String> {
    let code = result.item_code.as_deref().unwrap_or("this item");
    let text = match result.outcome {
        ClaimOutcome::HoldLimit => format!("You already have {hold_limit} unpaid holds. Pay for one to claim more."),
        ClaimOutcome::Closed => format!("{code} is closed for claims."),
        ClaimOutcome::NoItem => "Nothing is up for claims yet. Wait for the next item.".to_string(),
        ClaimOutcome::NotLive => "This live has ended.".to_string(),
        ClaimOutcome::Blocked => "This shop isn't taking claims from your account.".to_string(),
        _ => return None,
    };
    Some(json!({ "pehle": { "t": "refused", "outcome": result.outcome, "message": text } }).to_string())
}

/// Posted by the co-host when the seller drops an item.
pub fn drop_card(state: &AppState, item: &Item, hold_minutes: i32) -> Message {
    let price = if item.price_paise == 0 { "free".to_string() } else { format_inr(item.price_paise) };
    let units = if item.quantity == 1 { "1 piece".to_string() } else { format!("{} pieces", item.quantity) };
    let rule = if item.price_paise == 0 {
        "First to claim wins it.".to_string()
    } else {
        format!("First to claim gets {hold_minutes} minutes to pay.")
    };
    Message::text(
        format!("🔔 {}: {}, {price}, {units}. Type \"mine\" or {} to claim. {rule}", item.code, item.title, item.code),
        Some(json!({
            "t": "drop",
            "itemId": item.id,
            "code": item.code,
            "title": item.title,
            "pricePaise": item.price_paise,
            "quantity": item.quantity,
            "imageUrl": item.image_path.as_deref().map(|p| state.media_url(p)),
        })),
    )
}

/// The checkout card in the buyer's private chat with the shop.
pub fn order_card(state: &AppState, order: &OrderView, promoted: bool) -> Message {
    let amount = format_inr(order.order.amount_paise);
    let reference = order_reference(order.order.id);
    let upi = order.upi_vpa.as_deref().map(|vpa| {
        upi_link(
            vpa,
            order.upi_payee_name.as_deref().unwrap_or(&order.shop_name),
            order.order.amount_paise,
            &format!("{} {}", order.item_code, order.item_title),
            &reference,
        )
    });
    let minutes = minutes_left(order.hold_expires_at);
    let text = match order.order.status {
        OrderStatus::AwaitingPayment if promoted => format!(
            "Good news, {}! {} {} is yours now that #{} came up. Pay {amount} within {minutes} min to keep it: {}",
            order.buyer_name, order.item_code, order.item_title, order.claim_position, state.order_url(order.order.id)
        ),
        OrderStatus::AwaitingPayment => format!(
            "{} {} is held for you ({}). Pay {amount} within {minutes} min to keep it: {}",
            order.item_code, order.item_title, reference, state.order_url(order.order.id)
        ),
        OrderStatus::PaymentReported => format!(
            "Payment reported for {} ({reference}). {} will confirm it shortly.", order.item_code, order.shop_name
        ),
        OrderStatus::Paid if order.order.paid_via.as_deref() == Some("free") => format!(
            "You won {} {}!{}",
            order.item_code,
            order.item_title,
            order.winner_note.as_deref().map(|n| format!(" {n}")).unwrap_or_default()
        ),
        OrderStatus::Paid if order.order.paid_via.as_deref() == Some("gateway") => format!(
            "Payment received for {} {} ({reference}){}. Thank you!",
            order.item_code,
            order.item_title,
            order.order.gateway_rrn.as_deref().map(|r| format!(", UPI ref {r}")).unwrap_or_default()
        ),
        OrderStatus::Paid => format!("Payment confirmed for {} {} ({reference}). Thank you!", order.item_code, order.item_title),
        _ if order.order.refund_id.is_some() => format!(
            "Your payment for {} came after the hold ended, so it went to the next buyer. Your money is being refunded (refund {}).",
            order.item_code,
            order.order.refund_id.as_deref().unwrap_or_default()
        ),
        OrderStatus::Expired => format!(
            "Your hold on {} ran out, so it went to the next person in line.", order.item_code
        ),
        OrderStatus::Cancelled => format!("Your order for {} ({reference}) was cancelled.", order.item_code),
    };
    Message::text(
        text,
        Some(json!({
            "t": "order",
            "orderId": order.order.id,
            "reference": reference,
            "status": order.order.status,
            "promoted": promoted,
            "itemCode": order.item_code,
            "itemTitle": order.item_title,
            "imageUrl": order.item_image_path.as_deref().map(|p| state.media_url(p)),
            "amountPaise": order.order.amount_paise,
            "holdExpiresAt": order.hold_expires_at,
            "upiUrl": upi,
            "orderUrl": state.order_url(order.order.id),
        })),
    )
}

/// The browser notification that goes with an order card.
pub fn order_push(order: &OrderView, promoted: bool) -> crate::push::Notification {
    let minutes = minutes_left(order.hold_expires_at);
    let (title, body) = match order.order.status {
        OrderStatus::AwaitingPayment if promoted => (
            format!("{} is yours now", order.item_code),
            format!("The person ahead of you didn't pay. Pay within {minutes} min to keep {}.", order.item_title),
        ),
        OrderStatus::AwaitingPayment => (format!("You got {}!", order.item_code), format!("Pay within {minutes} min to keep {}.", order.item_title)),
        OrderStatus::PaymentReported => (format!("Payment sent for {}", order.item_code), format!("{} will confirm it shortly.", order.shop_name)),
        OrderStatus::Paid if order.order.paid_via.as_deref() == Some("free") => {
            (format!("You won {}!", order.item_code), order.winner_note.clone().unwrap_or_else(|| order.item_title.clone()))
        }
        OrderStatus::Paid => (format!("{} is paid", order.item_code), format!("{} has your order.", order.shop_name)),
        OrderStatus::Expired => (format!("Your hold on {} ended", order.item_code), "It went to the next person in line.".into()),
        OrderStatus::Cancelled => (format!("{} was cancelled", order.item_code), format!("Message {} if this is a mistake.", order.shop_name)),
    };
    crate::push::Notification { title, body, url: format!("/o/{}", order.order.id), tag: format!("order-{}", order.order.id) }
}

/// Tells the shop team a buyer reported payment.
pub fn payment_reported_notice(state: &AppState, order: &OrderView) -> Message {
    Message::text(
        format!(
            "💸 {} reported {} for {} (UPI ref {}). Check your UPI app, then confirm.",
            order.buyer_name,
            format_inr(order.order.amount_paise),
            order.item_code,
            order.order.upi_reference.as_deref().unwrap_or("-")
        ),
        Some(json!({ "t": "payment_reported", "orderId": order.order.id, "orderUrl": state.order_url(order.order.id) })),
    )
}

pub fn live_announcement(state: &AppState, shop_name: &str, title: &str, slug: &str) -> Message {
    Message::text(
        format!("🔴 {shop_name} is live now: {title}. Join and claim: {}", state.room_url(slug)),
        Some(json!({ "t": "live", "slug": slug, "url": state.room_url(slug) })),
    )
}
