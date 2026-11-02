use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{Db, DbResult};

#[derive(Clone, Debug)]
pub struct PaymentAccount {
    pub seller_id: Uuid,
    pub provider: String,
    pub key_id: String,
    pub key_secret_enc: Vec<u8>,
    pub webhook_secret_enc: Vec<u8>,
    pub live_mode: bool,
    pub connected_at: DateTime<Utc>,
}

/// What `app.gateway_paid` decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "app.gateway_outcome", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GatewayOutcome {
    Paid,
    AlreadyPaid,
    /// Money arrived after the hold lapsed; a refund job was queued.
    Late,
    UnknownOrder,
}

/// An open order whose payment link should be polled in case its webhook is missing.
#[derive(Clone, Debug)]
pub struct PollTarget {
    pub order_id: Uuid,
    pub seller_id: Uuid,
    pub payment_link_id: String,
}

impl Db {
    pub async fn payment_account(&self, seller_id: Uuid) -> DbResult<Option<PaymentAccount>> {
        Ok(sqlx::query_as!(
            PaymentAccount,
            r#"select seller_id, provider, key_id, key_secret_enc, webhook_secret_enc, live_mode as "live_mode!", connected_at
               from seller_payment_accounts where seller_id = $1"#,
            seller_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn save_payment_account(
        &self,
        seller_id: Uuid,
        key_id: &str,
        key_secret_enc: &[u8],
        webhook_secret_enc: &[u8],
        staff_id: Uuid,
    ) -> DbResult<()> {
        sqlx::query!(
            "select app.save_payment_account($1, $2, $3, $4, $5)",
            seller_id,
            staff_id,
            key_id,
            key_secret_enc,
            webhook_secret_enc
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_payment_account(&self, seller_id: Uuid, staff_id: Uuid) -> DbResult<()> {
        sqlx::query!("select app.delete_payment_account($1, $2)", seller_id, staff_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn set_payment_link(&self, order_id: Uuid, link_id: &str, url: &str) -> DbResult<()> {
        sqlx::query!("select app.set_payment_link($1, $2, $3)", order_id, link_id, url).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn gateway_paid(&self, order_id: Uuid, payment_id: &str, rrn: Option<&str>, amount_paise: i64) -> DbResult<GatewayOutcome> {
        Ok(sqlx::query_scalar!(
            r#"select app.gateway_paid($1, $2, $3, $4) as "outcome!: GatewayOutcome""#,
            order_id,
            payment_id,
            rrn,
            amount_paise
        )
        .fetch_one(&self.pool)
        .await?)
    }

    /// Open gateway orders created in the last two hours, oldest first.
    pub async fn payment_links_to_poll(&self, limit: i64) -> DbResult<Vec<PollTarget>> {
        let rows = sqlx::query!(
            r#"select id, seller_id, payment_link_id as "payment_link_id!" from orders
               where status in ('awaiting_payment', 'payment_reported') and payment_link_id is not null
                 and created_at > now() - interval '2 hours'
               order by created_at limit $1"#,
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| PollTarget { order_id: r.id, seller_id: r.seller_id, payment_link_id: r.payment_link_id }).collect())
    }

    pub async fn set_refund(&self, order_id: Uuid, refund_id: &str, reason: &str) -> DbResult<()> {
        sqlx::query!("select app.set_refund($1, $2, $3)", order_id, refund_id, reason).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn set_shipping(
        &self,
        order_id: Uuid,
        buyer_id: Uuid,
        name: &str,
        phone: &str,
        address: &str,
        pincode: &str,
    ) -> DbResult<()> {
        sqlx::query_scalar!(
            r#"select (app.set_shipping($1, $2, $3, $4, $5, $6)).id as "id!""#,
            order_id,
            buyer_id,
            name,
            phone,
            address,
            pincode
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(())
    }
}
