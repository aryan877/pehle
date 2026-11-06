//! Background work: the outbox (every Nexconn side effect) and hold expiry.
//!
//! The outbox is drained by one task so room syncs for a live are applied in order. It wakes on
//! Postgres `NOTIFY outbox` and also polls, so a missed notification only delays a job by a second.
//! Co-host answers call a model and run on their own task so they never hold up checkout messages.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use pehle_db::OutboxJob;
use serde_json::{Value, json};
use sqlx::postgres::PgListener;
use tokio::sync::watch;
use uuid::Uuid;

use crate::cards;
use crate::cohost;
use crate::state::AppState;

const LEASE: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_secs(1);
/// Nexconn metadata values are limited in size; keep each key well under 4 KB.
const METADATA_VALUE_LIMIT: usize = 3800;

pub fn spawn(state: AppState, shutdown: watch::Receiver<bool>) -> Vec<tokio::task::JoinHandle<()>> {
    vec![
        tokio::spawn(outbox_loop(state.clone(), shutdown.clone(), false)),
        tokio::spawn(outbox_loop(state.clone(), shutdown.clone(), true)),
        tokio::spawn(holds_loop(state.clone(), shutdown.clone())),
        tokio::spawn(payment_poll_loop(state.clone(), shutdown.clone())),
        tokio::spawn(crate::youtube::run(state.clone(), shutdown.clone())),
        tokio::spawn(housekeeping_loop(state, shutdown)),
    ]
}

/// `cohost_only` selects the co-host lane; the other lane takes every other job.
async fn outbox_loop(state: AppState, mut shutdown: watch::Receiver<bool>, cohost_only: bool) {
    let mut listener = match PgListener::connect_with(&state.db.pool).await {
        Ok(mut l) => match l.listen("outbox").await {
            Ok(()) => Some(l),
            Err(error) => {
                tracing::warn!(%error, "outbox LISTEN failed; polling only");
                None
            }
        },
        Err(error) => {
            tracing::warn!(%error, "outbox listener connection failed; polling only");
            None
        }
    };
    loop {
        if *shutdown.borrow() {
            return;
        }
        match run_due_jobs(&state, cohost_only).await {
            Ok(0) => {}
            Ok(_) => continue,
            Err(error) => tracing::error!(%error, "outbox batch failed"),
        }
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tokio::time::sleep(POLL) => {}
            _ = async {
                match listener.as_mut() {
                    Some(l) => { let _ = l.recv().await; }
                    None => std::future::pending::<()>().await,
                }
            } => {}
        }
    }
}

async fn run_due_jobs(state: &AppState, cohost_only: bool) -> Result<usize> {
    let jobs = state.db.lease_jobs(25, LEASE, cohost_only).await?;
    let mut ran = 0;
    for job in jobs {
        ran += 1;
        let started = std::time::Instant::now();
        match handle(state, &job).await {
            Ok(()) => {
                state.db.complete_job(job.id).await?;
                tracing::debug!(id = job.id, kind = %job.kind, ms = started.elapsed().as_millis() as u64, "outbox job done");
            }
            Err(error) => {
                tracing::warn!(id = job.id, kind = %job.kind, attempts = job.attempts, error = %format!("{error:#}"), "outbox job failed");
                state.db.fail_job(job.id, job.attempts, &format!("{error:#}")).await?;
            }
        }
    }
    Ok(ran)
}

fn uuid_field(payload: &Value, key: &str) -> Result<Uuid> {
    payload[key].as_str().and_then(|s| s.parse().ok()).ok_or_else(|| anyhow!("payload missing {key}"))
}

