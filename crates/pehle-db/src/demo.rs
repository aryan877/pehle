//! The public demo shop: a judge or a curious seller races scripted rival buyers for one piece.

use uuid::Uuid;

use crate::{Buyer, Db, DbResult, Live, LiveStatus, Seller};

impl Db {
    /// The demo shop, created once and owned by the given staff account.
    pub async fn setup_demo_shop(&self, staff_id: Uuid) -> DbResult<Seller> {
        let id = sqlx::query_scalar!(r#"select (app.setup_demo_shop($1)).id as "id!""#, staff_id)
            .fetch_one(&self.pool)
            .await?;
        self.get_seller(id).await
    }

    pub async fn demo_shop(&self) -> DbResult<Option<Uuid>> {
        Ok(sqlx::query_scalar!("select id from sellers where handle = 'pehle-demo'").fetch_optional(&self.pool).await?)
    }

    /// The practice shop for a "try the seller side" account, created on first use.
    pub async fn create_practice_shop(&self, staff_id: Uuid) -> DbResult<Seller> {
        let id = sqlx::query_scalar!(r#"select (app.create_practice_shop($1)).id as "id!""#, staff_id)
            .fetch_one(&self.pool)
            .await?;
        self.get_seller(id).await
    }

    /// Scripted rivals. They never receive chat tokens, so they never count as chat users.
    pub async fn demo_bots(&self) -> DbResult<Vec<Buyer>> {
        Ok(sqlx::query_as!(
            Buyer,
            r#"select id as "id!", display_name as "display_name!", preferred_language as "preferred_language!",
                      nexconn_user_id as "nexconn_user_id!", avatar_url, email::text as "email", phone_e164,
                      is_demo as "is_demo!", is_bot as "is_bot!", created_at as "created_at!"
               from app.demo_bots()"#
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// The demo shop's running drop, if any.
    pub async fn demo_live(&self) -> DbResult<Option<Live>> {
        Ok(sqlx::query_as!(
            Live,
            r#"select l.id, l.seller_id, l.slug, l.title, l.description, l.stream_url, l.status as "status: LiveStatus",
                      l.scheduled_for, l.pinned_item_id, l.nexconn_channel_id as "nexconn_channel_id!",
                      l.youtube_video_id, l.youtube_live_chat_id,
                      (select count(*) from live_lineup x where x.live_id = l.id) as "lineup_count!",
                      (select i.image_path from live_lineup x join items i on i.id = x.item_id
                        where x.live_id = l.id and i.image_path is not null order by x.sort limit 1) as "cover_path",
                      l.created_at, l.started_at, l.ended_at
               from lives l join sellers s on s.id = l.seller_id
               where s.handle = 'pehle-demo' and l.status = 'live'"#
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Make a scripted rival miss their payment window now. Refuses anything outside the demo shop.
    pub async fn demo_lapse_hold(&self, claim_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(r#"select app.demo_lapse_hold($1) as "lapsed!""#, claim_id)
            .fetch_one(&self.pool)
            .await?)
    }
}
