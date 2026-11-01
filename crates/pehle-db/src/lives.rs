use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{Db, DbResult, Item, Live, LiveStatus};

/// Everything a seller sets when announcing or editing a drop.
pub struct DropInput<'a> {
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub stream_url: Option<&'a str>,
    /// Parsed from `stream_url` by the API when it is a YouTube link.
    pub youtube_video_id: Option<&'a str>,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub item_ids: &'a [Uuid],
}

/// Who to notify when a drop starts.
#[derive(Clone, Copy, Debug)]
pub struct AudienceMember {
    pub buyer_id: Uuid,
    /// Asked to be reminded about this drop (otherwise: in the shop's club).
    pub reminded: bool,
}

/// How a finished (or running) drop went, from the decision log.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DropReport {
    pub items_dropped: i64,
    pub units_offered: i64,
    pub units_sold: i64,
    pub revenue_paise: i64,
    pub claims: i64,
    pub claimants: i64,
    pub viewers_signed_in: i64,
    /// Everyone who entered the room, including signed-out viewers (from Nexconn join events).
    pub visitors: i64,
    /// Holds that lapsed unpaid and went to the next person in line.
    pub non_payers_replaced: i64,
    /// People still waiting when the report ran: demand for a restock.
    pub still_waiting: i64,
    pub paid_via_gateway: i64,
    /// Median seconds from an item opening to its last unit being claimed.
    pub median_sell_out_seconds: Option<f64>,
    pub new_club_members: i64,
    pub items: Vec<DropReportItem>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DropReportItem {
    pub item_id: Uuid,
    pub code: String,
    pub title: String,
    pub quantity: i32,
    pub sold: i64,
    pub held: i64,
    pub waiting: i64,
    pub claims: i64,
    pub sell_out_seconds: Option<f64>,
}

