use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{Db, DbResult};

/// A running drop whose YouTube chat Pehle should read.
#[derive(Clone, Debug)]
pub struct YoutubeTarget {
    pub live_id: Uuid,
    pub video_id: String,
    pub live_chat_id: Option<String>,
    pub page_token: Option<String>,
}

impl Db {
    pub async fn youtube_targets(&self) -> DbResult<Vec<YoutubeTarget>> {
        let rows = sqlx::query!(
            r#"select id, youtube_video_id as "video_id!", youtube_live_chat_id, youtube_page_token
               from lives where status = 'live' and youtube_video_id is not null
               order by youtube_checked_at nulls first"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| YoutubeTarget { live_id: r.id, video_id: r.video_id, live_chat_id: r.youtube_live_chat_id, page_token: r.youtube_page_token })
            .collect())
    }

    pub async fn set_youtube_chat(&self, live_id: Uuid, live_chat_id: Option<&str>, page_token: Option<&str>) -> DbResult<()> {
        sqlx::query!("select app.set_youtube_chat($1, $2, $3)", live_id, live_chat_id, page_token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The buyer behind a YouTube commenter (a placeholder until someone links the channel).
    pub async fn youtube_buyer(&self, channel_id: &str, name: &str) -> DbResult<Uuid> {
        Ok(sqlx::query_scalar!(r#"select app.youtube_buyer($1, $2) as "id!""#, channel_id, name)
            .fetch_one(&self.pool)
            .await?)
    }

    /// A four-digit code the buyer types in YouTube chat ("pehle 1234") to link their YouTube name.
    pub async fn youtube_link_code(&self, live_id: Uuid, buyer_id: Uuid) -> DbResult<(String, DateTime<Utc>)> {
        let row = sqlx::query!(
            r#"select (c).code as "code!", (c).expires_at as "expires_at!"
               from (select app.issue_youtube_code($1, $2) as c) s"#,
            live_id,
            buyer_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok((row.code, row.expires_at))
    }

    /// The YouTube name already linked to a buyer, if any.
    pub async fn youtube_name(&self, buyer_id: Uuid) -> DbResult<Option<String>> {
        Ok(sqlx::query_scalar!("select youtube_name from buyers where id = $1", buyer_id).fetch_one(&self.pool).await?)
    }

    /// Link a YouTube channel using a typed code. Returns the buyer it was linked to.
    pub async fn link_youtube(&self, live_id: Uuid, code: &str, channel_id: &str, name: &str) -> DbResult<Option<Uuid>> {
        Ok(sqlx::query_scalar!(r#"select app.link_youtube($1, $2, $3, $4) as "buyer""#, live_id, code, channel_id, name)
            .fetch_one(&self.pool)
            .await?)
    }
}