async fn handle(state: &AppState, job: &OutboxJob) -> Result<()> {
    let p = &job.payload;
    match job.kind.as_str() {
        "room.sync" => room_sync(state, uuid_field(p, "live_id")?).await,
        "room.drop" => room_drop(state, uuid_field(p, "live_id")?, uuid_field(p, "item_id")?).await,
        "room.receipt" => room_receipt(state, uuid_field(p, "claim_id")?).await,
        "checkout.open" => checkout_open(state, uuid_field(p, "order_id")?, p["promoted"].as_bool().unwrap_or(false)).await,
        "checkout.payment_reported" => checkout_payment_reported(state, uuid_field(p, "order_id")?).await,
        "checkout.paid" => {
            let order_id = uuid_field(p, "order_id")?;
            refresh_order_card(state, order_id).await?;
            lobby_won(state, order_id).await
        }
        "checkout.cancelled" => {
            let order_id = uuid_field(p, "order_id")?;
            crate::payments::cancel_link(state, &state.db.order_view(order_id).await?).await?;
            refresh_order_card(state, order_id).await
        }
        "checkout.expired" => {
            let claim_id = uuid_field(p, "claim_id")?;
            match state.db.order_for_claim(claim_id).await? {
                Some(order_id) => {
                    crate::payments::cancel_link(state, &state.db.order_view(order_id).await?).await?;
                    refresh_order_card(state, order_id).await
                }
                None => Ok(()),
            }
        }
        "payment.refund" => {
            let order_id = uuid_field(p, "order_id")?;
            let payment_id = p["payment_id"].as_str().ok_or_else(|| anyhow!("payload missing payment_id"))?;
            let amount = p["amount_paise"].as_i64().ok_or_else(|| anyhow!("payload missing amount"))?;
            crate::payments::refund_late(state, order_id, payment_id, amount).await?;
            refresh_order_card(state, order_id).await
        }
        "shop.provision" => shop_provision(state, uuid_field(p, "seller_id")?).await,
        "shop.join" => shop_join(state, uuid_field(p, "seller_id")?, uuid_field(p, "buyer_id")?).await,
        "shop.leave" => shop_leave(state, uuid_field(p, "seller_id")?, uuid_field(p, "buyer_id")?).await,
        "shop.announce_live" => shop_announce_live(state, uuid_field(p, "live_id")?).await,
        "drop.notify" => drop_notify(state, uuid_field(p, "live_id")?).await,
        "drop.report" => drop_report(state, uuid_field(p, "live_id")?).await,
        "conversation.provision" => provision_conversation(state, uuid_field(p, "conversation_id")?).await,
        "cohost.answer" => cohost::answer(state, p).await,
        other => {
            tracing::warn!(kind = other, "unknown outbox job; dropping");
            Ok(())
        }
    }
}

/// Write the room state to the open channel's metadata, one key per part so each stays small.
async fn room_sync(state: &AppState, live_id: Uuid) -> Result<()> {
    let live = state.db.get_live(live_id).await?;
    let seller = state.db.get_seller(live.seller_id).await?;
    let snapshot = state.db.live_snapshot(live_id).await?;
    let mut metadata = BTreeMap::new();
    for key in ["status", "title", "streamUrl", "pinned", "claims", "at"] {
        metadata.insert(key.to_string(), snapshot[key].to_string());
    }
    let mut open = snapshot["open"].clone();
    while open.to_string().len() > METADATA_VALUE_LIMIT {
        match open.as_array_mut() {
            Some(items) if !items.is_empty() => {
                items.pop();
            }
            _ => break,
        }
    }
    metadata.insert("open".into(), open.to_string());
    state
        .nexconn
        .set_open_channel_metadata(&live.nexconn_channel_id, &seller.cohost_user_id, &metadata)
        .await
        .context("set room metadata")?;
    Ok(())
}

