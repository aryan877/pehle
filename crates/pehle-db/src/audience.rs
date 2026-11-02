//! Buyer↔shop conversations and browser push subscriptions.

use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{Db, DbResult};

/// One buyer↔shop thread, backed by a Nexconn group channel.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: Uuid,
    pub seller_id: Uuid,
    pub buyer_id: Uuid,
    pub nexconn_group_id: String,
    pub provisioned: bool,
    pub shop_handle: String,
    pub shop_name: String,
    pub shop_avatar_path: Option<String>,
    pub buyer_name: String,
    pub buyer_avatar_url: Option<String>,
    /// Orders still waiting on someone (payment or confirmation).
    pub open_orders: i64,
    pub last_activity_at: DateTime<Utc>,
}

/// Who to notify on a browser.
#[derive(Clone, Copy, Debug)]
pub enum PushOwner {
    Buyer(Uuid),
    Staff(Uuid),
}

#[derive(Clone, Debug)]
pub struct PushTarget {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

impl Db {
    /// The conversation between a shop and a buyer, created on first use.
    pub async fn ensure_conversation(&self, seller_id: Uuid, buyer_id: Uuid) -> DbResult<Conversation> {
        let id = sqlx::query_scalar!(r#"select (app.ensure_conversation($1, $2)).id as "id!""#, seller_id, buyer_id)
            .fetch_one(&self.pool)
            .await?;
        self.conversation(id).await
    }

    pub async fn conversation(&self, id: Uuid) -> DbResult<Conversation> {
        self.conversations(Some(id), None, None, 1)
            .await?
            .pop()
            .ok_or_else(|| crate::DbError::NotFound("Conversation not found.".into()))
    }

    pub async fn conversations_for_buyer(&self, buyer_id: Uuid) -> DbResult<Vec<Conversation>> {
        self.conversations(None, None, Some(buyer_id), 100).await
    }

    pub async fn conversations_for_seller(&self, seller_id: Uuid) -> DbResult<Vec<Conversation>> {
        self.conversations(None, Some(seller_id), None, 200).await
    }

    async fn conversations(&self, id: Option<Uuid>, seller_id: Option<Uuid>, buyer_id: Option<Uuid>, limit: i64) -> DbResult<Vec<Conversation>> {
        Ok(sqlx::query_as!(
            Conversation,
            r#"select v.id, v.seller_id, v.buyer_id, v.nexconn_group_id as "nexconn_group_id!",
                      (v.provisioned_at is not null) as "provisioned!",
                      s.handle::text as "shop_handle!", s.display_name as shop_name, s.avatar_path as shop_avatar_path,
                      b.display_name as buyer_name, b.avatar_url as buyer_avatar_url,
                      (select count(*) from orders o where o.seller_id = v.seller_id and o.buyer_id = v.buyer_id
                          and o.status in ('awaiting_payment', 'payment_reported')) as "open_orders!",
                      v.last_activity_at
               from conversations v
               join sellers s on s.id = v.seller_id
               join buyers b on b.id = v.buyer_id
               where ($1::uuid is null or v.id = $1)
                 and ($2::uuid is null or v.seller_id = $2)
                 and ($3::uuid is null or v.buyer_id = $3)
               order by v.last_activity_at desc
               limit $4"#,
            id,
            seller_id,
            buyer_id,
            limit
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn conversation_by_group(&self, nexconn_group_id: &str) -> DbResult<Option<Uuid>> {
        Ok(sqlx::query_scalar!("select id from conversations where nexconn_group_id = $1", nexconn_group_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn conversation_provisioned(&self, id: Uuid) -> DbResult<()> {
        sqlx::query!("select app.conversation_provisioned($1)", id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn touch_conversation(&self, nexconn_group_id: &str) -> DbResult<()> {
        sqlx::query!("select app.touch_conversation($1)", nexconn_group_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn save_push_subscription(
        &self,
        owner: PushOwner,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        user_agent: Option<&str>,
    ) -> DbResult<()> {
        let (buyer_id, staff_id) = match owner {
            PushOwner::Buyer(id) => (Some(id), None),
            PushOwner::Staff(id) => (None, Some(id)),
        };
        sqlx::query!(
            "select app.save_push_subscription($1, $2, $3, $4, $5, $6)",
            endpoint,
            buyer_id,
            staff_id,
            p256dh,
            auth,
            user_agent
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_push_subscription(&self, endpoint: &str) -> DbResult<()> {
        sqlx::query!("select app.delete_push_subscription($1)", endpoint).execute(&self.pool).await?;
        Ok(())
    }

    /// Every browser registered by these buyers.
    pub async fn push_targets_for_buyers(&self, buyer_ids: &[Uuid]) -> DbResult<Vec<PushTarget>> {
        Ok(sqlx::query_as!(
            PushTarget,
            "select endpoint, p256dh, auth from push_subscriptions where buyer_id = any($1)",
            buyer_ids
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// Every browser registered by a shop's team.
    pub async fn push_targets_for_shop_team(&self, seller_id: Uuid) -> DbResult<Vec<PushTarget>> {
        Ok(sqlx::query_as!(
            PushTarget,
            r#"select p.endpoint, p.p256dh, p.auth from push_subscriptions p
               join seller_staff m on m.staff_id = p.staff_id where m.seller_id = $1"#,
            seller_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn push_delivered(&self, endpoint: &str, ok: bool, gone: bool) -> DbResult<()> {
        sqlx::query!("select app.push_delivered($1, $2, $3)", endpoint, ok, gone).execute(&self.pool).await?;
        Ok(())
    }
}
