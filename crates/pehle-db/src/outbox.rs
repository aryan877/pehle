use std::time::Duration;

use crate::{Db, DbResult, OutboxJob};

/// Jobs that keep failing stop retrying after this many attempts and stay in the table for review.
pub const MAX_ATTEMPTS: i32 = 8;

impl Db {
    pub async fn enqueue(&self, kind: &str, payload: serde_json::Value, dedupe_key: Option<&str>) -> DbResult<()> {
        sqlx::query!("select app.enqueue($1, $2, $3)", kind, payload, dedupe_key).execute(&self.pool).await?;
        Ok(())
    }

    /// Lease up to `limit` due jobs. Room syncs release their dedupe key on lease, so a change that
    /// lands while the sync runs queues another sync instead of being dropped.
    /// `cohost_lane` selects co-host jobs (slow model calls) or everything else.
    pub async fn lease_jobs(&self, limit: i32, lease: Duration, cohost_lane: bool) -> DbResult<Vec<OutboxJob>> {
        Ok(sqlx::query_as!(
            OutboxJob,
            r#"select id as "id!", kind as "kind!", payload as "payload!", attempts as "attempts!"
               from app.lease_jobs($1, $2, $3, $4)"#,
            limit,
            lease.as_secs_f64(),
            MAX_ATTEMPTS,
            cohost_lane
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn complete_job(&self, id: i64) -> DbResult<()> {
        sqlx::query!("select app.complete_job($1)", id).execute(&self.pool).await?;
        Ok(())
    }

    /// Record a failure and back off exponentially: 2s, 4s, 8s ... capped at 10 minutes.
    pub async fn fail_job(&self, id: i64, attempts: i32, error: &str) -> DbResult<()> {
        let backoff = 2f64.powi(attempts.clamp(1, 9)).min(600.0);
        sqlx::query!("select app.fail_job($1, $2, $3)", id, error, backoff).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn outbox_backlog(&self) -> DbResult<i64> {
        let n = sqlx::query_scalar!(r#"select count(*) as "n!" from outbox where done_at is null and attempts < $1"#, MAX_ATTEMPTS)
            .fetch_one(&self.pool)
            .await?;
        Ok(n)
    }

    /// Record a webhook event ID. Returns false when it was already seen.
    pub async fn first_sighting(&self, event_id: &str, kind: &str) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(r#"select app.first_sighting($1, $2) as "first!""#, event_id, kind)
            .fetch_one(&self.pool)
            .await?)
    }

    /// Purge expired sessions, old webhook IDs and finished jobs.
    pub async fn housekeeping(&self) -> DbResult<serde_json::Value> {
        Ok(sqlx::query_scalar!(r#"select app.housekeeping() as "done!""#).fetch_one(&self.pool).await?)
    }
}