async fn room_drop(state: &AppState, live_id: Uuid, item_id: Uuid) -> Result<()> {
    let live = state.db.get_live(live_id).await?;
    let seller = state.db.get_seller(live.seller_id).await?;
    let item = state.db.get_item(item_id).await?;
    let message = cards::drop_card(state, &item, seller.hold_minutes);
    state.nexconn.send_open_channel_message(&seller.cohost_user_id, &live.nexconn_channel_id, &message).await?;
    if !seller.is_demo {
        let price = if item.price_paise == 0 { "free".to_string() } else { crate::money::format_inr(item.price_paise) };
        lobby_post(
            state,
            format!("{} just dropped {} at {}, {price}", item.code, item.title, seller.display_name),
            json!({ "kind": "drop", "slug": live.slug, "shopHandle": seller.handle, "shopName": seller.display_name,
                    "itemCode": item.code, "itemTitle": item.title, "pricePaise": item.price_paise,
                    "imageUrl": item.image_path.as_deref().map(|p| state.media_url(p)) }),
        )
        .await;
    }
    Ok(())
}

/// The Pehle-wide activity channel shown on the home page. Every visitor joins it, so the
/// home page is live: drops starting, items dropping, people winning.
pub const LOBBY_CHANNEL: &str = "lobby";
/// The system sender for lobby posts.
pub const LOBBY_SENDER: &str = "pehle";

/// Create (or keep alive) the lobby channel. Safe to call repeatedly.
pub async fn ensure_lobby(state: &AppState) {
    if let Err(error) = state.chat_token(LOBBY_SENDER, "Pehle", None).await {
        tracing::debug!(%error, "lobby sender token failed");
    }
    if let Err(error) = state.nexconn.create_open_channel(LOBBY_CHANNEL, 7 * 24 * 60).await {
        tracing::debug!(%error, "lobby channel create (it may already exist)");
    }
}

/// Best effort: the lobby is a feed, so a missed post is not retried.
async fn lobby_post(state: &AppState, text: String, data: Value) {
    let mut payload = data;
    payload["t"] = json!("activity");
    let message = pehle_nexconn::Message::text(text, Some(payload));
    if let Err(error) = state.nexconn.send_open_channel_message(LOBBY_SENDER, LOBBY_CHANNEL, &message).await {
        tracing::debug!(%error, "lobby post failed");
    }
}

async fn lobby_won(state: &AppState, order_id: Uuid) -> Result<()> {
    let order = state.db.order_view(order_id).await?;
    let shop = state.db.public_shop_by_id(order.order.seller_id).await?;
    if shop.is_demo {
        return Ok(());
    }
    let verb = if order.order.amount_paise == 0 { "won" } else { "bought" };
    lobby_post(
        state,
        format!("{} {verb} {} at {}", order.buyer_name, order.item_code, order.shop_name),
        json!({ "kind": "won", "slug": order.live_slug, "shopHandle": order.shop_handle, "shopName": order.shop_name,
                "itemCode": order.item_code, "itemTitle": order.item_title, "buyerName": order.buyer_name,
                "imageUrl": order.item_image_path.as_deref().map(|p| state.media_url(p)) }),
    )
    .await;
    Ok(())
}

/// Claims made without chat (the API fallback) get their receipt posted by the co-host.
async fn room_receipt(state: &AppState, claim_id: Uuid) -> Result<()> {
    let entry = state.db.queue_entry(claim_id).await?;
    let (_, live_id, item_id) = state.db.claim_parties(claim_id).await?;
    let live = state.db.get_live(live_id).await?;
    let seller = state.db.get_seller(live.seller_id).await?;
    let item = state.db.get_item(item_id).await?;
    let result = pehle_db::ClaimResult {
        outcome: if entry.status == pehle_db::ClaimStatus::Waitlisted {
            pehle_db::ClaimOutcome::Waitlisted
        } else {
            pehle_db::ClaimOutcome::Held
        },
        claim_id: Some(claim_id),
        order_id: entry.order_id,
        item_id: Some(item.id),
        item_code: Some(item.code),
        item_title: Some(item.title),
        position: Some(entry.position),
        status: Some(entry.status),
        hold_expires_at: entry.hold_expires_at,
        units_left: None,
        waitlist_length: None,
    };
    // Deep waitlist places are private (the buyer sees them in the room's status panel).
    if entry.status == pehle_db::ClaimStatus::Waitlisted
        && state.db.waitlist_length(item_id).await? > i64::from(cards::PUBLIC_WAITLIST)
    {
        return Ok(());
    }
    let source = match entry.source {
        pehle_db::ClaimSource::Youtube => "youtube",
        pehle_db::ClaimSource::Seller => "seller",
        _ => "button",
    };
    let said = entry.said.as_deref().filter(|s| *s != "Claim").unwrap_or("Claim");
    let message = cards::claim_receipt(said, &entry.buyer_name, &result, Some(source));
    state.nexconn.send_open_channel_message(&seller.cohost_user_id, &live.nexconn_channel_id, &message).await?;
    Ok(())
}

