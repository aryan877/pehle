use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{ApprovalStatus, Db, DbResult};

/// A question the co-host would not answer alone, waiting for the shop team.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: Uuid,
    pub seller_id: Uuid,
    pub live_id: Option<Uuid>,
    pub buyer_id: Option<Uuid>,
    pub buyer_name: Option<String>,
    pub kind: String,
    pub question: String,
    pub proposed_reply: String,
    pub status: ApprovalStatus,
    pub created_at: DateTime<Utc>,
    pub decided_at: Option<DateTime<Utc>>,
}

impl Db {
    pub async fn create_approval(
        &self,
        seller_id: Uuid,
        live_id: Option<Uuid>,
        buyer_id: Uuid,
        kind: &str,
        question: &str,
        proposed_reply: &str,
    ) -> DbResult<Uuid> {
        let id = sqlx::query_scalar!(
            r#"select app.request_approval($1, $2, $3, $4, $5, $6) as "id!""#,
            seller_id,
            live_id,
            buyer_id,
            kind,
            question,
            proposed_reply
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(id)
    }

    pub async fn pending_approvals(&self, seller_id: Uuid) -> DbResult<Vec<Approval>> {
        Ok(sqlx::query_as!(
            Approval,
            r#"select a.id, a.seller_id, a.live_id, a.buyer_id, b.display_name as "buyer_name?", a.kind, a.question,
                      a.proposed_reply, a.status as "status: ApprovalStatus", a.created_at, a.decided_at
               from approvals a left join buyers b on b.id = a.buyer_id
               where a.seller_id = $1 and a.status = 'pending' order by a.created_at"#,
            seller_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// Approve (optionally with an edited reply) or decline. Returns the decided approval.
    pub async fn decide_approval(&self, approval_id: Uuid, staff_id: Uuid, approve: bool, reply: Option<&str>) -> DbResult<Approval> {
        sqlx::query_scalar!(
            r#"select (app.decide_approval($1, $2, $3, $4)).id as "id!""#,
            approval_id,
            staff_id,
            approve,
            reply
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(sqlx::query_as!(
            Approval,
            r#"select a.id, a.seller_id, a.live_id, a.buyer_id, b.display_name as "buyer_name?", a.kind, a.question,
                      a.proposed_reply, a.status as "status: ApprovalStatus", a.created_at, a.decided_at
               from approvals a left join buyers b on b.id = a.buyer_id where a.id = $1"#,
            approval_id
        )
        .fetch_one(&self.pool)
        .await?)
    }
}