impl Db {
    pub async fn create_live(&self, seller_id: Uuid, staff_id: Uuid, input: DropInput<'_>) -> DbResult<Live> {
        let id = sqlx::query_scalar!(
            r#"select (app.create_live($1, $2, $3, $4, $5, $6, $7, $8)).id as "id!""#,
            seller_id,
            staff_id,
            input.title,
            input.stream_url,
            input.youtube_video_id,
            input.description,
            input.scheduled_for,
            input.item_ids
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_live(id).await
    }

    pub async fn update_live(&self, live_id: Uuid, staff_id: Uuid, input: DropInput<'_>) -> DbResult<Live> {
        sqlx::query_scalar!(
            r#"select (app.update_live($1, $2, $3, $4, $5, $6, $7, $8)).id as "id!""#,
            live_id,
            staff_id,
            input.title,
            input.stream_url,
            input.youtube_video_id,
            input.description,
            input.scheduled_for,
            input.item_ids
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_live(live_id).await
    }

    pub async fn start_live(&self, live_id: Uuid, staff_id: Uuid) -> DbResult<Live> {
        sqlx::query_scalar!(r#"select (app.start_live($1, $2)).id as "id!""#, live_id, staff_id).fetch_one(&self.pool).await?;
        self.get_live(live_id).await
    }

    pub async fn end_live(&self, live_id: Uuid, staff_id: Uuid) -> DbResult<Live> {
        sqlx::query_scalar!(r#"select (app.end_live($1, $2)).id as "id!""#, live_id, staff_id).fetch_one(&self.pool).await?;
        self.get_live(live_id).await
    }

    pub async fn drop_item(&self, live_id: Uuid, item_id: Uuid, staff_id: Uuid) -> DbResult<Item> {
        sqlx::query_scalar!(r#"select (app.drop_item($1, $2, $3)).id as "id!""#, live_id, item_id, staff_id)
            .fetch_one(&self.pool)
            .await?;
        self.get_item(item_id).await
    }

    pub async fn close_item(&self, live_id: Uuid, item_id: Uuid, staff_id: Uuid) -> DbResult<Item> {
        sqlx::query_scalar!(r#"select (app.close_item($1, $2, $3)).id as "id!""#, live_id, item_id, staff_id)
            .fetch_one(&self.pool)
            .await?;
        self.get_item(item_id).await
    }

    pub async fn get_live(&self, id: Uuid) -> DbResult<Live> {
        Ok(sqlx::query_as!(
            Live,
            r#"select id, seller_id, slug, title, description, stream_url, status as "status: LiveStatus", scheduled_for,
                      pinned_item_id, nexconn_channel_id as "nexconn_channel_id!", youtube_video_id,
                      youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = lives.id) as "lineup_count!",
                      (select coalesce(
                          (select i.image_path from items i where i.id = lives.pinned_item_id),
                          (select i.image_path from live_lineup x join items i on i.id = x.item_id
                            where x.live_id = lives.id and i.image_path is not null order by x.sort limit 1))) as "cover_path",
                      created_at, started_at, ended_at
               from lives where id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn live_by_slug(&self, slug: &str) -> DbResult<Live> {
        Ok(sqlx::query_as!(
            Live,
            r#"select id, seller_id, slug, title, description, stream_url, status as "status: LiveStatus", scheduled_for,
                      pinned_item_id, nexconn_channel_id as "nexconn_channel_id!", youtube_video_id,
                      youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = lives.id) as "lineup_count!",
                      (select coalesce(
                          (select i.image_path from items i where i.id = lives.pinned_item_id),
                          (select i.image_path from live_lineup x join items i on i.id = x.item_id
                            where x.live_id = lives.id and i.image_path is not null order by x.sort limit 1))) as "cover_path",
                      created_at, started_at, ended_at
               from lives where slug = $1"#,
            slug
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn live_by_channel(&self, channel_id: &str) -> DbResult<Option<Live>> {
        Ok(sqlx::query_as!(
            Live,
            r#"select id, seller_id, slug, title, description, stream_url, status as "status: LiveStatus", scheduled_for,
                      pinned_item_id, nexconn_channel_id as "nexconn_channel_id!", youtube_video_id,
                      youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = lives.id) as "lineup_count!",
                      (select coalesce(
                          (select i.image_path from items i where i.id = lives.pinned_item_id),
                          (select i.image_path from live_lineup x join items i on i.id = x.item_id
                            where x.live_id = lives.id and i.image_path is not null order by x.sort limit 1))) as "cover_path",
                      created_at, started_at, ended_at
               from lives where nexconn_channel_id = $1"#,
            channel_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn lives_for_seller(&self, seller_id: Uuid) -> DbResult<Vec<Live>> {
        Ok(sqlx::query_as!(
            Live,
            r#"select id, seller_id, slug, title, description, stream_url, status as "status: LiveStatus", scheduled_for,
                      pinned_item_id, nexconn_channel_id as "nexconn_channel_id!", youtube_video_id,
                      youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = lives.id) as "lineup_count!",
                      (select coalesce(
                          (select i.image_path from items i where i.id = lives.pinned_item_id),
                          (select i.image_path from live_lineup x join items i on i.id = x.item_id
                            where x.live_id = lives.id and i.image_path is not null order by x.sort limit 1))) as "cover_path",
                      created_at, started_at, ended_at
               from lives where seller_id = $1
               order by (status = 'live') desc, coalesce(scheduled_for, created_at) desc limit 100"#,
            seller_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn current_live(&self, seller_id: Uuid) -> DbResult<Option<Live>> {
        Ok(sqlx::query_as!(
            Live,
            r#"select id, seller_id, slug, title, description, stream_url, status as "status: LiveStatus", scheduled_for,
                      pinned_item_id, nexconn_channel_id as "nexconn_channel_id!", youtube_video_id,
                      youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = lives.id) as "lineup_count!",
                      (select coalesce(
                          (select i.image_path from items i where i.id = lives.pinned_item_id),
                          (select i.image_path from live_lineup x join items i on i.id = x.item_id
                            where x.live_id = lives.id and i.image_path is not null order by x.sort limit 1))) as "cover_path",
                      created_at, started_at, ended_at
               from lives where seller_id = $1 and status = 'live'"#,
            seller_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Item IDs in a drop's lineup, in order (for the studio editor).
    pub async fn lineup_ids(&self, live_id: Uuid) -> DbResult<Vec<Uuid>> {
        Ok(sqlx::query_scalar!("select item_id from live_lineup where live_id = $1 order by sort", live_id)
            .fetch_all(&self.pool)
            .await?)
    }

    /// The room state document written to the open channel's metadata.
    pub async fn live_snapshot(&self, live_id: Uuid) -> DbResult<serde_json::Value> {
        Ok(sqlx::query_scalar!(r#"select app.live_snapshot($1) as "s!""#, live_id).fetch_one(&self.pool).await?)
    }

    pub async fn toggle_reminder(&self, live_id: Uuid, buyer_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(r#"select app.toggle_reminder($1, $2) as "on!""#, live_id, buyer_id)
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn has_reminder(&self, live_id: Uuid, buyer_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(
            r#"select exists (select 1 from drop_reminders where live_id = $1 and buyer_id = $2) as "on!""#,
            live_id,
            buyer_id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn reminder_count(&self, live_id: Uuid) -> DbResult<i64> {
        Ok(sqlx::query_scalar!(r#"select count(*) as "n!" from drop_reminders where live_id = $1"#, live_id)
            .fetch_one(&self.pool)
            .await?)
    }

    /// Reminder holders and club members to notify that a drop started. Each reminder is handed out once.
    pub async fn take_drop_audience(&self, live_id: Uuid) -> DbResult<Vec<AudienceMember>> {
        let rows = sqlx::query!(
            r#"select buyer_id as "buyer_id!", reminded as "reminded!" from app.take_drop_audience($1)"#,
            live_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| AudienceMember { buyer_id: r.buyer_id, reminded: r.reminded }).collect())
    }

    pub async fn drop_report(&self, live_id: Uuid) -> DbResult<DropReport> {
        let items = sqlx::query_as!(
            DropReportItem,
            r#"select i.id as item_id, i.code, i.title, i.quantity,
                      count(c.id) filter (where c.status = 'paid') as "sold!",
                      count(c.id) filter (where c.status = 'held') as "held!",
                      count(c.id) filter (where c.status = 'waitlisted') as "waiting!",
                      count(c.id) as "claims!",
                      -- The claim at position = quantity took the last unit the first time round.
                      (select extract(epoch from (c2.decided_at - d.at))::float8
                         from claims c2,
                              lateral (select min(e.at) as at from events e
                                        where e.live_id = $1 and e.item_id = i.id and e.kind = 'item.dropped') d
                        where c2.item_id = i.id and c2.live_id = $1 and c2.position = i.quantity) as "sell_out_seconds"
               from items i
               join claims c on c.item_id = i.id and c.live_id = $1
               group by i.id order by min(c.decided_at)"#,
            live_id
        )
        .fetch_all(&self.pool)
        .await?;
        let r = sqlx::query!(
            r#"select
                 (select count(distinct item_id) from events where live_id = $1 and kind = 'item.dropped') as "dropped!",
                 (select count(*) from orders where live_id = $1 and status = 'paid') as "sold!",
                 (select coalesce(sum(amount_paise), 0)::bigint from orders where live_id = $1 and status = 'paid') as "revenue!",
                 (select count(*) from orders where live_id = $1 and status = 'paid' and paid_via = 'gateway') as "gateway!",
                 (select count(*) from claims where live_id = $1) as "claims!",
                 (select count(distinct buyer_id) from claims where live_id = $1) as "claimants!",
                 (select count(distinct buyer_id) from events where live_id = $1 and kind = 'room.joined') as "viewers!",
                 (select count(distinct u) from events e, jsonb_array_elements_text(e.data->'users') u
                   where e.live_id = $1 and e.kind = 'room.entered') as "visitors!",
                 (select count(*) from events where live_id = $1 and kind = 'hold.expired') as "replaced!",
                 (select count(*) from claims where live_id = $1 and status = 'waitlisted') as "waiting!",
                 (select count(*) from followers f join lives l on l.id = $1 and l.seller_id = f.seller_id
                   where f.followed_at >= coalesce(l.started_at, l.created_at)
                     and f.followed_at <= coalesce(l.ended_at, now())) as "club!""#,
            live_id
        )
        .fetch_one(&self.pool)
        .await?;
        let mut speeds: Vec<f64> = items.iter().filter_map(|i| i.sell_out_seconds).collect();
        speeds.sort_by(f64::total_cmp);
        let median = match speeds.len() {
            0 => None,
            n if n % 2 == 1 => Some(speeds[n / 2]),
            n => Some((speeds[n / 2 - 1] + speeds[n / 2]) / 2.0),
        };
        Ok(DropReport {
            items_dropped: r.dropped,
            units_offered: items.iter().map(|i| i64::from(i.quantity)).sum(),
            units_sold: r.sold,
            revenue_paise: r.revenue,
            claims: r.claims,
            claimants: r.claimants,
            viewers_signed_in: r.viewers,
            visitors: r.visitors,
            non_payers_replaced: r.replaced,
            still_waiting: r.waiting,
            paid_via_gateway: r.gateway,
            median_sell_out_seconds: median,
            new_club_members: r.club,
            items,
        })
    }
}