/// The buyer↔shop conversation's Nexconn group, created on first use.
async fn conversation_group(state: &AppState, seller_id: Uuid, buyer_id: Uuid) -> Result<String> {
    let conversation = state.db.ensure_conversation(seller_id, buyer_id).await?;
    if !conversation.provisioned {
        provision_conversation(state, conversation.id).await?;
    }
    Ok(conversation.nexconn_group_id)
}

/// Create the conversation's group with the buyer, the shop team and the co-host. Idempotent: if
/// the group already exists (a retried job), the members are joined instead.
pub async fn provision_conversation(state: &AppState, conversation_id: Uuid) -> Result<()> {
    let conversation = state.db.conversation(conversation_id).await?;
    if conversation.provisioned {
        return Ok(());
    }
    let seller = state.db.get_seller(conversation.seller_id).await?;
    let buyer = state.db.get_buyer(conversation.buyer_id).await?;
    state.chat_token(&buyer.nexconn_user_id, &buyer.display_name, buyer.avatar_url.as_deref()).await?;
    let avatar = seller.avatar_path.as_deref().map(|p| state.media_url(p));
    state.chat_token(&seller.cohost_user_id, &seller.display_name, avatar.as_deref()).await?;
    let staff = state.db.staff_chat_ids(seller.id).await?;
    for member in &staff {
        let name = state.db.get_staff_by_chat_id(member).await?.map(|s| s.display_name).unwrap_or_else(|| "Team".into());
        state.chat_token(member, &name, None).await?;
    }
    let members: Vec<&str> = [buyer.nexconn_user_id.as_str(), seller.cohost_user_id.as_str()]
        .into_iter()
        .chain(staff.iter().map(String::as_str))
        .collect();
    let name = format!("{} with {}", seller.display_name, buyer.display_name);
    if let Err(error) = state.nexconn.create_group(&conversation.nexconn_group_id, &name, &seller.cohost_user_id, &members).await {
        tracing::debug!(%error, "group create failed; joining members instead");
        state.nexconn.join_group(&conversation.nexconn_group_id, &members).await.context("join conversation group")?;
    }
    state.db.conversation_provisioned(conversation.id).await?;
    Ok(())
}

/// Post an order card into the buyer↔shop conversation and notify the buyer's browsers.
async fn post_order_card(state: &AppState, order_id: Uuid, promoted: bool) -> Result<()> {
    let order = state.db.order_view(order_id).await?;
    // Demo rivals never touch chat, so they never count as chat users.
    if state.db.get_buyer(order.order.buyer_id).await?.is_bot {
        return Ok(());
    }
    let group = conversation_group(state, order.order.seller_id, order.order.buyer_id).await?;
    let message = cards::order_card(state, &order, promoted);
    let summary = cards::order_push(&order, promoted);
    state.nexconn.send_group_message(&order.shop_cohost_user_id, &group, &message, Some(&summary.body)).await?;
    state.db.touch_conversation(&group).await?;
    let targets = state.db.push_targets_for_buyers(&[order.order.buyer_id]).await?;
    crate::push::notify(state, targets, &summary).await?;
    Ok(())
}

