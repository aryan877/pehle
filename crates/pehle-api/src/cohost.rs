//! The AI co-host: answers buyers' questions in the room from the shop's own policies and live stock,
//! in the buyer's language. Anything that costs the seller money or bends a rule (discounts, cash on
//! delivery exceptions, longer holds) is never promised; it becomes an approval for the shop team.

use anyhow::{Context, Result, anyhow};
use pehle_nexconn::Message;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::money::format_inr;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct Decision {
    answer: String,
    #[serde(default)]
    needs_seller: bool,
    #[serde(default)]
    kind: Option<String>,
}

const SYSTEM_PROMPT: &str = r#"You are the co-host for an Indian shop that sells in live drops, answering either in the drop's public chat or in a buyer's private chat with the shop.
Buyers ask about price, size, fabric, colour, delivery, cash on delivery, returns and stock.

Rules:
- Answer in one or two short sentences, in the same language and script the buyer used. If they wrote Hinglish, reply in Hinglish.
- Use only the facts provided below. If a fact is missing, say the shop will reply shortly. Never invent prices, sizes or dates.
- To claim an item, buyers type "mine" or the item code. Mention this when someone asks how to buy.
- Never promise a discount, a price change, cash on delivery where the policy does not allow it, a longer hold, or keeping an item aside. For those, reply that you have asked the shop, and set needs_seller to true with kind "discount", "cod", "extend_hold" or "other".
- Be warm and brief. No emojis beyond one at most.

Reply with JSON only: {"answer": string, "needs_seller": boolean, "kind": string or null}"#;

fn uuid_field(payload: &Value, key: &str) -> Result<Uuid> {
    payload[key].as_str().and_then(|s| s.parse().ok()).ok_or_else(|| anyhow!("payload missing {key}"))
}

/// Where the question was asked, and so where the answer goes.
enum Place {
    /// The drop's open channel, answered in front of everyone.
    Room { live_id: Uuid, channel_id: String },
    /// The buyer's private conversation with the shop (a group channel).
    Conversation { group_id: String },
}

pub async fn answer(state: &AppState, payload: &Value) -> Result<()> {
    let Some(config) = &state.config.cohost else {
        return Ok(());
    };
    let buyer_id = uuid_field(payload, "buyer_id")?;
    let question = payload["question"].as_str().unwrap_or_default();
    if question.trim().is_empty() {
        return Ok(());
    }
    let buyer = state.db.get_buyer(buyer_id).await?;
    let (place, seller, facts) = if let Ok(conversation_id) = uuid_field(payload, "conversation_id") {
        let conversation = state.db.conversation(conversation_id).await?;
        let seller = state.db.get_seller(conversation.seller_id).await?;
        let catalogue: Vec<Value> = state
            .db
            .items_with_counts(seller.id)
            .await?
            .into_iter()
            .take(40)
            .map(|i| {
                json!({
                    "code": i.item.code, "title": i.item.title, "description": i.item.description,
                    "price": if i.item.price_paise == 0 { "free".to_string() } else { format_inr(i.item.price_paise) },
                    "pieces_left": i.units_left, "open_for_claims_now": i.item.open_live_id.is_some(),
                })
            })
            .collect();
        let orders: Vec<Value> = state
            .db
            .orders_between(seller.id, buyer_id)
            .await?
            .into_iter()
            .take(10)
            .map(|o| json!({ "item": o.item_code, "title": o.item_title, "status": o.order.status, "amount": format_inr(o.order.amount_paise) }))
            .collect();
        let upcoming: Vec<Value> = state
            .db
            .lives_for_seller(seller.id)
            .await?
            .into_iter()
            .filter(|l| l.status != pehle_db::LiveStatus::Ended)
            .take(5)
            .map(|l| json!({ "title": l.title, "status": l.status, "starts": l.scheduled_for, "link": state.room_url(&l.slug) }))
            .collect();
        let facts = json!({
            "shop": seller.display_name,
            "catalogue": catalogue,
            "this_buyers_orders": orders,
            "upcoming_or_live_drops": upcoming,
            "hold_minutes": seller.hold_minutes,
            "payment": "UPI or the shop's payment link, sent in this chat after a buyer wins a claim",
            "policies": seller.policies,
        });
        (Place::Conversation { group_id: conversation.nexconn_group_id }, seller, facts)
    } else {
        let live_id = uuid_field(payload, "live_id")?;
        let live = state.db.get_live(live_id).await?;
        let seller = state.db.get_seller(live.seller_id).await?;
        let items = state.db.open_items(live_id).await?;
        let snapshot = state.db.live_snapshot(live_id).await?;
        let stock: Vec<Value> = items
            .iter()
            .map(|i| {
                json!({
                    "code": i.code, "title": i.title, "description": i.description,
                    "price": if i.price_paise == 0 { "free".to_string() } else { format_inr(i.price_paise) },
                    "pieces_left": i.units_left, "waitlist": i.waitlist,
                })
            })
            .collect();
        let facts = json!({
            "shop": seller.display_name,
            "pinned_item_code": snapshot["pinned"]["code"],
            "items_open_now": stock,
            "hold_minutes": seller.hold_minutes,
            "payment": "UPI or the shop's payment link, in the buyer's private chat with the shop after they win a claim",
            "policies": seller.policies,
        });
        (Place::Room { live_id: live.id, channel_id: live.nexconn_channel_id }, seller, facts)
    };

    let decision = ask_model(state, config, &facts, &buyer.display_name, question).await?;
    let answer: String = decision.answer.trim().chars().take(400).collect();
    if answer.is_empty() {
        return Ok(());
    }

    let live_id = match &place {
        Place::Room { live_id, .. } => Some(*live_id),
        Place::Conversation { .. } => None,
    };
    let mut reply_payload = json!({ "t": "cohost", "replyTo": payload["message_id"], "buyerName": buyer.display_name });
    let text = if decision.needs_seller {
        // Only the kinds the approvals table accepts; anything else is "other".
        let kind = decision.kind.as_deref().filter(|k| matches!(*k, "discount" | "cod" | "extend_hold")).unwrap_or("other");
        let approval_id = state.db.create_approval(seller.id, live_id, buyer_id, kind, question, &answer).await?;
        reply_payload["approvalId"] = json!(approval_id);
        let targets = state.db.push_targets_for_shop_team(seller.id).await?;
        let notification = crate::push::Notification {
            title: format!("{} needs your answer", buyer.display_name),
            body: question.chars().take(120).collect(),
            url: "/studio".into(),
            tag: format!("approval-{approval_id}"),
        };
        crate::push::notify(state, targets, &notification).await?;
        format!("@{} I've asked the shop. They'll reply here in a moment.", buyer.display_name)
    } else {
        format!("@{} {answer}", buyer.display_name)
    };
    let message = Message::text(text, Some(reply_payload));
    match place {
        Place::Room { channel_id, .. } => state.nexconn.send_open_channel_message(&seller.cohost_user_id, &channel_id, &message).await?,
        Place::Conversation { group_id } => {
            state.nexconn.send_group_message(&seller.cohost_user_id, &group_id, &message, None).await?;
            state.db.touch_conversation(&group_id).await?;
        }
    }
    Ok(())
}

