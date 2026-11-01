use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

macro_rules! pg_enum {
    ($name:ident, $pg:literal, { $($variant:ident),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema, sqlx::Type)]
        #[sqlx(type_name = $pg, rename_all = "snake_case")]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}

pg_enum!(LiveStatus, "live_status", { Draft, Live, Ended });
pg_enum!(ItemStatus, "item_status", { Ready, Open, Closed });
pg_enum!(ClaimStatus, "claim_status", { Held, Waitlisted, Paid, Expired, Released, Cancelled });
pg_enum!(ClaimSource, "claim_source", { Chat, Button, Seller, Youtube });
pg_enum!(OrderStatus, "order_status", { AwaitingPayment, PaymentReported, Paid, Cancelled, Expired });
pg_enum!(StaffRole, "staff_role", { Owner, Moderator });
pg_enum!(ApprovalStatus, "approval_status", { Pending, Approved, Declined, Expired });

/// What `app.claim` decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "app.claim_outcome", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ClaimOutcome {
    Held,
    Waitlisted,
    Already,
    Replay,
    HoldLimit,
    NoItem,
    Closed,
    NotLive,
    /// The shop blocked this buyer from claiming.
    Blocked,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Staff {
    pub id: Uuid,
    pub email: Option<String>,
    pub phone_e164: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub nexconn_user_id: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Buyer {
    pub id: Uuid,
    pub display_name: String,
    pub preferred_language: String,
    pub nexconn_user_id: String,
    pub avatar_url: Option<String>,
    /// Present for buyers who signed in with Google.
    pub email: Option<String>,
    /// Present for buyers who signed in with a verified phone number.
    pub phone_e164: Option<String>,
    /// A demo-shop buyer (judges trying Pehle); can only claim in the demo shop.
    pub is_demo: bool,
    /// A scripted rival in the demo shop. Never given a chat token or chat messages.
    pub is_bot: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Seller {
    pub id: Uuid,
    pub handle: String,
    pub display_name: String,
    pub tagline: Option<String>,
    pub category: String,
    pub city: Option<String>,
    pub avatar_path: Option<String>,
    pub cover_path: Option<String>,
    pub upi_vpa: Option<String>,
    pub upi_payee_name: Option<String>,
    pub hold_minutes: i32,
    pub max_holds_per_buyer: i32,
    #[schema(value_type = Object)]
    pub policies: serde_json::Value,
    pub is_demo: bool,
    pub nexconn_group_id: String,
    pub cohost_user_id: String,
    pub created_at: DateTime<Utc>,
}

/// A shop as buyers see it: no payment configuration beyond what checkout needs.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicShop {
    pub id: Uuid,
    pub handle: String,
    pub display_name: String,
    pub tagline: Option<String>,
    pub category: String,
    pub city: Option<String>,
    pub avatar_path: Option<String>,
    pub cover_path: Option<String>,
    pub is_demo: bool,
    pub hold_minutes: i32,
    pub cohost_user_id: String,
    pub nexconn_group_id: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShopMembership {
    pub seller: Seller,
    pub role: StaffRole,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: Uuid,
    pub seller_id: Uuid,
    pub code: String,
    pub title: String,
    pub description: Option<String>,
    pub price_paise: i64,
    pub quantity: i32,
    pub image_path: Option<String>,
    pub gallery_paths: Vec<String>,
    /// Shown only to the shop team and to buyers who won the item.
    pub winner_note: Option<String>,
    pub status: ItemStatus,
    pub open_live_id: Option<Uuid>,
    pub opened_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// An item as buyers see it: no winner note.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicItem {
    pub id: Uuid,
    pub code: String,
    pub title: String,
    pub description: Option<String>,
    pub price_paise: i64,
    pub quantity: i32,
    pub image_path: Option<String>,
    pub gallery_paths: Vec<String>,
    pub status: ItemStatus,
    /// When the item last opened for claims.
    pub opened_at: Option<DateTime<Utc>>,
    pub units_left: i64,
    pub waitlist: i64,
}

/// An item with its live counts.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemWithCounts {
    #[serde(flatten)]
    pub item: Item,
    pub held: i64,
    pub paid: i64,
    pub waitlist: i64,
    pub units_left: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub id: Uuid,
    pub seller_id: Uuid,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub stream_url: Option<String>,
    pub status: LiveStatus,
    /// When an upcoming drop is announced to start.
    pub scheduled_for: Option<DateTime<Utc>>,
    pub pinned_item_id: Option<Uuid>,
    pub nexconn_channel_id: String,
    /// Set when the stream link is a YouTube video; its live chat is then read for claims.
    pub youtube_video_id: Option<String>,
    /// Present once Pehle has found the stream's active live chat.
    pub youtube_live_chat_id: Option<String>,
    /// Items announced in the drop's lineup.
    pub lineup_count: i64,
    /// The pinned item's photo, else the first lineup photo.
    pub cover_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResult {
    pub outcome: ClaimOutcome,
    pub claim_id: Option<Uuid>,
    pub order_id: Option<Uuid>,
    pub item_id: Option<Uuid>,
    pub item_code: Option<String>,
    pub item_title: Option<String>,
    pub position: Option<i32>,
    pub status: Option<ClaimStatus>,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub units_left: Option<i32>,
    pub waitlist_length: Option<i32>,
}

/// A claim with the buyer's display name, for the seller's queue and the public fairness log.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub claim_id: Uuid,
    pub buyer_id: Uuid,
    pub item_id: Uuid,
    pub item_code: String,
    pub position: i32,
    pub status: ClaimStatus,
    pub source: ClaimSource,
    pub buyer_name: String,
    pub said: Option<String>,
    pub decided_at: DateTime<Utc>,
    pub nexconn_received_at: Option<DateTime<Utc>>,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub order_id: Option<Uuid>,
    pub order_status: Option<OrderStatus>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: Uuid,
    pub claim_id: Uuid,
    pub seller_id: Uuid,
    pub buyer_id: Uuid,
    pub item_id: Uuid,
    pub live_id: Uuid,
    pub amount_paise: i64,
    pub status: OrderStatus,
    pub upi_reference: Option<String>,
    pub ship_name: Option<String>,
    pub ship_phone: Option<String>,
    pub ship_address: Option<String>,
    pub ship_pincode: Option<String>,
    pub created_at: DateTime<Utc>,
    pub payment_reported_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    /// Hosted payment page on the seller's gateway, when the shop has one connected.
    pub payment_link_url: Option<String>,
    /// `gateway` (confirmed by the payment provider) or `seller_confirmed`.
    pub paid_via: Option<String>,
    pub gateway_rrn: Option<String>,
    pub refund_id: Option<String>,
}

/// An order with everything checkout needs to render, from either side.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderView {
    #[serde(flatten)]
    pub order: Order,
    pub item_code: String,
    pub item_title: String,
    pub item_image_path: Option<String>,
    pub claim_position: i32,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub buyer_name: String,
    pub buyer_nexconn_user_id: String,
    pub shop_handle: String,
    pub shop_name: String,
    pub shop_cohost_user_id: String,
    pub shop_avatar_path: Option<String>,
    /// The order is in the demo shop: payments are simulated.
    pub shop_is_demo: bool,
    pub upi_vpa: Option<String>,
    pub upi_payee_name: Option<String>,
    pub live_slug: String,
    /// The item's private note, present once the order is paid.
    pub winner_note: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub at: DateTime<Utc>,
    pub kind: String,
    pub item_id: Option<Uuid>,
    pub claim_id: Option<Uuid>,
    #[schema(value_type = Object)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug)]
pub enum Principal {
    Buyer(Buyer),
    Staff(Staff),
}

#[derive(Clone, Debug)]
pub struct OutboxJob {
    pub id: i64,
    pub kind: String,
    pub payload: serde_json::Value,
    pub attempts: i32,
}
