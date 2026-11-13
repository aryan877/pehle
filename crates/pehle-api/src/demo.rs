//! The public demo drop. A judge (or a seller deciding whether to use Pehle) opens `/try`, taps
//! "Start a race", and competes with four scripted rivals for one piece. The rivals claim within
//! about two seconds; then whoever holds the piece without paying lapses every few seconds, so the
//! visitor watches the waitlist hand the piece down until it reaches them. Everything runs through
//! the same claim rules, open channel and checkout as a real shop; only the rivals are scripted,
//! and they never connect to chat, so they never count as chat users.

use std::time::Duration;

use anyhow::{Context, Result};
use pehle_db::claims::ClaimRequest;
use pehle_db::items::NewItem;
use pehle_db::lives::DropInput;
use pehle_db::{Buyer, ClaimSource, ClaimStatus, Live, Seller};
use rand::Rng;
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

const DEMO_EMAIL: &str = "demo@pehle.app";

struct Preset {
    title: &'static str,
    price_paise: i64,
    photo: &'static str,
}

const PRESETS: &[Preset] = &[
    Preset { title: "Kanjivaram silk saree, temple border", price_paise: 450_000, photo: "s12.jpg" },
    Preset { title: "Banarasi silk saree, peacock blue", price_paise: 380_000, photo: "s13.jpg" },
    Preset { title: "Glass bangle stack, festive colours", price_paise: 89_900, photo: "b4.jpg" },
    Preset { title: "Chanderi cotton, handloom", price_paise: 180_000, photo: "s14.jpg" },
];

/// What the visitor needs to join the current race.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DemoRace {
    pub slug: String,
    pub item_code: String,
    pub item_title: String,
    /// False when the visitor joined a race that was already running.
    pub started: bool,
}

async fn demo_staff(state: &AppState) -> Result<pehle_db::Staff> {
    Ok(state.db.upsert_dev_staff(DEMO_EMAIL, "Pehle demo").await?)
}

/// Create the demo shop, its rivals and photos. Safe to run on every start.
pub async fn setup(state: &AppState) -> Result<()> {
    let staff = demo_staff(state).await?;
    let shop = state.db.setup_demo_shop(staff.id).await?;
    state.db.demo_bots().await?;
    if shop.avatar_path.is_none()
        && let Ok(bytes) = tokio::fs::read(state.config.demo_assets.join("s12.jpg")).await
    {
        let path = crate::routes::media::store(state, &bytes).await?;
        state.db.set_shop_image(shop.id, staff.id, pehle_db::shops::ShopImage::Avatar, &path).await?;
    }
    tracing::info!(shop = %shop.handle, "demo shop ready");
    Ok(())
}

/// The demo shop's running drop, starting one (with its Nexconn room) when needed.
pub async fn ensure_live(state: &AppState) -> Result<(Seller, Live)> {
    let staff = demo_staff(state).await?;
    let shop = state.db.setup_demo_shop(staff.id).await?;
    if let Some(live) = state.db.demo_live().await? {
        return Ok((shop, live));
    }
    let live = state
        .db
        .create_live(
            shop.id,
            staff.id,
            DropInput {
                title: "Demo drop: one piece, five buyers",
                description: Some("Race four rival buyers for one piece. Nobody is charged and nothing ships."),
                stream_url: None,
                youtube_video_id: None,
                scheduled_for: None,
                item_ids: &[],
            },
        )
        .await?;
    crate::routes::studio::open_room(state, &live).await.context("open the demo room")?;
    let live = state.db.start_live(live.id, staff.id).await?;
    Ok((shop, live))
}

/// Start a race for one fresh piece, or join the one already running.
pub async fn race(state: &AppState) -> Result<DemoRace> {
    let Ok(_guard) = state.demo_lock.try_lock() else {
        return current_race(state).await?.context("a race is starting; try again in a second");
    };
    if let Some(running) = current_race(state).await? {
        return Ok(running);
    }
    let staff = demo_staff(state).await?;
    let (shop, live) = ensure_live(state).await?;
    for open in state.db.open_items(live.id).await? {
        state.db.close_item(live.id, open.id, staff.id).await?;
    }

    let round = state.db.items_with_counts(shop.id).await?.len();
    let preset = &PRESETS[round % PRESETS.len()];
    let photo = match tokio::fs::read(state.config.demo_assets.join(preset.photo)).await {
        Ok(bytes) => Some(crate::routes::media::store(state, &bytes).await?),
        Err(_) => None,
    };
    let code = format!("R{}", 100 + round % 900);
    let item = state
        .db
        .create_item(
            shop.id,
            staff.id,
            NewItem {
                code: &code,
                title: preset.title,
                description: Some("Demo piece. Nobody is charged and nothing ships."),
                price_paise: preset.price_paise,
                quantity: 1,
                image_path: photo.as_deref(),
                gallery_paths: None,
                winner_note: Some("You won the demo piece. In a real shop this note carries a coupon, a link or delivery details."),
            },
        )
        .await?;
    state.db.drop_item(live.id, item.id, staff.id).await?;

    let rivals = state.db.demo_bots().await?;
    tokio::spawn(run_rivals(state.clone(), live.id, item.id, rivals));
    Ok(DemoRace { slug: live.slug, item_code: item.code, item_title: item.title, started: true })
}