async fn ask_model(state: &AppState, config: &crate::config::CohostConfig, facts: &Value, name: &str, question: &str) -> Result<Decision> {
    let body = json!({
        "model": config.model,
        "temperature": 0.2,
        "max_tokens": 200,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "system", "content": format!("Facts:\n{facts}") },
            { "role": "user", "content": format!("{name} asks: {question}") },
        ],
    });
    let mut request = state
        .http
        .post(format!("{}/chat/completions", config.api_url.trim_end_matches('/')))
        .bearer_auth(&config.api_key);
    if config.api_url.contains("opencode.ai") {
        request = request.header("x-opencode-session", "pehle-cohost");
    }
    let response: Value = request
        .json(&body)
        .send()
        .await
        .context("co-host model request")?
        .error_for_status()
        .context("co-host model status")?
        .json()
        .await?;
    let content = response["choices"][0]["message"]["content"].as_str().unwrap_or_default();
    serde_json::from_str(strip_fences(content)).context("co-host reply was not JSON")
}

/// Post the shop's decision where the question was asked: the drop's room or the conversation.
pub async fn post_decision(state: &AppState, approval: &pehle_db::approvals::Approval) -> Result<()> {
    let (Some(buyer_id), Some(buyer_name)) = (approval.buyer_id, approval.buyer_name.as_deref()) else {
        return Ok(());
    };
    let seller = state.db.get_seller(approval.seller_id).await?;
    let text = match approval.status {
        pehle_db::ApprovalStatus::Approved => format!("@{buyer_name} {}", approval.proposed_reply),
        _ => format!("@{buyer_name} Sorry, the shop can't do that one."),
    };
    let message = Message::text(text, Some(json!({ "t": "cohost", "approvalId": approval.id, "decided": approval.status })));
    match approval.live_id {
        Some(live_id) => {
            let live = state.db.get_live(live_id).await?;
            state.nexconn.send_open_channel_message(&seller.cohost_user_id, &live.nexconn_channel_id, &message).await?;
        }
        None => {
            let conversation = state.db.ensure_conversation(seller.id, buyer_id).await?;
            state.nexconn.send_group_message(&seller.cohost_user_id, &conversation.nexconn_group_id, &message, None).await?;
        }
    }
    Ok(())
}

fn strip_fences(text: &str) -> &str {
    let trimmed = text.trim();
    let trimmed = trimmed.strip_prefix("```json").or_else(|| trimmed.strip_prefix("```")).unwrap_or(trimmed);
    trimmed.strip_suffix("```").unwrap_or(trimmed).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_model_json_with_or_without_fences() {
        let plain = r#"{"answer":"S12 is ₹4,500.","needs_seller":false,"kind":null}"#;
        let fenced = format!("```json\n{plain}\n```");
        for text in [plain.to_string(), fenced] {
            let decision: Decision = serde_json::from_str(strip_fences(&text)).unwrap();
            assert_eq!(decision.answer, "S12 is ₹4,500.");
            assert!(!decision.needs_seller);
        }
    }
}