async fn checkout_open(state: &AppState, order_id: Uuid, promoted: bool) -> Result<()> {
    post_order_card(state, order_id, promoted).await
}

async fn refresh_order_card(state: &AppState, order_id: Uuid) -> Result<()> {
    post_order_card(state, order_id, false).await
}

async fn checkout_payment_reported(state: &AppState, order_id: Uuid) -> Result<()> {
    post_order_card(state, order_id, false).await?;
    let order = state.db.order_view(order_id).await?;
    if state.db.get_buyer(order.order.buyer_id).await?.is_bot {
        return Ok(());
    }
    let group = conversation_group(state, order.order.seller_id, order.order.buyer_id).await?;
    let notice = cards::payment_reported_notice(state, &order);
    state.nexconn.send_group_message(&order.shop_cohost_user_id, &group, &notice, Some("A buyer reported a payment")).await?;
    let targets = state.db.push_targets_for_shop_team(order.order.seller_id).await?;
    let push = crate::push::Notification {
        title: format!("{} paid for {}", order.buyer_name, order.item_code),
        body: format!("Check UPI ref {} and confirm.", order.order.upi_reference.as_deref().unwrap_or("-")),
        url: "/studio/orders".into(),
        tag: format!("order-{order_id}"),
    };
    crate::push::notify(state, targets, &push).await?;
    Ok(())
}

/// Tell reminder holders and club members that a drop started.
async fn drop_notify(state: &AppState, live_id: Uuid) -> Result<()> {
    let live = state.db.get_live(live_id).await?;
    let seller = state.db.get_seller(live.seller_id).await?;
    let audience = state.db.take_drop_audience(live_id).await?;
    let ids: Vec<Uuid> = audience.iter().map(|m| m.buyer_id).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let targets = state.db.push_targets_for_buyers(&ids).await?;
    let notification = crate::push::Notification {
        title: format!("{} is live now", seller.display_name),
        body: format!("{}. First to claim gets it.", live.title),
        url: format!("/l/{}", live.slug),
        tag: format!("drop-{}", live.slug),
    };
    let delivered = crate::push::notify(state, targets, &notification).await?;
    tracing::info!(live = %live.slug, audience = ids.len(), delivered, "drop alert sent");
    Ok(())
}

/// After a drop ends, send the shop team its report.
async fn drop_report(state: &AppState, live_id: Uuid) -> Result<()> {
    let live = state.db.get_live(live_id).await?;
    let report = state.db.drop_report(live_id).await?;
    let targets = state.db.push_targets_for_shop_team(live.seller_id).await?;
    let notification = crate::push::Notification {
        title: format!("{}: {} of {} sold", live.title, report.units_sold, report.units_offered),
        body: format!(
            "{} collected. {} non-payers replaced automatically. {} people still waiting.",
            crate::money::format_inr(report.revenue_paise),
            report.non_payers_replaced,
            report.still_waiting
        ),
        url: format!("/studio/drops/{live_id}/report"),
        tag: format!("report-{live_id}"),
    };
    crate::push::notify(state, targets, &notification).await?;
    Ok(())
}

/// First-time Nexconn setup for a shop: the co-host's chat identity and the buyers' group.
async fn shop_provision(state: &AppState, seller_id: Uuid) -> Result<()> {
    let seller = state.db.get_seller(seller_id).await?;
    let avatar = seller.avatar_path.as_deref().map(|p| state.media_url(p));
    state.chat_token(&seller.cohost_user_id, &seller.display_name, avatar.as_deref()).await?;
    let staff = state.db.staff_chat_ids(seller_id).await?;
    for member in &staff {
        // Members must exist on Nexconn before they can be added to a group.
        let name = state.db.get_staff_by_chat_id(member).await?.map(|s| s.display_name).unwrap_or_else(|| "Team".into());
        state.chat_token(member, &name, None).await?;
    }
    let members: Vec<&str> = staff.iter().map(String::as_str).chain([seller.cohost_user_id.as_str()]).collect();
    state
        .nexconn
        .create_group(&seller.nexconn_group_id, &format!("{} buyers", seller.display_name), &seller.cohost_user_id, &members)
        .await?;
    Ok(())
}

