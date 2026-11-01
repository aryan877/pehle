use uuid::Uuid;

use crate::{Db, DbResult, PublicShop, Seller, ShopMembership, StaffRole};

pub struct NewShop<'a> {
    pub handle: &'a str,
    pub display_name: &'a str,
    pub category: &'a str,
    pub city: Option<&'a str>,
    pub upi_vpa: Option<&'a str>,
    pub upi_payee_name: Option<&'a str>,
}

pub struct ShopUpdate<'a> {
    pub display_name: &'a str,
    pub tagline: Option<&'a str>,
    pub category: &'a str,
    pub city: Option<&'a str>,
    pub upi_vpa: Option<&'a str>,
    pub upi_payee_name: Option<&'a str>,
    pub hold_minutes: i32,
    pub max_holds_per_buyer: i32,
    pub policies: &'a serde_json::Value,
}

/// Which shop image to replace.
#[derive(Clone, Copy, Debug)]
pub enum ShopImage {
    Avatar,
    Cover,
}

impl Db {
    pub async fn create_shop(&self, staff_id: Uuid, shop: NewShop<'_>) -> DbResult<Seller> {
        let id = sqlx::query_scalar!(
            r#"select (app.create_shop($1, $2, $3, $4, $5, $6, $7)).id as "id!""#,
            staff_id,
            shop.handle,
            shop.display_name,
            shop.upi_vpa.unwrap_or_default(),
            shop.upi_payee_name.unwrap_or_default(),
            shop.category,
            shop.city
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_seller(id).await
    }

    pub async fn update_shop(&self, seller_id: Uuid, staff_id: Uuid, update: ShopUpdate<'_>) -> DbResult<Seller> {
        sqlx::query_scalar!(
            r#"select (app.update_shop($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)).id as "id!""#,
            seller_id,
            staff_id,
            update.display_name,
            update.tagline,
            update.category,
            update.city,
            update.upi_vpa,
            update.upi_payee_name,
            update.hold_minutes,
            update.max_holds_per_buyer,
            update.policies
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_seller(seller_id).await
    }

    pub async fn set_shop_image(&self, seller_id: Uuid, staff_id: Uuid, image: ShopImage, path: &str) -> DbResult<()> {
        let kind = match image {
            ShopImage::Avatar => "avatar",
            ShopImage::Cover => "cover",
        };
        sqlx::query!("select app.set_shop_image($1, $2, $3, $4)", seller_id, staff_id, kind, path)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_seller(&self, id: Uuid) -> DbResult<Seller> {
        Ok(sqlx::query_as!(
            Seller,
            r#"select id, handle::text as "handle!", display_name, tagline, category, city, avatar_path, cover_path,
                      upi_vpa, upi_payee_name, hold_minutes, max_holds_per_buyer, policies, is_demo,
                      nexconn_group_id as "nexconn_group_id!", cohost_user_id as "cohost_user_id!", created_at
               from sellers where id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn public_shop(&self, handle: &str) -> DbResult<PublicShop> {
        Ok(sqlx::query_as!(
            PublicShop,
            r#"select id, handle::text as "handle!", display_name, tagline, category, city, avatar_path, cover_path,
                      is_demo, hold_minutes, cohost_user_id as "cohost_user_id!", nexconn_group_id as "nexconn_group_id!"
               from sellers where handle = $1::text::citext"#,
            handle
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn public_shop_by_id(&self, id: Uuid) -> DbResult<PublicShop> {
        Ok(sqlx::query_as!(
            PublicShop,
            r#"select id, handle::text as "handle!", display_name, tagline, category, city, avatar_path, cover_path,
                      is_demo, hold_minutes, cohost_user_id as "cohost_user_id!", nexconn_group_id as "nexconn_group_id!"
               from sellers where id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn shops_for_staff(&self, staff_id: Uuid) -> DbResult<Vec<ShopMembership>> {
        let rows = sqlx::query!(
            r#"select s.id, s.handle::text as "handle!", s.display_name, s.tagline, s.category, s.city, s.avatar_path,
                      s.cover_path, s.upi_vpa, s.upi_payee_name, s.hold_minutes, s.max_holds_per_buyer, s.policies,
                      s.is_demo, s.nexconn_group_id as "nexconn_group_id!", s.cohost_user_id as "cohost_user_id!",
                      s.created_at, m.role as "role: StaffRole"
               from seller_staff m join sellers s on s.id = m.seller_id
               where m.staff_id = $1 order by s.created_at"#,
            staff_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| ShopMembership {
                seller: Seller {
                    id: r.id,
                    handle: r.handle,
                    display_name: r.display_name,
                    tagline: r.tagline,
                    category: r.category,
                    city: r.city,
                    avatar_path: r.avatar_path,
                    cover_path: r.cover_path,
                    upi_vpa: r.upi_vpa,
                    upi_payee_name: r.upi_payee_name,
                    hold_minutes: r.hold_minutes,
                    max_holds_per_buyer: r.max_holds_per_buyer,
                    policies: r.policies,
                    is_demo: r.is_demo,
                    nexconn_group_id: r.nexconn_group_id,
                    cohost_user_id: r.cohost_user_id,
                    created_at: r.created_at,
                },
                role: r.role,
            })
            .collect())
    }

    pub async fn staff_role(&self, seller_id: Uuid, staff_id: Uuid) -> DbResult<Option<StaffRole>> {
        Ok(sqlx::query_scalar!(
            r#"select role as "role: StaffRole" from seller_staff where seller_id = $1 and staff_id = $2"#,
            seller_id,
            staff_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Nexconn user IDs of everyone on the shop's team.
    pub async fn staff_chat_ids(&self, seller_id: Uuid) -> DbResult<Vec<String>> {
        Ok(sqlx::query_scalar!(
            r#"select st.nexconn_user_id as "id!" from seller_staff s join staff st on st.id = s.staff_id
               where s.seller_id = $1"#,
            seller_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn follow(&self, seller_id: Uuid, buyer_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(r#"select app.follow($1, $2) as "added!""#, seller_id, buyer_id)
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn unfollow(&self, seller_id: Uuid, buyer_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(r#"select app.unfollow($1, $2) as "removed!""#, seller_id, buyer_id)
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn is_following(&self, seller_id: Uuid, buyer_id: Uuid) -> DbResult<bool> {
        Ok(sqlx::query_scalar!(
            r#"select exists (select 1 from followers where seller_id = $1 and buyer_id = $2) as "f!""#,
            seller_id,
            buyer_id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn follower_count(&self, seller_id: Uuid) -> DbResult<i64> {
        Ok(sqlx::query_scalar!(r#"select count(*) as "n!" from followers where seller_id = $1"#, seller_id)
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn block_buyer(&self, seller_id: Uuid, staff_id: Uuid, buyer_id: Uuid) -> DbResult<()> {
        sqlx::query!("select app.block_buyer($1, $2, $3)", seller_id, staff_id, buyer_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn unblock_buyer(&self, seller_id: Uuid, staff_id: Uuid, buyer_id: Uuid) -> DbResult<()> {
        sqlx::query!("select app.unblock_buyer($1, $2, $3)", seller_id, staff_id, buyer_id).execute(&self.pool).await?;
        Ok(())
    }
}
