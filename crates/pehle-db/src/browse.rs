//! Public discovery: what is live, what is coming up, and each shop's record.

use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{Db, DbResult, ItemStatus, LiveStatus, PublicShop};

/// A drop on the home page or a shop page.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DropCard {
    pub id: Uuid,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub status: LiveStatus,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub youtube_video_id: Option<String>,
    pub has_stream: bool,
    /// The pinned item's photo, else the first lineup photo.
    pub cover_path: Option<String>,
    pub shop_handle: String,
    pub shop_name: String,
    pub shop_avatar_path: Option<String>,
    pub shop_city: Option<String>,
    pub shop_category: String,
    pub items: i64,
    pub claims: i64,
    pub reminders: i64,
    /// Signed-in people who opened the room in the last 15 minutes.
    pub watching: i64,
    /// The signed-in buyer asked to be reminded about this drop.
    pub reminded: bool,
}

/// An item on the home grid: something you can claim now or in an upcoming drop.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PickCard {
    pub item_id: Uuid,
    pub code: String,
    pub title: String,
    pub price_paise: i64,
    pub image_path: Option<String>,
    pub quantity: i32,
    pub units_left: i64,
    pub status: ItemStatus,
    pub shop_handle: String,
    pub shop_name: String,
    pub shop_city: Option<String>,
    pub drop_slug: String,
    pub drop_status: LiveStatus,
    pub drop_scheduled_for: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowseFeed {
    pub live: Vec<DropCard>,
    pub upcoming: Vec<DropCard>,
    pub picks: Vec<PickCard>,
    pub recent: Vec<DropCard>,
}

/// A shop's public record, computed from real claims and payments. Sellers cannot edit it.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrustRecord {
    pub drops_run: i64,
    pub items_sold: i64,
    /// Paid orders confirmed by the payment gateway rather than by the seller.
    pub gateway_verified: i64,
    /// Share of holds that ended paid (0 to 1), once there are at least five closed holds.
    pub completion_rate: Option<f64>,
    pub median_minutes_to_pay: Option<f64>,
    pub followers: i64,
    pub accepts_gateway_payments: bool,
    pub selling_since: Option<DateTime<Utc>>,
}

/// A catalogue item on a shop page.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShopItem {
    pub id: Uuid,
    pub code: String,
    pub title: String,
    pub price_paise: i64,
    pub image_path: Option<String>,
    pub quantity: i32,
    pub units_left: i64,
    pub status: ItemStatus,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShopPage {
    pub shop: PublicShop,
    pub trust: TrustRecord,
    pub drops: Vec<DropCard>,
    pub items: Vec<ShopItem>,
    pub following: bool,
}

/// Filters for the home feed.
#[derive(Clone, Debug, Default)]
pub struct BrowseQuery<'a> {
    pub category: Option<&'a str>,
    pub search: Option<&'a str>,
    pub include_demo: bool,
    /// The signed-in buyer, for their reminder state.
    pub viewer: Option<Uuid>,
}

/// Which drops to list.
#[derive(Clone, Copy)]
enum DropScope {
    Live,
    Upcoming,
    Recent,
    Shop(Uuid),
}

