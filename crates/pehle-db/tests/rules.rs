//! Claim rules, run against a fresh database per test (`#[sqlx::test]` creates and migrates it).
//! Requires DATABASE_URL pointing at a Postgres role that may create databases.
//!
//! Every test talks to the database the way the API does: through a pool whose connections run as
//! the restricted `pehle_api` role. The owner pool is used only to fake the passage of time.

use futures::future::join_all;
use pehle_db::claims::ClaimRequest;
use pehle_db::items::NewItem;
use pehle_db::lives::DropInput;
use pehle_db::orders::PaymentReport;
use pehle_db::shops::NewShop;
use pehle_db::{ClaimOutcome, ClaimSource, ClaimStatus, Db, DbError, OrderStatus};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use uuid::Uuid;

pub struct Shop {
    pub db: Db,
    pub owner: PgPool,
    pub staff_id: Uuid,
    pub seller_id: Uuid,
    pub live_id: Uuid,
    pub item_id: Uuid,
}

/// The API's view of the database (restricted role) plus an owner pool for test-only time travel.
pub async fn connect(options: PgPoolOptions, connect: PgConnectOptions) -> (Db, PgPool) {
    let owner = PgPoolOptions::new().max_connections(2).connect_with(connect.clone()).await.unwrap();
    let pool = Db::restricted_pool(options.max_connections(20)).connect_with(connect).await.unwrap();
    (Db::from_pool(pool), owner)
}

pub fn item<'a>(code: &'a str, price_paise: i64, quantity: i32) -> NewItem<'a> {
    NewItem {
        code,
        title: "Kanjivaram silk, maroon",
        description: None,
        price_paise,
        quantity,
        image_path: None,
        gallery_paths: None,
        winner_note: None,
    }
}

pub fn drop_input<'a>(title: &'a str, item_ids: &'a [Uuid]) -> DropInput<'a> {
    DropInput { title, description: None, stream_url: None, youtube_video_id: None, scheduled_for: None, item_ids }
}

async fn shop_with_priced_item(options: PgPoolOptions, connect_options: PgConnectOptions, quantity: i32, price_paise: i64) -> Shop {
    let (db, owner) = connect(options, connect_options).await;
    let staff = db.upsert_dev_staff("owner@meera.in", "Meera").await.unwrap();
    let seller = db
        .create_shop(
            staff.id,
            NewShop {
                handle: "meera-sarees",
                display_name: "Meera Sarees",
                category: "sarees",
                city: Some("Noida"),
                upi_vpa: Some("meera@okaxis"),
                upi_payee_name: Some("Meera"),
            },
        )
        .await
        .unwrap();
    let item = db.create_item(seller.id, staff.id, item("s12", price_paise, quantity)).await.unwrap();
    assert_eq!(item.code, "S12");
    let live = db.create_live(seller.id, staff.id, drop_input("Diwali silk drop", &[item.id])).await.unwrap();
    db.start_live(live.id, staff.id).await.unwrap();
    db.drop_item(live.id, item.id, staff.id).await.unwrap();
    Shop { db, owner, staff_id: staff.id, seller_id: seller.id, live_id: live.id, item_id: item.id }
}

async fn shop_with_open_item(options: PgPoolOptions, connect_options: PgConnectOptions, quantity: i32) -> Shop {
    shop_with_priced_item(options, connect_options, quantity, 450_000).await
}

async fn buyers(db: &Db, n: usize) -> Vec<Uuid> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        ids.push(db.create_buyer(&format!("Buyer {i}"), "hi").await.unwrap().id);
    }
    ids
}

fn chat_claim<'a>(shop: &Shop, buyer: Uuid, message_id: &'a str) -> ClaimRequest<'a> {
    ClaimRequest {
        live_id: shop.live_id,
        buyer_id: buyer,
        item_code: None,
        source: ClaimSource::Chat,
        said: "mine",
        message_id: Some(message_id),
        received_at: Some(chrono::Utc::now()),
    }
}

