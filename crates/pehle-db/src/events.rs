use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{Db, DbResult, Event};

/// Usage numbers for a shop or for all of Pehle. These back the traction claims in the submission.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub shops: i64,
    pub lives: i64,
    pub buyers_joined: i64,
    /// Distinct people (signed in or watching) whose browser connected to Nexconn chat.
    pub chat_users: i64,
    /// Distinct people who entered a drop room, from Nexconn's own join events.
    pub room_visitors: i64,
    pub buyers_who_claimed: i64,
    pub claims: i64,
    pub waitlist_promotions: i64,
    pub orders_paid: i64,
    pub revenue_paise: i64,
    pub followers: i64,
}

impl Db {
    pub async fn record_event(
        &self,
        kind: &str,
        seller_id: Option<Uuid>,
        live_id: Option<Uuid>,
        buyer_id: Option<Uuid>,
        data: serde_json::Value,
    ) -> DbResult<()> {
        sqlx::query!(
            "select app.record_event($1, $2, $3, $4, $5)",
            kind,
            seller_id,
            live_id,
            buyer_id,
            data
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Claim decisions in a live after `after_id`, oldest first: the public fairness log.
    pub async fn claim_events(&self, live_id: Uuid, after_id: i64, limit: i64) -> DbResult<Vec<Event>> {
        Ok(sqlx::query_as!(
            Event,
            // With a cursor: the next events after it. Without one: the newest events. Oldest first either way.
            r#"select id as "id!", at as "at!", kind as "kind!", item_id, claim_id, data as "data!" from (
                 select id, at, kind, item_id, claim_id, data from events
                 where live_id = $1 and id > $2
                   and kind in ('claim.held', 'claim.waitlisted', 'claim.promoted', 'claim.released',
                                'hold.expired', 'order.paid', 'order.cancelled', 'item.dropped', 'item.closed')
                 order by case when $2 = 0 then -id else id end
                 limit $3) recent
               order by id"#,
            live_id,
            after_id,
            limit
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// Usage for one shop or all of Pehle, optionally only since a point in time.
    pub async fn stats(&self, seller_id: Option<Uuid>, since: Option<chrono::DateTime<chrono::Utc>>) -> DbResult<Stats> {
        let row = sqlx::query!(
            // Demo and practice shops are excluded: their claims and payments are simulated.
            r#"with shop as (select id from sellers where not is_demo and ($1::uuid is null or id = $1))
               select
                 (select count(*) from sellers where id in (select id from shop)
                     and ($2::timestamptz is null or created_at >= $2)) as "shops!",
                 (select count(*) from lives where status <> 'draft' and seller_id in (select id from shop)
                     and ($2::timestamptz is null or started_at >= $2)) as "lives!",
                 (select count(distinct buyer_id) from events where kind = 'room.joined'
                     and seller_id in (select id from shop) and ($2::timestamptz is null or at >= $2)) as "joined!",
                 (select count(distinct data->>'userId') from events where kind = 'chat.online' and $1::uuid is null
                     and ($2::timestamptz is null or at >= $2)) as "chat_users!",
                 (select count(distinct u) from events e, jsonb_array_elements_text(e.data->'users') u
                     where e.kind = 'room.entered' and e.seller_id in (select id from shop)
                       and ($2::timestamptz is null or e.at >= $2)) as "visitors!",
                 (select count(distinct c.buyer_id) from claims c join items i on i.id = c.item_id
                     where i.seller_id in (select id from shop) and ($2::timestamptz is null or c.decided_at >= $2)) as "claimers!",
                 (select count(*) from claims c join items i on i.id = c.item_id
                     where i.seller_id in (select id from shop) and ($2::timestamptz is null or c.decided_at >= $2)) as "claims!",
                 (select count(*) from events where kind = 'claim.promoted'
                     and seller_id in (select id from shop) and ($2::timestamptz is null or at >= $2)) as "promotions!",
                 (select count(*) from orders where status = 'paid' and seller_id in (select id from shop)
                     and ($2::timestamptz is null or paid_at >= $2)) as "paid!",
                 (select coalesce(sum(amount_paise), 0)::bigint from orders where status = 'paid'
                     and seller_id in (select id from shop) and ($2::timestamptz is null or paid_at >= $2)) as "revenue!",
                 (select count(*) from followers where seller_id in (select id from shop)
                     and ($2::timestamptz is null or followed_at >= $2)) as "followers!""#,
            seller_id,
            since
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(Stats {
            shops: row.shops,
            lives: row.lives,
            buyers_joined: row.joined,
            chat_users: row.chat_users,
            room_visitors: row.visitors,
            buyers_who_claimed: row.claimers,
            claims: row.claims,
            waitlist_promotions: row.promotions,
            orders_paid: row.paid,
            revenue_paise: row.revenue,
            followers: row.followers,
        })
    }
}