async fn shop_join(state: &AppState, seller_id: Uuid, buyer_id: Uuid) -> Result<()> {
    let seller = state.db.get_seller(seller_id).await?;
    let buyer = state.db.get_buyer(buyer_id).await?;
    state.chat_token(&buyer.nexconn_user_id, &buyer.display_name, None).await?;
    state.nexconn.join_group(&seller.nexconn_group_id, &[buyer.nexconn_user_id.as_str()]).await?;
    let welcome = pehle_nexconn::Message::text(
        format!("Welcome to {}'s club, {}. You'll hear here first when they go live.", seller.display_name, buyer.display_name),
        Some(json!({ "t": "joined" })),
    );
    // Only the new member sees their welcome; the rest of the club is not pinged.
    let to = [buyer.nexconn_user_id.as_str()];
    state.nexconn.send_group_message_to(&seller.cohost_user_id, &seller.nexconn_group_id, Some(&to), &welcome, None).await?;
    Ok(())
}

async fn shop_leave(state: &AppState, seller_id: Uuid, buyer_id: Uuid) -> Result<()> {
    let seller = state.db.get_seller(seller_id).await?;
    let buyer = state.db.get_buyer(buyer_id).await?;
    state.nexconn.quit_group(&seller.nexconn_group_id, &[buyer.nexconn_user_id.as_str()]).await?;
    Ok(())
}

async fn shop_announce_live(state: &AppState, live_id: Uuid) -> Result<()> {
    let live = state.db.get_live(live_id).await?;
    let seller = state.db.get_seller(live.seller_id).await?;
    let message = cards::live_announcement(state, &seller.display_name, &live.title, &live.slug);
    let push = format!("{} is live now", seller.display_name);
    state.nexconn.send_group_message(&seller.cohost_user_id, &seller.nexconn_group_id, &message, Some(&push)).await?;
    if !seller.is_demo {
        lobby_post(
            state,
            format!("{} is live: {}", seller.display_name, live.title),
            json!({ "kind": "live", "slug": live.slug, "shopHandle": seller.handle, "shopName": seller.display_name,
                    "title": live.title, "imageUrl": seller.avatar_path.as_deref().map(|p| state.media_url(p)) }),
        )
        .await;
    }
    Ok(())
}

/// Backup for missed gateway webhooks: ask Razorpay about open payment links every few seconds.
async fn payment_poll_loop(state: AppState, mut shutdown: watch::Receiver<bool>) {
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tick.tick() => {}
        }
        let targets = match state.db.payment_links_to_poll(50).await {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!(%error, "payment poll query failed");
                continue;
            }
        };
        for target in targets {
            if let Err(error) = crate::payments::check_link(&state, target.seller_id, target.order_id, &target.payment_link_id).await {
                tracing::debug!(error = %format!("{error:#}"), order = %target.order_id, "payment poll failed");
            }
        }
    }
}

async fn holds_loop(state: AppState, mut shutdown: watch::Receiver<bool>) {
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tick.tick() => {}
        }
        match state.db.expire_due_holds(100).await {
            Ok(expired) if !expired.is_empty() => tracing::info!(count = expired.len(), "expired unpaid holds"),
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "hold expiry failed"),
        }
    }
}

async fn housekeeping_loop(state: AppState, mut shutdown: watch::Receiver<bool>) {
    let mut tick = tokio::time::interval(Duration::from_secs(3600));
    loop {
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tick.tick() => {}
        }
        ensure_lobby(&state).await;
        match state.db.housekeeping().await {
            Ok(done) => tracing::debug!(%done, "housekeeping"),
            Err(error) => tracing::warn!(%error, "housekeeping failed"),
        }
    }
}