async fn expire_now(owner: &PgPool, claim_id: Uuid) {
    sqlx::query("update claims set hold_expires_at = now() - interval '1 second' where id = $1")
        .bind(claim_id)
        .execute(owner)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn sixty_buyers_racing_for_three_units(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 3).await;
    let ids = buyers(&shop.db, 60).await;
    let message_ids: Vec<String> = (0..60).map(|i| format!("msg-{i}")).collect();

    let results = join_all(ids.iter().zip(&message_ids).map(|(buyer, mid)| {
        let db = shop.db.clone();
        let request = chat_claim(&shop, *buyer, mid);
        async move { db.claim(request).await.unwrap() }
    }))
    .await;

    let held = results.iter().filter(|r| r.outcome == ClaimOutcome::Held).count();
    let waitlisted = results.iter().filter(|r| r.outcome == ClaimOutcome::Waitlisted).count();
    assert_eq!((held, waitlisted), (3, 57));

    let mut positions: Vec<i32> = results.iter().filter_map(|r| r.position).collect();
    positions.sort_unstable();
    assert_eq!(positions, (1..=60).collect::<Vec<_>>(), "every claim gets a unique place in line");

    // The three holds are exactly positions 1, 2 and 3.
    let mut held_positions: Vec<i32> =
        results.iter().filter(|r| r.outcome == ClaimOutcome::Held).filter_map(|r| r.position).collect();
    held_positions.sort_unstable();
    assert_eq!(held_positions, vec![1, 2, 3]);
    assert!(results.iter().filter(|r| r.outcome == ClaimOutcome::Held).all(|r| r.order_id.is_some()));

    let orders: i64 = sqlx::query_scalar("select count(*) from orders").fetch_one(&shop.owner).await.unwrap();
    assert_eq!(orders, 3);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn webhook_retries_return_the_original_decision(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 2).await;
    let first = shop.db.claim(chat_claim(&shop, ids[0], "m-1")).await.unwrap();
    assert_eq!(first.outcome, ClaimOutcome::Held);
    shop.db.claim(chat_claim(&shop, ids[1], "m-2")).await.unwrap();

    let retry = shop.db.claim(chat_claim(&shop, ids[0], "m-1")).await.unwrap();
    assert_eq!(retry.outcome, ClaimOutcome::Replay);
    assert_eq!(retry.claim_id, first.claim_id);
    assert_eq!(retry.position, Some(1));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn one_claim_per_buyer_and_a_hold_limit(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 5).await;
    let buyer = buyers(&shop.db, 1).await[0];
    assert_eq!(shop.db.claim(chat_claim(&shop, buyer, "a")).await.unwrap().outcome, ClaimOutcome::Held);
    let again = shop.db.claim(chat_claim(&shop, buyer, "b")).await.unwrap();
    assert_eq!(again.outcome, ClaimOutcome::Already);
    assert_eq!(again.position, Some(1));

    // Default limit is 3 unpaid holds per buyer per live.
    for code in ["A1", "A2", "A3"] {
        let item = shop
            .db
            .create_item(shop.seller_id, shop.staff_id, NewItem { title: "Bangle set", ..item(code, 50_000, 1) })
            .await
            .unwrap();
        shop.db.drop_item(shop.live_id, item.id, shop.staff_id).await.unwrap();
    }
    for (i, code) in ["A1", "A2", "A3"].iter().enumerate() {
        let request = ClaimRequest { item_code: Some(code), ..chat_claim(&shop, buyer, ["c1", "c2", "c3"][i]) };
        let outcome = shop.db.claim(request).await.unwrap().outcome;
        let expected = if i < 2 { ClaimOutcome::Held } else { ClaimOutcome::HoldLimit };
        assert_eq!(outcome, expected, "claim on {code}");
    }
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn unpaid_hold_expires_and_the_next_buyer_is_promoted(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 3).await;
    let first = shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();
    let second = shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap();
    let third = shop.db.claim(chat_claim(&shop, ids[2], "3")).await.unwrap();
    assert_eq!(second.outcome, ClaimOutcome::Waitlisted);

    // Not due yet: nothing happens.
    assert!(shop.db.expire_due_holds(10).await.unwrap().is_empty());

    expire_now(&shop.owner, first.claim_id.unwrap()).await;
    let expired = shop.db.expire_due_holds(10).await.unwrap();
    assert_eq!(expired.len(), 1);

    let queue = shop.db.queue_for_live(shop.live_id).await.unwrap();
    let status_of = |id: Option<Uuid>| queue.iter().find(|q| Some(q.claim_id) == id).unwrap().status;
    assert_eq!(status_of(first.claim_id), ClaimStatus::Expired);
    assert_eq!(status_of(second.claim_id), ClaimStatus::Held, "position 2 is promoted, not position 3");
    assert_eq!(status_of(third.claim_id), ClaimStatus::Waitlisted);
    let promoted = queue.iter().find(|q| Some(q.claim_id) == second.claim_id).unwrap();
    assert_eq!(promoted.order_status, Some(OrderStatus::AwaitingPayment));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn reported_payment_is_never_expired(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let buyer = buyers(&shop.db, 1).await[0];
    let claim = shop.db.claim(chat_claim(&shop, buyer, "1")).await.unwrap();
    let report = PaymentReport {
        upi_reference: "412345678901",
        ship_name: "Asha Verma",
        ship_phone: "+91 98100 00000",
        ship_address: "B-12, Sector 51, Noida",
        ship_pincode: "201301",
    };
    let order = shop.db.report_payment(claim.order_id.unwrap(), buyer, report).await.unwrap();
    assert_eq!(order.order.status, OrderStatus::PaymentReported);
    assert_eq!(order.order.ship_phone.as_deref(), Some("+919810000000"));

    expire_now(&shop.owner, claim.claim_id.unwrap()).await;
    assert!(shop.db.expire_due_holds(10).await.unwrap().is_empty());

    let paid = shop.db.confirm_payment(claim.order_id.unwrap(), shop.staff_id).await.unwrap();
    assert_eq!(paid.order.status, OrderStatus::Paid);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn releasing_or_cancelling_promotes_the_waitlist(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 3).await;
    let a = shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();
    let b = shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap();
    let c = shop.db.claim(chat_claim(&shop, ids[2], "3")).await.unwrap();

    shop.db.release_claim(a.claim_id.unwrap(), ids[0]).await.unwrap();
    let after_release = shop.db.queue_entry(b.claim_id.unwrap()).await.unwrap();
    assert_eq!(after_release.status, ClaimStatus::Held);

    shop.db.cancel_order(after_release.order_id.unwrap(), shop.staff_id, "reference not found").await.unwrap();
    assert_eq!(shop.db.queue_entry(c.claim_id.unwrap()).await.unwrap().status, ClaimStatus::Held);

    // Someone else's claim cannot be released.
    let err = shop.db.release_claim(c.claim_id.unwrap(), ids[0]).await.unwrap_err();
    assert!(matches!(err, DbError::NotFound(_)));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn closed_items_and_ended_lives_take_no_claims(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 2).await;
    let ids = buyers(&shop.db, 2).await;
    shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();

    shop.db.close_item(shop.live_id, shop.item_id, shop.staff_id).await.unwrap();
    let request = ClaimRequest { item_code: Some("S12"), ..chat_claim(&shop, ids[1], "2") };
    assert_eq!(shop.db.claim(request).await.unwrap().outcome, ClaimOutcome::Closed);
    assert_eq!(shop.db.claim(chat_claim(&shop, ids[1], "3")).await.unwrap().outcome, ClaimOutcome::NoItem);

    shop.db.end_live(shop.live_id, shop.staff_id).await.unwrap();
    assert_eq!(shop.db.claim(chat_claim(&shop, ids[1], "4")).await.unwrap().outcome, ClaimOutcome::NotLive);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn only_the_shop_team_controls_a_live(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let stranger = shop.db.upsert_dev_staff("someone@else.in", "Someone").await.unwrap();
    let err = shop.db.close_item(shop.live_id, shop.item_id, stranger.id).await.unwrap_err();
    assert!(matches!(err, DbError::Forbidden(_)));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn snapshot_reflects_the_room(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 2).await;
    let ids = buyers(&shop.db, 3).await;
    for (i, b) in ids.iter().enumerate() {
        shop.db.claim(chat_claim(&shop, *b, &format!("m{i}"))).await.unwrap();
    }
    let snapshot = shop.db.live_snapshot(shop.live_id).await.unwrap();
    assert_eq!(snapshot["status"], "live");
    assert_eq!(snapshot["pinned"]["code"], "S12");
    assert_eq!(snapshot["pinned"]["left"], 0);
    assert_eq!(snapshot["pinned"]["held"], 2);
    assert_eq!(snapshot["pinned"]["waitlist"], 1);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn blocked_buyers_cannot_claim(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 2).await;
    let ids = buyers(&shop.db, 2).await;
    shop.db.block_buyer(shop.seller_id, shop.staff_id, ids[0]).await.unwrap();
    assert_eq!(shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap().outcome, ClaimOutcome::Blocked);
    assert_eq!(shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap().outcome, ClaimOutcome::Held);
    shop.db.unblock_buyer(shop.seller_id, shop.staff_id, ids[0]).await.unwrap();
    assert_eq!(shop.db.claim(chat_claim(&shop, ids[0], "3")).await.unwrap().outcome, ClaimOutcome::Held);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn gateway_payment_confirms_an_open_hold_once(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::payments::GatewayOutcome;
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let buyer = buyers(&shop.db, 1).await[0];
    let claim = shop.db.claim(chat_claim(&shop, buyer, "1")).await.unwrap();
    let order_id = claim.order_id.unwrap();

    let first = shop.db.gateway_paid(order_id, "pay_A", Some("412345678901"), 450_000).await.unwrap();
    assert_eq!(first, GatewayOutcome::Paid);
    let order = shop.db.order_view(order_id).await.unwrap();
    assert_eq!(order.order.status, OrderStatus::Paid);
    assert_eq!(order.order.paid_via.as_deref(), Some("gateway"));
    assert_eq!(order.order.gateway_rrn.as_deref(), Some("412345678901"));

    // Webhook retries and the polling backup report the same payment again.
    assert_eq!(shop.db.gateway_paid(order_id, "pay_A", None, 450_000).await.unwrap(), GatewayOutcome::AlreadyPaid);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn payment_after_the_hold_lapsed_is_refunded_not_sold(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::payments::GatewayOutcome;
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 2).await;
    let first = shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();
    let second = shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap();
    expire_now(&shop.owner, first.claim_id.unwrap()).await;
    shop.db.expire_due_holds(10).await.unwrap();
    assert_eq!(shop.db.queue_entry(second.claim_id.unwrap()).await.unwrap().status, ClaimStatus::Held);

    // The first buyer's money arrives late: the item stays with buyer two and a refund is queued.
    let late = shop.db.gateway_paid(first.order_id.unwrap(), "pay_late", None, 450_000).await.unwrap();
    assert_eq!(late, GatewayOutcome::Late);
    assert_eq!(shop.db.queue_entry(second.claim_id.unwrap()).await.unwrap().status, ClaimStatus::Held);
    let refunds: i64 = sqlx::query_scalar("select count(*) from outbox where kind = 'payment.refund'").fetch_one(&shop.owner).await.unwrap();
    assert_eq!(refunds, 1);

    // Underpayment never completes an order either.
    let promoted_order = shop.db.order_for_claim(second.claim_id.unwrap()).await.unwrap().unwrap();
    let short = shop.db.gateway_paid(promoted_order, "pay_short", None, 100).await.unwrap();
    assert_eq!(short, GatewayOutcome::Late);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn youtube_commenter_claims_then_links_to_their_account(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    // A YouTube viewer comments "mine" before ever opening Pehle.
    let placeholder = shop.db.youtube_buyer("UC_priya", "Priya Sharma").await.unwrap();
    assert_eq!(shop.db.youtube_buyer("UC_priya", "Priya Sharma").await.unwrap(), placeholder, "same channel, same identity");
    let claim = shop
        .db
        .claim(ClaimRequest { source: ClaimSource::Youtube, ..chat_claim(&shop, placeholder, "yt:1") })
        .await
        .unwrap();
    assert_eq!(claim.outcome, ClaimOutcome::Held);

    // She signs in to Pehle, gets a code, and types it in the YouTube chat.
    let me = shop.db.create_buyer("Priya S.", "hi").await.unwrap();
    let (code, _) = shop.db.youtube_link_code(shop.live_id, me.id).await.unwrap();
    assert_eq!(shop.db.link_youtube(shop.live_id, "0000", "UC_priya", "Priya Sharma").await.unwrap(), None, "wrong code");
    assert_eq!(shop.db.link_youtube(shop.live_id, &code, "UC_priya", "Priya Sharma").await.unwrap(), Some(me.id));
    assert_eq!(shop.db.link_youtube(shop.live_id, &code, "UC_priya", "Priya Sharma").await.unwrap(), None, "codes work once");

    // The hold and its order moved to her account; the placeholder is gone.
    let mine = shop.db.buyer_claims_in_live(shop.live_id, me.id).await.unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].status, ClaimStatus::Held);
    assert_eq!(shop.db.order_view(mine[0].order_id.unwrap()).await.unwrap().order.buyer_id, me.id);
    assert_eq!(shop.db.youtube_buyer("UC_priya", "Priya Sharma").await.unwrap(), me.id);
}

// ---------------------------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------------------------

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn the_api_role_can_read_but_never_write_tables(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let count: i64 = sqlx::query_scalar("select count(*) from items").fetch_one(&shop.db.pool).await.unwrap();
    assert_eq!(count, 1);
    for statement in [
        "insert into buyers (display_name) values ('Mallory')",
        "update claims set status = 'paid'",
        "delete from orders",
        "update items set quantity = 999",
    ] {
        let err = sqlx::query(statement).execute(&shop.db.pool).await.unwrap_err();
        assert!(err.to_string().contains("permission denied"), "{statement}: {err}");
    }
    let secrets = sqlx::query("select * from seller_payment_accounts").execute(&shop.db.pool).await;
    assert!(secrets.is_err(), "select * must not list payment secrets column by column without a grant");
}

// ---------------------------------------------------------------------------------------------
// Giveaways, catalogue edits and drops
// ---------------------------------------------------------------------------------------------

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn free_drops_are_won_on_the_spot_and_reveal_the_winner_note(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_priced_item(options, connect_options, 2, 0).await;
    shop.db
        .update_item(shop.item_id, shop.staff_id, NewItem { winner_note: Some("Use code CHAI50"), ..item("S12", 0, 2) })
        .await
        .unwrap();
    let ids = buyers(&shop.db, 3).await;
    let first = shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();
    assert_eq!(first.outcome, ClaimOutcome::Held);
    assert_eq!(first.status, Some(ClaimStatus::Paid), "a free item is won immediately, no hold");
    let order = shop.db.order_view(first.order_id.unwrap()).await.unwrap();
    assert_eq!(order.order.status, OrderStatus::Paid);
    assert_eq!(order.order.paid_via.as_deref(), Some("free"));
    assert_eq!(order.winner_note.as_deref(), Some("Use code CHAI50"));

    shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap();
    let third = shop.db.claim(chat_claim(&shop, ids[2], "3")).await.unwrap();
    assert_eq!(third.outcome, ClaimOutcome::Waitlisted);
    // Nothing to pay, so nothing ever expires.
    assert!(shop.db.expire_due_holds(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn winner_notes_stay_private_until_paid(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    shop.db
        .update_item(shop.item_id, shop.staff_id, NewItem { winner_note: Some("Tracking link follows"), ..item("S12", 450_000, 1) })
        .await
        .unwrap();
    let buyer = buyers(&shop.db, 1).await[0];
    let claim = shop.db.claim(chat_claim(&shop, buyer, "1")).await.unwrap();
    let order_id = claim.order_id.unwrap();
    assert_eq!(shop.db.order_view(order_id).await.unwrap().winner_note, None);
    shop.db.confirm_payment(order_id, shop.staff_id).await.unwrap();
    assert_eq!(shop.db.order_view(order_id).await.unwrap().winner_note.as_deref(), Some("Tracking link follows"));
    let public = shop.db.open_items(shop.live_id).await.unwrap();
    assert_eq!(public[0].units_left, 0);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn more_stock_promotes_the_waitlist_and_less_than_taken_is_refused(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 2).await;
    shop.db.claim(chat_claim(&shop, ids[0], "1")).await.unwrap();
    let second = shop.db.claim(chat_claim(&shop, ids[1], "2")).await.unwrap();
    assert_eq!(second.outcome, ClaimOutcome::Waitlisted);

    let err = shop.db.update_item(shop.item_id, shop.staff_id, item("S12", 450_000, 0)).await.unwrap_err();
    assert!(matches!(err, DbError::Invalid(_)), "{err}");
    shop.db.update_item(shop.item_id, shop.staff_id, item("S12", 450_000, 2)).await.unwrap();
    assert_eq!(shop.db.queue_entry(second.claim_id.unwrap()).await.unwrap().status, ClaimStatus::Held);

    let err = shop.db.archive_item(shop.item_id, shop.staff_id).await.unwrap_err();
    assert!(matches!(err, DbError::Conflict(_)), "open items cannot be archived");
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn drops_are_announced_with_a_lineup_and_remind_buyers_once(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let a = shop.db.create_item(shop.seller_id, shop.staff_id, item("A1", 10_000, 1)).await.unwrap();
    let b = shop.db.create_item(shop.seller_id, shop.staff_id, item("B2", 20_000, 1)).await.unwrap();
    let when = chrono::Utc::now() + chrono::Duration::days(1);
    let lineup = [b.id, a.id, b.id];
    let next = shop
        .db
        .create_live(shop.seller_id, shop.staff_id, DropInput { scheduled_for: Some(when), ..drop_input("Sunday thrift", &lineup) })
        .await
        .unwrap();
    let listed: Vec<String> = shop.db.lineup(next.id).await.unwrap().into_iter().map(|i| i.code).collect();
    assert_eq!(listed, vec!["B2", "A1"], "lineup keeps the seller's order without duplicates");

    // Another shop's item cannot be listed.
    let other_staff = shop.db.upsert_dev_staff("other@shop.in", "Other").await.unwrap();
    let other = shop
        .db
        .create_shop(other_staff.id, NewShop { handle: "other-shop", display_name: "Other", category: "thrift", city: None, upi_vpa: None, upi_payee_name: None })
        .await
        .unwrap();
    let foreign = shop.db.create_item(other.id, other_staff.id, item("X1", 100, 1)).await.unwrap();
    let err = shop
        .db
        .update_live(next.id, shop.staff_id, drop_input("Sunday thrift", &[foreign.id]))
        .await
        .unwrap_err();
    assert!(matches!(err, DbError::Invalid(_)), "{err}");

    let ids = buyers(&shop.db, 3).await;
    assert!(shop.db.toggle_reminder(next.id, ids[0]).await.unwrap());
    assert!(shop.db.toggle_reminder(next.id, ids[1]).await.unwrap());
    assert!(!shop.db.toggle_reminder(next.id, ids[1]).await.unwrap(), "second tap turns it off");
    shop.db.follow(shop.seller_id, ids[2]).await.unwrap();
    shop.db.follow(shop.seller_id, ids[0]).await.unwrap();

    shop.db.end_live(shop.live_id, shop.staff_id).await.unwrap();
    shop.db.start_live(next.id, shop.staff_id).await.unwrap();
    let notify: i64 = sqlx::query_scalar("select count(*) from outbox where kind = 'drop.notify'").fetch_one(&shop.owner).await.unwrap();
    assert_eq!(notify, 2, "one notify job per started drop");
    let mut audience = shop.db.take_drop_audience(next.id).await.unwrap();
    audience.sort_by_key(|m| m.buyer_id);
    let mut expected = vec![(ids[0], true), (ids[2], false)];
    expected.sort_by_key(|e| e.0);
    assert_eq!(audience.iter().map(|m| (m.buyer_id, m.reminded)).collect::<Vec<_>>(), expected);
    let again = shop.db.take_drop_audience(next.id).await.unwrap();
    assert!(again.iter().all(|m| !m.reminded), "reminders are handed out once");
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn browse_shows_live_and_upcoming_drops_but_hides_the_demo(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::browse::BrowseQuery;
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let later = shop.db.create_item(shop.seller_id, shop.staff_id, item("L1", 10_000, 1)).await.unwrap();
    let lineup = [later.id];
    shop.db
        .create_live(
            shop.seller_id,
            shop.staff_id,
            DropInput { scheduled_for: Some(chrono::Utc::now() + chrono::Duration::hours(3)), ..drop_input("Tomorrow", &lineup) },
        )
        .await
        .unwrap();
    let demo_staff = shop.db.upsert_dev_staff("demo@pehle.app", "Pehle demo").await.unwrap();
    shop.db.setup_demo_shop(demo_staff.id).await.unwrap();

    let feed = shop.db.browse(BrowseQuery::default()).await.unwrap();
    assert_eq!(feed.live.len(), 1);
    assert_eq!(feed.live[0].shop_handle, "meera-sarees");
    assert_eq!(feed.upcoming.len(), 1);
    let picks: Vec<&str> = feed.picks.iter().map(|p| p.code.as_str()).collect();
    assert!(picks.contains(&"S12") && picks.contains(&"L1"), "{picks:?}");

    let sarees = shop.db.browse(BrowseQuery { category: Some("plants"), ..BrowseQuery::default() }).await.unwrap();
    assert!(sarees.live.is_empty());
    let search = shop.db.browse(BrowseQuery { search: Some("diwali"), ..BrowseQuery::default() }).await.unwrap();
    assert_eq!(search.live.len(), 1);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn trust_record_and_drop_report_come_from_real_payments(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 2).await;
    let ids = buyers(&shop.db, 4).await;
    let mut claims = Vec::new();
    for (i, b) in ids.iter().enumerate() {
        claims.push(shop.db.claim(chat_claim(&shop, *b, &format!("m{i}"))).await.unwrap());
    }
    shop.db.gateway_paid(claims[0].order_id.unwrap(), "pay_1", Some("4123"), 450_000).await.unwrap();
    expire_now(&shop.owner, claims[1].claim_id.unwrap()).await;
    shop.db.expire_due_holds(10).await.unwrap();
    shop.db.follow(shop.seller_id, ids[3]).await.unwrap();

    let report = shop.db.drop_report(shop.live_id).await.unwrap();
    assert_eq!(report.items_dropped, 1);
    assert_eq!(report.units_offered, 2);
    assert_eq!(report.units_sold, 1);
    assert_eq!(report.revenue_paise, 450_000);
    assert_eq!(report.claims, 4);
    assert_eq!(report.claimants, 4);
    assert_eq!(report.non_payers_replaced, 1);
    assert_eq!(report.still_waiting, 1, "buyer four is still in line");
    assert_eq!(report.paid_via_gateway, 1);
    assert_eq!(report.new_club_members, 1);
    assert!(report.median_sell_out_seconds.is_some());

    let trust = shop.db.trust_record(shop.seller_id).await.unwrap();
    assert_eq!(trust.drops_run, 1);
    assert_eq!(trust.items_sold, 1);
    assert_eq!(trust.gateway_verified, 1);
    assert_eq!(trust.completion_rate, None, "too few closed holds to show a rate");
    assert_eq!(trust.followers, 1);
}

// ---------------------------------------------------------------------------------------------
// Sessions, conversations and push
// ---------------------------------------------------------------------------------------------

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn sessions_resolve_until_deleted_and_phone_identities_are_stable(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::people::VerifiedPhone;
    use pehle_db::sessions::SessionOwner;
    let (db, _) = connect(options, connect_options).await;
    let phone = || VerifiedPhone { firebase_uid: "fb_1", phone_e164: "+919810000000" };
    let buyer = db.upsert_phone_buyer(phone(), "").await.unwrap();
    assert_eq!(buyer.display_name, "Buyer 0000");
    assert_eq!(db.upsert_phone_buyer(phone(), "Asha").await.unwrap().id, buyer.id, "same number, same buyer");

    db.create_session("token-1", SessionOwner::Buyer(buyer.id), chrono::Duration::days(30), Some("test")).await.unwrap();
    match db.session_principal("token-1").await.unwrap() {
        Some(pehle_db::Principal::Buyer(b)) => assert_eq!(b.id, buyer.id),
        other => panic!("unexpected {other:?}"),
    }
    assert!(db.session_principal("token-2").await.unwrap().is_none());
    db.delete_session("token-1").await.unwrap();
    assert!(db.session_principal("token-1").await.unwrap().is_none());

    let seller = db.upsert_phone_staff(VerifiedPhone { firebase_uid: "fb_2", phone_e164: "+919999900000" }, "Meera").await.unwrap();
    assert_eq!(seller.email, None);
    assert_eq!(seller.phone_e164.as_deref(), Some("+919999900000"));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn conversations_are_created_once_and_push_endpoints_clean_themselves(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::audience::PushOwner;
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let buyer = buyers(&shop.db, 1).await[0];
    let first = shop.db.ensure_conversation(shop.seller_id, buyer).await.unwrap();
    let second = shop.db.ensure_conversation(shop.seller_id, buyer).await.unwrap();
    assert_eq!(first.id, second.id);
    assert!(first.nexconn_group_id.starts_with('c') && first.nexconn_group_id.len() == 33);
    assert!(!first.provisioned);
    let jobs: i64 = sqlx::query_scalar("select count(*) from outbox where kind = 'conversation.provision'")
        .fetch_one(&shop.owner)
        .await
        .unwrap();
    assert_eq!(jobs, 1);
    shop.db.conversation_provisioned(first.id).await.unwrap();
    assert!(shop.db.conversation(first.id).await.unwrap().provisioned);
    assert_eq!(shop.db.conversations_for_seller(shop.seller_id).await.unwrap().len(), 1);

    let endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    let key = "B".repeat(87);
    shop.db.save_push_subscription(PushOwner::Buyer(buyer), endpoint, &key, "auth-secret-16b", None).await.unwrap();
    assert_eq!(shop.db.push_targets_for_buyers(&[buyer]).await.unwrap().len(), 1);
    for _ in 0..4 {
        shop.db.push_delivered(endpoint, false, false).await.unwrap();
    }
    assert_eq!(shop.db.push_targets_for_buyers(&[buyer]).await.unwrap().len(), 1, "four failures keep it");
    shop.db.push_delivered(endpoint, false, false).await.unwrap();
    assert!(shop.db.push_targets_for_buyers(&[buyer]).await.unwrap().is_empty(), "five failures drop it");
    let err = shop.db.save_push_subscription(PushOwner::Buyer(buyer), "http://insecure", &key, "auth-secret-16b", None).await;
    assert!(matches!(err, Err(DbError::Invalid(_))));
}

// ---------------------------------------------------------------------------------------------
// The demo shop
// ---------------------------------------------------------------------------------------------

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn only_demo_bots_in_the_demo_shop_can_be_made_to_lapse(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let demo_staff = shop.db.upsert_dev_staff("demo@pehle.app", "Pehle demo").await.unwrap();
    let demo = shop.db.setup_demo_shop(demo_staff.id).await.unwrap();
    assert!(demo.is_demo);
    assert_eq!(shop.db.setup_demo_shop(demo_staff.id).await.unwrap().id, demo.id, "created once");
    let bots = shop.db.demo_bots().await.unwrap();
    assert_eq!(bots.len(), 4);
    assert_eq!(shop.db.demo_bots().await.unwrap().len(), 4, "bots are not duplicated");

    // A bot holding a real shop's item cannot be lapsed.
    let real = shop.db.claim(ClaimRequest { source: ClaimSource::Button, message_id: None, ..chat_claim(&shop, bots[0].id, "") }).await.unwrap();
    assert!(!shop.db.demo_lapse_hold(real.claim_id.unwrap()).await.unwrap());

    let piece = shop.db.create_item(demo.id, demo_staff.id, item("D1", 99_900, 1)).await.unwrap();
    let live = shop.db.create_live(demo.id, demo_staff.id, drop_input("Demo", &[])).await.unwrap();
    shop.db.start_live(live.id, demo_staff.id).await.unwrap();
    shop.db.drop_item(live.id, piece.id, demo_staff.id).await.unwrap();
    let judge = shop.db.create_demo_buyer("Judge").await.unwrap();
    let request = |buyer| ClaimRequest {
        live_id: live.id,
        buyer_id: buyer,
        item_code: None,
        source: ClaimSource::Button,
        said: "Claim",
        message_id: None,
        received_at: None,
    };
    let bot = shop.db.claim(request(bots[1].id)).await.unwrap();
    let mine = shop.db.claim(request(judge.id)).await.unwrap();
    assert_eq!(mine.outcome, ClaimOutcome::Waitlisted);
    assert!(shop.db.demo_lapse_hold(bot.claim_id.unwrap()).await.unwrap());
    shop.db.expire_due_holds(10).await.unwrap();
    assert_eq!(shop.db.queue_entry(mine.claim_id.unwrap()).await.unwrap().status, ClaimStatus::Held);
    assert_eq!(shop.db.demo_live().await.unwrap().map(|l| l.id), Some(live.id));
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn practice_shops_are_private_and_never_counted(options: PgPoolOptions, connect_options: PgConnectOptions) {
    use pehle_db::browse::BrowseQuery;
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let demo_staff = shop.db.upsert_dev_staff("demo@pehle.app", "Pehle demo").await.unwrap();
    let demo = shop.db.setup_demo_shop(demo_staff.id).await.unwrap();
    let judge = shop.db.upsert_dev_staff("practice-1@try.pehle.app", "Practice seller").await.unwrap();
    let practice = shop.db.create_practice_shop(judge.id).await.unwrap();
    assert!(practice.is_demo && practice.handle.starts_with("try-"));
    assert_eq!(shop.db.create_practice_shop(judge.id).await.unwrap().id, practice.id, "one per account");
    assert_eq!(shop.db.setup_demo_shop(demo_staff.id).await.unwrap().id, demo.id, "the demo shop is found by handle");
    assert_ne!(practice.id, demo.id);

    let piece = shop.db.create_item(practice.id, judge.id, item("P1", 10_000, 1)).await.unwrap();
    let live = shop.db.create_live(practice.id, judge.id, drop_input("Practice", &[piece.id])).await.unwrap();
    shop.db.start_live(live.id, judge.id).await.unwrap();
    shop.db.drop_item(live.id, piece.id, judge.id).await.unwrap();
    let guest = shop.db.create_demo_buyer("Guest 1234").await.unwrap();
    let won = shop
        .db
        .claim(ClaimRequest { live_id: live.id, buyer_id: guest.id, item_code: None, source: ClaimSource::Button, said: "Claim", message_id: None, received_at: None })
        .await
        .unwrap();
    shop.db.confirm_payment(won.order_id.unwrap(), judge.id).await.unwrap();

    let feed = shop.db.browse(BrowseQuery::default()).await.unwrap();
    assert!(feed.live.iter().all(|d| d.shop_handle == "meera-sarees"), "practice drops stay off the home page");
    let stats = shop.db.stats(None, None).await.unwrap();
    assert_eq!(stats.orders_paid, 0, "practice and demo payments are not counted");
    assert_eq!(stats.shops, 1);
}

#[sqlx::test(migrator = "pehle_db::MIGRATOR")]
async fn the_fairness_log_returns_the_newest_events_oldest_first(options: PgPoolOptions, connect_options: PgConnectOptions) {
    let shop = shop_with_open_item(options, connect_options, 1).await;
    let ids = buyers(&shop.db, 5).await;
    for (i, b) in ids.iter().enumerate() {
        shop.db.claim(chat_claim(&shop, *b, &format!("n{i}"))).await.unwrap();
    }
    let all = shop.db.claim_events(shop.live_id, 0, 100).await.unwrap();
    let newest = shop.db.claim_events(shop.live_id, 0, 3).await.unwrap();
    assert_eq!(newest.len(), 3);
    assert_eq!(newest.iter().map(|e| e.id).collect::<Vec<_>>(), all[all.len() - 3..].iter().map(|e| e.id).collect::<Vec<_>>());
    let after = shop.db.claim_events(shop.live_id, all[0].id, 2).await.unwrap();
    assert_eq!(after[0].id, all[1].id, "with a cursor, the next events in order");
}
