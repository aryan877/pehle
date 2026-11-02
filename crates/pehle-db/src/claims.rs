use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{ClaimOutcome, ClaimResult, ClaimSource, ClaimStatus, Db, DbResult, OrderStatus, QueueEntry};

pub struct ClaimRequest<'a> {
    pub live_id: Uuid,
    pub buyer_id: Uuid,
    /// `None` claims the pinned item.
    pub item_code: Option<&'a str>,
    pub source: ClaimSource,
    pub said: &'a str,
    /// Nexconn message ID for chat claims; makes the call idempotent across webhook retries.
    pub message_id: Option<&'a str>,
    pub received_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
pub struct ExpiredHold {
    pub claim_id: Uuid,
    pub item_id: Uuid,
    pub live_id: Uuid,
}

impl Db {
    pub async fn claim(&self, request: ClaimRequest<'_>) -> DbResult<ClaimResult> {
        let result = sqlx::query_as!(
            ClaimResult,
            r#"select (r).outcome as "outcome!: ClaimOutcome", (r).claim_id, (r).order_id, (r).item_id,
                      (r).item_code, (r).item_title, (r).claim_position as position,
                      (r).status as "status: ClaimStatus", (r).hold_expires_at, (r).units_left,
                      (r).waitlist_length
               from (select app.claim($1, $2, $3, $4, $5, $6, $7) as r) s"#,
            request.live_id,
            request.buyer_id,
            request.item_code,
            request.source as ClaimSource,
            request.said,
            request.message_id,
            request.received_at
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn expire_due_holds(&self, limit: i32) -> DbResult<Vec<ExpiredHold>> {
        let rows = sqlx::query!(
            r#"select expired_claim_id as "claim_id!", item_id as "item_id!", live_id as "live_id!"
               from app.expire_due_holds($1)"#,
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| ExpiredHold { claim_id: r.claim_id, item_id: r.item_id, live_id: r.live_id })
            .collect())
    }

    pub async fn release_claim(&self, claim_id: Uuid, buyer_id: Uuid) -> DbResult<()> {
        sqlx::query_scalar!(
            r#"select (app.release_claim($1, $2)).id as "id!""#, claim_id, buyer_id)
        .fetch_one(&self.pool).await?;
        Ok(())
    }

    /// Every claim in a live, in the order it was decided.
    pub async fn queue_for_live(&self, live_id: Uuid) -> DbResult<Vec<QueueEntry>> {
        Ok(sqlx::query_as!(
            QueueEntry,
            r#"select c.id as claim_id, c.buyer_id, c.item_id, i.code as item_code, c.position,
                      c.status as "status: ClaimStatus", c.source as "source: ClaimSource",
                      b.display_name as buyer_name, c.said, c.decided_at, c.nexconn_received_at,
                      c.hold_expires_at, o.id as "order_id?", o.status as "order_status?: OrderStatus"
               from claims c
               join items i on i.id = c.item_id
               join buyers b on b.id = c.buyer_id
               left join orders o on o.claim_id = c.id
               where c.live_id = $1
               order by c.item_id, c.position"#,
            live_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn buyer_claims_in_live(&self, live_id: Uuid, buyer_id: Uuid) -> DbResult<Vec<QueueEntry>> {
        Ok(sqlx::query_as!(
            QueueEntry,
            r#"select c.id as claim_id, c.buyer_id, c.item_id, i.code as item_code, c.position,
                      c.status as "status: ClaimStatus", c.source as "source: ClaimSource",
                      b.display_name as buyer_name, c.said, c.decided_at, c.nexconn_received_at,
                      c.hold_expires_at, o.id as "order_id?", o.status as "order_status?: OrderStatus"
               from claims c
               join items i on i.id = c.item_id
               join buyers b on b.id = c.buyer_id
               left join orders o on o.claim_id = c.id
               where c.live_id = $1 and c.buyer_id = $2
               order by c.decided_at desc"#,
            live_id,
            buyer_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn queue_entry(&self, claim_id: Uuid) -> DbResult<QueueEntry> {
        Ok(sqlx::query_as!(
            QueueEntry,
            r#"select c.id as claim_id, c.buyer_id, c.item_id, i.code as item_code, c.position,
                      c.status as "status: ClaimStatus", c.source as "source: ClaimSource",
                      b.display_name as buyer_name, c.said, c.decided_at, c.nexconn_received_at,
                      c.hold_expires_at, o.id as "order_id?", o.status as "order_status?: OrderStatus"
               from claims c
               join items i on i.id = c.item_id
               join buyers b on b.id = c.buyer_id
               left join orders o on o.claim_id = c.id
               where c.id = $1"#,
            claim_id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn waitlist_length(&self, item_id: Uuid) -> DbResult<i64> {
        Ok(sqlx::query_scalar!(r#"select app.waitlist_length($1)::bigint as "n!""#, item_id).fetch_one(&self.pool).await?)
    }

    /// Buyer and live behind a claim, for notifications.
    pub async fn claim_parties(&self, claim_id: Uuid) -> DbResult<(Uuid, Uuid, Uuid)> {
        let row = sqlx::query!("select buyer_id, live_id, item_id from claims where id = $1", claim_id)
            .fetch_one(&self.pool)
            .await?;
        Ok((row.buyer_id, row.live_id, row.item_id))
    }
}