impl Db {
    async fn drop_cards(&self, scope: DropScope, query: &BrowseQuery<'_>, limit: i64) -> DbResult<Vec<DropCard>> {
        let (kind, shop) = match scope {
            DropScope::Live => ("live", None),
            DropScope::Upcoming => ("upcoming", None),
            DropScope::Recent => ("recent", None),
            DropScope::Shop(id) => ("shop", Some(id)),
        };
        let pattern = query.search.map(|s| format!("%{}%", s.replace(['%', '_'], "")));
        Ok(sqlx::query_as!(
            DropCard,
            r#"select l.id, l.slug, l.title, l.description, l.status as "status: LiveStatus", l.scheduled_for,
                      l.started_at, l.ended_at, l.youtube_video_id, (l.stream_url is not null) as "has_stream!",
                      coalesce(pin.image_path, first_item.image_path) as cover_path,
                      s.handle::text as "shop_handle!", s.display_name as shop_name, s.avatar_path as shop_avatar_path,
                      s.city as shop_city, s.category as shop_category,
                      (select count(*) from live_lineup x where x.live_id = l.id) as "items!",
                      (select count(*) from claims c where c.live_id = l.id) as "claims!",
                      (select count(*) from drop_reminders r where r.live_id = l.id) as "reminders!",
                      case when l.status = 'live' then
                          (select count(distinct e.buyer_id) from events e
                            where e.live_id = l.id and e.kind = 'room.joined' and e.at > now() - interval '15 minutes')
                      else 0 end as "watching!",
                      ($7::uuid is not null and exists (
                          select 1 from drop_reminders r where r.live_id = l.id and r.buyer_id = $7)) as "reminded!"
               from lives l
               join sellers s on s.id = l.seller_id
               left join items pin on pin.id = l.pinned_item_id
               left join lateral (
                   select i.image_path from live_lineup x join items i on i.id = x.item_id
                   where x.live_id = l.id and i.image_path is not null order by x.sort limit 1
               ) first_item on true
               where case $1::text
                       when 'live' then l.status = 'live'
                       when 'upcoming' then l.status = 'draft' and l.scheduled_for > now() - interval '2 hours'
                       when 'recent' then l.status = 'ended' and l.ended_at > now() - interval '14 days'
                       else l.seller_id = $2 and (l.status <> 'draft' or l.scheduled_for is not null) end
                 and ($2::uuid is not null or s.is_demo = false or $3)
                 and ($4::text is null or s.category = $4)
                 and ($5::text is null or l.title ilike $5 or s.display_name ilike $5 or s.handle::text ilike $5)
               order by case when $1::text = 'upcoming' then l.scheduled_for end asc,
                        case when l.status = 'live' then 0 when l.status = 'draft' then 1 else 2 end,
                        coalesce(l.started_at, l.scheduled_for, l.created_at) desc
               limit $6"#,
            kind,
            shop,
            query.include_demo,
            query.category,
            pattern,
            limit,
            query.viewer
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// Items open now or lined up in upcoming drops.
    async fn picks(&self, query: &BrowseQuery<'_>, limit: i64) -> DbResult<Vec<PickCard>> {
        let pattern = query.search.map(|s| format!("%{}%", s.replace(['%', '_'], "")));
        Ok(sqlx::query_as!(
            PickCard,
            r#"select distinct on (i.id)
                      i.id as item_id, i.code, i.title, i.price_paise, i.image_path, i.quantity,
                      greatest(i.quantity - (select count(*) from claims c where c.item_id = i.id
                                              and c.status in ('held', 'paid')), 0) as "units_left!",
                      i.status as "status: ItemStatus",
                      s.handle::text as "shop_handle!", s.display_name as shop_name, s.city as shop_city,
                      l.slug as drop_slug, l.status as "drop_status: LiveStatus", l.scheduled_for as drop_scheduled_for
               from lives l
               join sellers s on s.id = l.seller_id
               join items i on i.seller_id = l.seller_id and i.archived_at is null
                    and (i.open_live_id = l.id or exists (select 1 from live_lineup x where x.live_id = l.id and x.item_id = i.id))
               where (l.status = 'live' or (l.status = 'draft' and l.scheduled_for > now() - interval '2 hours'))
                 and (s.is_demo = false or $1)
                 and ($2::text is null or s.category = $2)
                 and ($3::text is null or i.title ilike $3 or s.display_name ilike $3)
               order by i.id, (l.status = 'live') desc
               limit $4"#,
            query.include_demo,
            query.category,
            pattern,
            limit
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn browse(&self, query: BrowseQuery<'_>) -> DbResult<BrowseFeed> {
        let (live, upcoming, picks, recent) = tokio::try_join!(
            self.drop_cards(DropScope::Live, &query, 24),
            self.drop_cards(DropScope::Upcoming, &query, 24),
            self.picks(&query, 48),
            self.drop_cards(DropScope::Recent, &query, 12),
        )?;
        Ok(BrowseFeed { live, upcoming, picks, recent })
    }

    /// Shops a buyer follows, most recently joined first.
    pub async fn following(&self, buyer_id: Uuid) -> DbResult<Vec<PublicShop>> {
        Ok(sqlx::query_as!(
            PublicShop,
            r#"select s.id, s.handle::text as "handle!", s.display_name, s.tagline, s.category, s.city, s.avatar_path,
                      s.cover_path, s.is_demo, s.hold_minutes, s.cohost_user_id as "cohost_user_id!",
                      s.nexconn_group_id as "nexconn_group_id!"
               from followers f join sellers s on s.id = f.seller_id
               where f.buyer_id = $1 order by f.followed_at desc"#,
            buyer_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn trust_record(&self, seller_id: Uuid) -> DbResult<TrustRecord> {
        let r = sqlx::query!(
            r#"select
                 (select count(*) from lives where seller_id = $1 and status <> 'draft') as "drops!",
                 (select count(*) from orders where seller_id = $1 and status = 'paid' and paid_via <> 'free') as "sold!",
                 (select count(*) from orders where seller_id = $1 and status = 'paid' and paid_via = 'gateway') as "gateway!",
                 (select count(*) from orders where seller_id = $1 and amount_paise > 0
                     and status in ('paid', 'expired', 'cancelled')) as "closed!",
                 (select percentile_cont(0.5) within group (order by extract(epoch from (paid_at - created_at)) / 60)
                    from orders where seller_id = $1 and status = 'paid' and paid_via <> 'free') as "median_minutes",
                 (select count(*) from followers where seller_id = $1) as "followers!",
                 exists (select 1 from seller_payment_accounts where seller_id = $1) as "gateway_connected!",
                 (select min(started_at) from lives where seller_id = $1) as "since""#,
            seller_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(TrustRecord {
            drops_run: r.drops,
            items_sold: r.sold,
            gateway_verified: r.gateway,
            completion_rate: (r.closed >= 5).then(|| r.sold as f64 / r.closed as f64),
            median_minutes_to_pay: r.median_minutes,
            followers: r.followers,
            accepts_gateway_payments: r.gateway_connected,
            selling_since: r.since,
        })
    }

    pub async fn shop_page(&self, handle: &str, viewer: Option<Uuid>) -> DbResult<ShopPage> {
        let shop = self.public_shop(handle).await?;
        let query = BrowseQuery { include_demo: true, viewer, ..BrowseQuery::default() };
        let (trust, drops, items, following) = tokio::try_join!(
            self.trust_record(shop.id),
            self.drop_cards(DropScope::Shop(shop.id), &query, 30),
            async {
                Ok::<_, crate::DbError>(sqlx::query_as!(
                ShopItem,
                r#"select i.id, i.code, i.title, i.price_paise, i.image_path, i.quantity,
                          greatest(i.quantity - count(c.id) filter (where c.status in ('held', 'paid')), 0) as "units_left!",
                          i.status as "status: ItemStatus"
                   from items i left join claims c on c.item_id = i.id
                   where i.seller_id = $1 and i.archived_at is null
                   group by i.id order by i.created_at desc limit 60"#,
                shop.id
            )
            .fetch_all(&self.pool)
            .await?)
            },
            async {
                match viewer {
                    Some(buyer) => self.is_following(shop.id, buyer).await,
                    None => Ok(false),
                }
            }
        )?;
        Ok(ShopPage { shop, trust, drops, items, following })
    }
}
