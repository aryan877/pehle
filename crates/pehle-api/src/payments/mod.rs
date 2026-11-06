//! Automatic payment confirmation through each seller's own Razorpay account.
//!
//! Money never passes through Pehle: the payment link is created on the seller's account and settles
//! to them. Pehle only learns that it was paid, from Razorpay's signed webhook or by polling the link,
//! and then runs `app.gateway_paid`, which marks the order paid if the hold is still open or queues a
//! refund if the hold had already lapsed.

pub mod razorpay;
pub mod sealer;

use std::collections::BTreeMap;

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use pehle_db::payments::{GatewayOutcome, PaymentAccount};
use pehle_db::{OrderStatus, OrderView};
use uuid::Uuid;

use self::razorpay::{Customer, Keys, NewLink, Notify};
use crate::money::order_reference;
use crate::state::AppState;

/// Razorpay will not create a link that expires sooner than 15 minutes from now.
const MIN_LINK_LIFETIME_SECS: i64 = 16 * 60;

pub struct Connected {
    pub keys: Keys,
    pub webhook_secret: String,
    pub account: PaymentAccount,
}

pub async fn connected(state: &AppState, seller_id: Uuid) -> Result<Option<Connected>> {
    let Some(account) = state.db.payment_account(seller_id).await? else {
        return Ok(None);
    };
    let sealer = state.sealer.as_ref().ok_or_else(|| anyhow!("PEHLE_SECRET_KEY is not configured"))?;
    let keys = Keys { key_id: account.key_id.clone(), key_secret: sealer.open_string(&account.key_secret_enc)? };
    let webhook_secret = sealer.open_string(&account.webhook_secret_enc)?;
    Ok(Some(Connected { keys, webhook_secret, account }))
}

/// The hosted payment page for an order, created on first use.
pub async fn ensure_link(state: &AppState, order_id: Uuid) -> Result<String> {
    let _guard = state.link_lock.lock().await;
    let order = state.db.order_view(order_id).await?;
    if let Some(url) = &order.order.payment_link_url {
        return Ok(url.clone());
    }
    let connected = connected(state, order.order.seller_id).await?.context("this shop has no payment gateway connected")?;
    let hold_end = order.hold_expires_at.map(|t| t.timestamp()).unwrap_or_else(|| Utc::now().timestamp());
    let expire_by = hold_end.max(Utc::now().timestamp() + MIN_LINK_LIFETIME_SECS);
    let reference = format!("{}-{}", order_reference(order.order.id), Utc::now().timestamp() % 100_000);
    let description = format!("{} {} ({})", order.item_code, order.item_title, order.shop_name);
    let callback = state.order_url(order.order.id);
    let link = state
        .razorpay
        .create_link(
            &connected.keys,
            &NewLink {
                amount: order.order.amount_paise,
                currency: "INR",
                accept_partial: false,
                expire_by,
                reference_id: &reference,
                description: &description.chars().take(200).collect::<String>(),
                customer: Customer { name: order.order.ship_name.as_deref().unwrap_or(&order.buyer_name), contact: order.order.ship_phone.as_deref() },
                notify: Notify { sms: false, email: false },
                reminder_enable: false,
                notes: BTreeMap::from([("order_id", order.order.id.to_string()), ("pehle", "1".into())]),
                callback_url: &callback,
                callback_method: "get",
            },
        )
        .await?;
    state.db.set_payment_link(order.order.id, &link.id, &link.short_url).await?;
    Ok(link.short_url)
}

/// Ask Razorpay about an order's link and record a payment if there is one.
pub async fn check_link(state: &AppState, seller_id: Uuid, order_id: Uuid, link_id: &str) -> Result<Option<GatewayOutcome>> {
    let Some(connected) = connected(state, seller_id).await? else {
        return Ok(None);
    };
    let link = state.razorpay.fetch_link(&connected.keys, link_id).await?;
    if link.status != "paid" {
        return Ok(None);
    }
    let Some(paid) = link.payments.as_ref().and_then(|p| p.iter().find(|x| x.status == "captured" || x.status == "authorized")) else {
        return Ok(None);
    };
    record_payment(state, &connected, order_id, &paid.payment_id).await.map(Some)
}

async fn record_payment(state: &AppState, connected: &Connected, order_id: Uuid, payment_id: &str) -> Result<GatewayOutcome> {
    let payment = state.razorpay.fetch_payment(&connected.keys, payment_id).await?;
    if payment.status != "captured" && payment.status != "authorized" {
        anyhow::bail!("payment {} is {}, not captured", payment.id, payment.status);
    }
    let outcome = state.db.gateway_paid(order_id, &payment.id, payment.rrn().as_deref(), payment.amount).await?;
    tracing::info!(%order_id, payment = %payment.id, ?outcome, "gateway payment recorded");
    Ok(outcome)
}

/// Handle a verified `payment_link.paid` webhook body.
pub async fn on_link_paid(state: &AppState, connected: &Connected, body: &serde_json::Value) -> Result<()> {
    let link = &body["payload"]["payment_link"]["entity"];
    let order_id: Uuid = link["notes"]["order_id"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .context("payment link has no Pehle order_id note")?;
    let payment_id = body["payload"]["payment"]["entity"]["id"].as_str().context("webhook has no payment id")?;
    record_payment(state, connected, order_id, payment_id).await.map(drop)
}

/// The hold ended without payment: stop the link so it cannot be paid later.
pub async fn cancel_link(state: &AppState, order: &OrderView) -> Result<()> {
    let Some(link_id) = order_link_id(state, order.order.id).await? else {
        return Ok(());
    };
    if order.order.status == OrderStatus::Paid {
        return Ok(());
    }
    let Some(connected) = connected(state, order.order.seller_id).await? else {
        return Ok(());
    };
    match state.razorpay.cancel_link(&connected.keys, &link_id).await {
        Ok(_) => Ok(()),
        // Already paid at the gateway: record it, which refunds it if the item has moved on.
        Err(error) => {
            tracing::warn!(error = %format!("{error:#}"), "cancel failed; checking whether the link was paid");
            check_link(state, order.order.seller_id, order.order.id, &link_id).await.map(drop)
        }
    }
}

async fn order_link_id(state: &AppState, order_id: Uuid) -> Result<Option<String>> {
    Ok(sqlx::query_scalar::<_, Option<String>>("select payment_link_id from orders where id = $1")
        .bind(order_id)
        .fetch_one(&state.db.pool)
        .await?)
}

/// Money arrived after the item went to someone else: give it back.
pub async fn refund_late(state: &AppState, order_id: Uuid, payment_id: &str, amount: i64) -> Result<()> {
    let order = state.db.order_view(order_id).await?;
    if order.order.refund_id.is_some() {
        return Ok(());
    }
    let connected = connected(state, order.order.seller_id).await?.context("gateway disconnected before refund")?;
    let reason = "Paid after the hold ended; the item went to the next buyer";
    let refund = state.razorpay.refund(&connected.keys, payment_id, amount, reason).await?;
    state.db.set_refund(order_id, &refund.id, reason).await?;
    Ok(())
}
