use chrono::Duration;
use sha2::{Digest, Sha256};
use sqlx::postgres::types::PgInterval;

use crate::{Db, DbError, DbResult, Principal};

/// SHA-256 of a session token. Only the digest is stored.
pub fn token_digest(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Who a new session belongs to.
#[derive(Clone, Copy, Debug)]
pub enum SessionOwner {
    Buyer(uuid::Uuid),
    Staff(uuid::Uuid),
}

impl Db {
    pub async fn create_session(&self, token: &str, owner: SessionOwner, ttl: Duration, user_agent: Option<&str>) -> DbResult<()> {
        let (buyer_id, staff_id) = match owner {
            SessionOwner::Buyer(id) => (Some(id), None),
            SessionOwner::Staff(id) => (None, Some(id)),
        };
        let ttl = PgInterval::try_from(ttl.to_std().map_err(|e| DbError::Other(e.to_string()))?)
            .map_err(|e| DbError::Other(e.to_string()))?;
        sqlx::query!(
            "select app.create_session($1, $2, $3, $4, $5)",
            token_digest(token),
            buyer_id,
            staff_id,
            user_agent,
            ttl
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Resolve a session token to its buyer or staff member.
    pub async fn session_principal(&self, token: &str) -> DbResult<Option<Principal>> {
        let row = sqlx::query!("select buyer_id, staff_id from app.session_principal($1)", token_digest(token))
            .fetch_one(&self.pool)
            .await?;
        if let Some(id) = row.buyer_id {
            return Ok(Some(Principal::Buyer(self.get_buyer(id).await?)));
        }
        if let Some(id) = row.staff_id {
            return Ok(Some(Principal::Staff(self.get_staff(id).await?)));
        }
        Ok(None)
    }

    pub async fn delete_session(&self, token: &str) -> DbResult<()> {
        sqlx::query!("select app.delete_session($1)", token_digest(token)).execute(&self.pool).await?;
        Ok(())
    }
}
