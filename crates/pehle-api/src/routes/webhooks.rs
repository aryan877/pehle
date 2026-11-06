//! `POST /webhooks/nexconn`: every Nexconn webhook.
//!
//! `open_channel:pre_messaging` is the claim path. Nexconn holds each room message until we reply
//! (five seconds at most), so every claim is ordered by the database before anyone else sees it,
//! and the reply rewrites the buyer's message into a receipt the whole room can read.

use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{TimeZone, Utc};
use pehle_db::claims::ClaimRequest;
use pehle_db::{ClaimOutcome, ClaimSource, Live, LiveStatus};
use pehle_nexconn::TextMessage;
use pehle_nexconn::webhook::{self, Envelope, PreMessaging, PreMessagingReply, Verification};
use serde_json::json;

use crate::cards;
use crate::intent::{Intent, classify};
use crate::state::AppState;

/// Leave Nexconn margin inside its five-second window.
const PRE_MESSAGING_BUDGET: Duration = Duration::from_millis(3500);

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or_default()
}

pub async fn nexconn(State(state): State<AppState>, headers: HeaderMap, body: String) -> Response {
    match &state.config.nexconn {
        Some(nexconn) => {
            let verdict = webhook::verify(
                &nexconn.app_key,
                &nexconn.app_secret,
                header(&headers, "appkey"),
                header(&headers, "nonce"),
                header(&headers, "timestamp"),
                header(&headers, "signature"),
                Utc::now().timestamp_millis(),
            );
            if verdict != Verification::Valid {
                tracing::warn!(?verdict, "rejected nexconn webhook");
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
        // Without keys only local development may post unsigned webhooks (used by the simulator).
        None if state.config.dev_login => {}
        None => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }

    let envelope: Envelope = match serde_json::from_str(&body) {
        Ok(e) => e,
        Err(error) => {
            tracing::warn!(%error, "unparseable nexconn webhook");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    if envelope.kind.ends_with(":pre_messaging") {
        let reply = match (envelope.kind.as_str(), envelope.data.first()) {
            ("open_channel:pre_messaging", Some(item)) => match serde_json::from_value::<PreMessaging>(item.clone()) {
                Ok(message) => match tokio::time::timeout(PRE_MESSAGING_BUDGET, pre_messaging(&state, message)).await {
                    Ok(reply) => reply,
                    Err(_) => {
                        tracing::error!("pre-messaging decision timed out; delivering unchanged");
                        PreMessagingReply::deliver()
                    }
                },
                Err(error) => {
                    tracing::warn!(%error, "bad pre-messaging payload");
                    PreMessagingReply::deliver()
                }
            },
            _ => PreMessagingReply::deliver(),
        };
        return Json(reply).into_response();
    }

    // Other events are informational and may be retried; act on each once.
    match state.db.first_sighting(&envelope.id, &envelope.kind).await {
        Ok(true) => observe(&state, &envelope).await,
        Ok(false) => {}
        Err(error) => tracing::error!(%error, "webhook idempotency check failed"),
    }
    Json(json!({})).into_response()
}

async fn observe(state: &AppState, envelope: &Envelope) {
    // A message in a buyer↔shop conversation moves it to the top of both inboxes, and a buyer's
    // question there gets an answer from the shop's co-host.
    if envelope.kind == "message:send" {
        for item in &envelope.data {
            let Some(channel) = item["channelId"].as_str().filter(|c| pehle_nexconn::ids::is_conversation(c)) else {
                continue;
            };
            if let Err(error) = state.db.touch_conversation(channel).await {
                tracing::debug!(%error, "conversation touch failed");
            }
            let sender = item["userId"].as_str().unwrap_or_default();
            if state.config.cohost.is_none()
                || pehle_nexconn::ids::kind(sender) != Some(pehle_nexconn::ids::Kind::Buyer)
                || item["messageType"] != "RC:TxtMsg"
            {
                continue;
            }
            let Some(text) = item["content"].as_str().and_then(TextMessage::parse) else { continue };
            if !matches!(classify(&text.content, &[]), Intent::Question) {
                continue;
            }
            if let (Ok(Some(conversation)), Ok(Some(buyer))) =
                (state.db.conversation_by_group(channel).await, state.db.buyer_by_chat_id(sender).await)
            {
                let message_id = item["messageId"].as_str().unwrap_or_default();
                let job = json!({ "conversation_id": conversation, "buyer_id": buyer.id, "question": text.content, "message_id": message_id });
                let _ = state.db.enqueue("cohost.answer", job, Some(&format!("cohost:{message_id}"))).await;
            }
        }
    }
    // Room state is written only by the server (as the co-host). Anyone else who overwrites a key
    // from a browser gets it put back by a fresh sync.
    if envelope.kind == "open_channel:metadata_update" {
        for item in &envelope.data {
            let writer = item["userId"].as_str().unwrap_or_default();
            if pehle_nexconn::ids::kind(writer) != Some(pehle_nexconn::ids::Kind::Cohost)
                && let Some(channel) = item["channelId"].as_str()
                && let Ok(Some(live)) = state.db.live_by_channel(channel).await
            {
                tracing::warn!(%writer, channel, "room state written by a participant; restoring");
                let _ = state.db.enqueue("room.sync", json!({ "live_id": live.id }), Some(&format!("room.sync:{}", live.id))).await;
            }
        }
    }
    // Every chat connection, signed in or not, is a person using Pehle: the traction record.
    if envelope.kind == "user:connection_status" {
        for item in &envelope.data {
            if let Ok(status) = serde_json::from_value::<webhook::ConnectionStatus>(item.clone())
                && status.status == "0"
                && pehle_nexconn::ids::kind(&status.user_id).is_some()
            {
                let buyer = state.db.buyer_by_chat_id(&status.user_id).await.ok().flatten().map(|b| b.id);
                let data = json!({ "userId": status.user_id, "os": status.os });
                let _ = state.db.record_event("chat.online", None, None, buyer, data).await;
            }
        }
    }
    // Joins per drop room, including signed-out viewers, for the drop report.
    if envelope.kind == "open_channel:operation" {
        for item in &envelope.data {
            if item["operationType"].as_i64() == Some(1)
                && let Some(channel) = item["channelId"].as_str()
                && let Ok(Some(live)) = state.db.live_by_channel(channel).await
            {
                let users = item["userIds"].clone();
                let _ = state.db.record_event("room.entered", Some(live.seller_id), Some(live.id), None, json!({ "users": users })).await;
            }
        }
    }
}

/// Decide one open-channel message.
async fn pre_messaging(state: &AppState, message: PreMessaging) -> PreMessagingReply {
    // The home page's activity feed is written by the server only.
    if message.channel_id == crate::workers::LOBBY_CHANNEL {
        return PreMessagingReply::block(json!({ "pehle": { "t": "refused", "outcome": "read_only", "message": "This feed is read-only." } }).to_string());
    }
    // Signed-out viewers can watch but not speak.
    if pehle_nexconn::ids::kind(&message.user_id) == Some(pehle_nexconn::ids::Kind::Viewer) {
        return PreMessagingReply::block(
            json!({ "pehle": { "t": "refused", "outcome": "sign_in", "message": "Sign in to chat and claim." } }).to_string(),
        );
    }
    if message.message_type != "RC:TxtMsg" || pehle_nexconn::ids::kind(&message.user_id) != Some(pehle_nexconn::ids::Kind::Buyer) {
        return PreMessagingReply::deliver();
    }
    let live = match state.db.live_by_channel(&message.channel_id).await {
        Ok(Some(live)) => live,
        Ok(None) => return PreMessagingReply::deliver(),
        Err(error) => {
            tracing::error!(%error, "live lookup failed");
            return PreMessagingReply::deliver();
        }
    };
    let Some(text) = TextMessage::parse(&message.content) else {
        return PreMessagingReply::deliver();
    };
    let buyer = match state.db.buyer_by_chat_id(&message.user_id).await {
        Ok(Some(buyer)) => buyer,
        _ => return PreMessagingReply::deliver(),
    };

    // The Claim button sends `{"t":"claim","code":"S12"}`; typed messages go through the matcher.
    let (intent, source) = match text.pehle_payload() {
        Some(payload) if payload["t"] == "claim" => {
            let code = payload["code"].as_str().map(str::to_string);
            (Intent::Claim { code }, ClaimSource::Button)
        }
        _ => {
            let codes = match state.db.open_items(live.id).await {
                Ok(items) => items.into_iter().map(|i| i.code).collect::<Vec<_>>(),
                Err(_) => Vec::new(),
            };
            (classify(&text.content, &codes), ClaimSource::Chat)
        }
    };

    // Demo guests can only claim in the demo shop.
    if matches!(intent, Intent::Claim { .. })
        && crate::routes::rooms::require_claim_access(state, &buyer, live.seller_id).await.is_err()
    {
        return PreMessagingReply::block(
            json!({ "pehle": { "t": "refused", "outcome": "sign_in", "message": "Sign in with Google or your phone to claim in real shops." } })
                .to_string(),
        );
    }

    match intent {
        Intent::Claim { code } if live.status == LiveStatus::Live => {
            claim_from_chat(state, &live, &buyer, &text.content, code.as_deref(), source, &message).await
        }
        Intent::Question => {
            if state.config.cohost.is_some() {
                let job = json!({
                    "live_id": live.id, "buyer_id": buyer.id, "question": text.content, "message_id": message.message_id,
                });
                if let Err(error) = state.db.enqueue("cohost.answer", job, Some(&format!("cohost:{}", message.message_id))).await {
                    tracing::warn!(%error, "could not queue co-host answer");
                }
            }
            deliver_privately(&text.content)
        }
        _ => deliver_privately(&text.content),
    }
}

/// Deliver a buyer's chat line, with any phone number, UPI ID or email hidden from the room.
fn deliver_privately(text: &str) -> PreMessagingReply {
    match crate::privacy::mask_contact_details(text) {
        Some(masked) => PreMessagingReply::replace(pehle_nexconn::Message::text(masked, Some(json!({ "t": "masked" }))).content_json()),
        None => PreMessagingReply::deliver(),
    }
}

async fn claim_from_chat(
    state: &AppState,
    live: &Live,
    buyer: &pehle_db::Buyer,
    said: &str,
    code: Option<&str>,
    source: ClaimSource,
    message: &PreMessaging,
) -> PreMessagingReply {
    let received_at = Utc.timestamp_millis_opt(message.time).single();
    let result = match state
        .db
        .claim(ClaimRequest {
            live_id: live.id,
            buyer_id: buyer.id,
            item_code: code,
            source,
            said,
            message_id: Some(&message.message_id),
            received_at,
        })
        .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::error!(%error, "claim failed; delivering message unchanged");
            return PreMessagingReply::deliver();
        }
    };
    tracing::info!(live = %live.slug, buyer = %buyer.id, outcome = ?result.outcome, position = ?result.position, "claim");

    let shown = if source == ClaimSource::Button { "Claim" } else { said };
    match result.outcome {
        ClaimOutcome::Waitlisted if result.waitlist_length.unwrap_or_default() > cards::PUBLIC_WAITLIST => {
            PreMessagingReply::block(cards::private_waitlist(&result))
        }
        ClaimOutcome::Held | ClaimOutcome::Waitlisted | ClaimOutcome::Already | ClaimOutcome::Replay => {
            PreMessagingReply::replace(cards::claim_receipt(shown, &buyer.display_name, &result, None).content_json())
        }
        ClaimOutcome::HoldLimit | ClaimOutcome::Closed | ClaimOutcome::Blocked => {
            let limit = state.db.get_seller(live.seller_id).await.map(|s| s.max_holds_per_buyer).unwrap_or(3);
            PreMessagingReply::block(cards::refusal(&result, limit).unwrap_or_default())
        }
        // Not a claimable moment: let the words through as ordinary chat.
        ClaimOutcome::NoItem | ClaimOutcome::NotLive => PreMessagingReply::deliver(),
    }
}