/// A race counts as running while its piece opened less than two minutes ago.
async fn current_race(state: &AppState) -> Result<Option<DemoRace>> {
    let Some(live) = state.db.demo_live().await? else {
        return Ok(None);
    };
    let open = state.db.open_items(live.id).await?;
    for item in open {
        let full = state.db.get_item(item.id).await?;
        if full.opened_at.is_some_and(|at| chrono::Utc::now() - at < chrono::Duration::minutes(2)) {
            return Ok(Some(DemoRace { slug: live.slug, item_code: item.code, item_title: item.title, started: false }));
        }
    }
    Ok(None)
}

/// Rivals claim in the first two seconds, then whoever holds the piece without paying lapses
/// every eight seconds until a real visitor holds it or nobody is waiting.
async fn run_rivals(state: AppState, live_id: uuid::Uuid, item_id: uuid::Uuid, rivals: Vec<Buyer>) {
    let mut delays: Vec<u64> = {
        let mut rng = rand::rng();
        rivals.iter().map(|_| rng.random_range(350..2200)).collect()
    };
    delays.sort_unstable();
    let mut elapsed = 0;
    for (rival, at) in rivals.iter().zip(delays) {
        tokio::time::sleep(Duration::from_millis(at - elapsed)).await;
        elapsed = at;
        let request = ClaimRequest {
            live_id,
            buyer_id: rival.id,
            item_code: None,
            source: ClaimSource::Button,
            said: "mine",
            message_id: None,
            received_at: None,
        };
        if let Err(error) = state.db.claim(request).await {
            tracing::debug!(%error, "demo rival claim failed");
        }
    }
    let rival_ids: Vec<uuid::Uuid> = rivals.iter().map(|r| r.id).collect();
    for _ in 0..8 {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let Ok(queue) = state.db.queue_for_live(live_id).await else { return };
        let holder = queue.iter().find(|q| q.item_id == item_id && q.status == ClaimStatus::Held);
        let waiting = queue.iter().any(|q| q.item_id == item_id && q.status == ClaimStatus::Waitlisted);
        match holder {
            Some(h) if rival_ids.contains(&h.buyer_id) && waiting => {
                if let Err(error) = state.db.demo_lapse_hold(h.claim_id).await {
                    tracing::debug!(%error, "demo lapse failed");
                }
            }
            _ => return,
        }
    }
}

/// A practice shop for someone trying the seller side: a private shop with three sample items,
/// signed in as its owner. Only practice buyers (the demo guest accounts) can claim there.
pub async fn practice_shop(state: &AppState, staff_id: uuid::Uuid) -> Result<Seller> {
    let shop = state.db.create_practice_shop(staff_id).await?;
    if state.db.items_with_counts(shop.id).await?.is_empty() {
        for (n, preset) in PRESETS.iter().take(3).enumerate() {
            let photo = match tokio::fs::read(state.config.demo_assets.join(preset.photo)).await {
                Ok(bytes) => Some(crate::routes::media::store(state, &bytes).await?),
                Err(_) => None,
            };
            let code = format!("P{}", n + 1);
            state
                .db
                .create_item(
                    shop.id,
                    staff_id,
                    NewItem {
                        code: &code,
                        title: preset.title,
                        description: Some("A practice item. Edit it, or add your own."),
                        price_paise: preset.price_paise,
                        quantity: 1,
                        image_path: photo.as_deref(),
                        gallery_paths: None,
                        winner_note: None,
                    },
                )
                .await?;
        }
    }
    Ok(shop)
}

/// In the demo shop a reported UPI payment is confirmed by the "seller" a few seconds later.
pub fn confirm_soon(state: &AppState, order_id: uuid::Uuid) {
    let state = state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        // The shop's own owner confirms: the demo seller, or the person running a practice shop.
        let owner = async {
            let order = state.db.order_view(order_id).await?;
            let chat_id = state.db.staff_chat_ids(order.order.seller_id).await?.into_iter().next();
            let staff = match chat_id {
                Some(id) => state.db.get_staff_by_chat_id(&id).await?,
                None => None,
            };
            anyhow::Ok(staff)
        };
        match owner.await {
            Ok(Some(staff)) => {
                if let Err(error) = state.db.confirm_payment(order_id, staff.id).await {
                    tracing::debug!(%error, "demo confirmation failed");
                }
            }
            Ok(None) => tracing::debug!("demo shop has no owner"),
            Err(error) => tracing::debug!(error = %format!("{error:#}"), "demo confirmation lookup failed"),
        }
    });
}
