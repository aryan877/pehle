use uuid::Uuid;

use crate::{Buyer, Db, DbResult, Staff};

/// A phone number verified by Firebase Authentication.
pub struct VerifiedPhone<'a> {
    pub firebase_uid: &'a str,
    pub phone_e164: &'a str,
}

impl Db {
    /// Create or refresh a staff account from a verified Google identity.
    pub async fn upsert_google_staff(&self, google_sub: &str, email: &str, name: &str, avatar_url: Option<&str>) -> DbResult<Staff> {
        let id = sqlx::query_scalar!(
            r#"select (app.upsert_google_staff($1, $2, $3, $4)).id as "id!""#,
            google_sub,
            email,
            name,
            avatar_url
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_staff(id).await
    }

    pub async fn upsert_phone_staff(&self, phone: VerifiedPhone<'_>, name: &str) -> DbResult<Staff> {
        let id = sqlx::query_scalar!(
            r#"select (app.upsert_phone_staff($1, $2, $3)).id as "id!""#,
            phone.firebase_uid,
            phone.phone_e164,
            name
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_staff(id).await
    }

    /// Development sign-in: no external identity provider.
    pub async fn upsert_dev_staff(&self, email: &str, name: &str) -> DbResult<Staff> {
        let id = sqlx::query_scalar!(r#"select (app.upsert_dev_staff($1, $2)).id as "id!""#, email, name)
            .fetch_one(&self.pool)
            .await?;
        self.get_staff(id).await
    }

    pub async fn get_staff(&self, id: Uuid) -> DbResult<Staff> {
        Ok(sqlx::query_as!(
            Staff,
            r#"select id, email::text as "email", phone_e164, display_name, avatar_url,
                      nexconn_user_id as "nexconn_user_id!"
               from staff where id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn get_staff_by_chat_id(&self, nexconn_user_id: &str) -> DbResult<Option<Staff>> {
        Ok(sqlx::query_as!(
            Staff,
            r#"select id, email::text as "email", phone_e164, display_name, avatar_url,
                      nexconn_user_id as "nexconn_user_id!"
               from staff where nexconn_user_id = $1"#,
            nexconn_user_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Plain buyers: development sign-in, tests and demo buyers.
    pub async fn create_buyer(&self, name: &str, language: &str) -> DbResult<Buyer> {
        let id = sqlx::query_scalar!(r#"select (app.create_buyer($1, $2, false)).id as "id!""#, name, language)
            .fetch_one(&self.pool)
            .await?;
        self.get_buyer(id).await
    }

    /// A buyer who can only claim in the demo shop.
    pub async fn create_demo_buyer(&self, name: &str) -> DbResult<Buyer> {
        let id = sqlx::query_scalar!(r#"select (app.create_buyer($1, 'en', true)).id as "id!""#, name)
            .fetch_one(&self.pool)
            .await?;
        self.get_buyer(id).await
    }

    /// Create or refresh a buyer from a verified Google identity. The display name defaults to the
    /// first name and last initial ("Priya S.") so full names are not shown in public rooms.
    pub async fn upsert_google_buyer(&self, google_sub: &str, email: &str, name: &str, avatar_url: Option<&str>) -> DbResult<Buyer> {
        let id = sqlx::query_scalar!(
            r#"select (app.upsert_google_buyer($1, $2, $3, $4)).id as "id!""#,
            google_sub,
            email,
            name,
            avatar_url
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_buyer(id).await
    }

    pub async fn upsert_phone_buyer(&self, phone: VerifiedPhone<'_>, name: &str) -> DbResult<Buyer> {
        let id = sqlx::query_scalar!(
            r#"select (app.upsert_phone_buyer($1, $2, $3)).id as "id!""#,
            phone.firebase_uid,
            phone.phone_e164,
            name
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_buyer(id).await
    }

    pub async fn rename_buyer(&self, id: Uuid, name: &str, language: &str) -> DbResult<Buyer> {
        sqlx::query_scalar!(r#"select (app.rename_buyer($1, $2, $3)).id as "id!""#, id, name, language)
            .fetch_one(&self.pool)
            .await?;
        self.get_buyer(id).await
    }

    pub async fn get_buyer(&self, id: Uuid) -> DbResult<Buyer> {
        Ok(sqlx::query_as!(
            Buyer,
            r#"select id, display_name, preferred_language, nexconn_user_id as "nexconn_user_id!", avatar_url,
                      email::text as "email", phone_e164, is_demo, is_bot, created_at
               from buyers where id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    /// Resolve a Nexconn user ID (`b_<hex>`) to a buyer.
    pub async fn buyer_by_chat_id(&self, nexconn_user_id: &str) -> DbResult<Option<Buyer>> {
        Ok(sqlx::query_as!(
            Buyer,
            r#"select id, display_name, preferred_language, nexconn_user_id as "nexconn_user_id!", avatar_url,
                      email::text as "email", phone_e164, is_demo, is_bot, created_at
               from buyers where nexconn_user_id = $1"#,
            nexconn_user_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }
}
