use uuid::Uuid;

use crate::{Db, DbResult, Item, ItemStatus, ItemWithCounts, PublicItem};

pub struct NewItem<'a> {
    pub code: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub price_paise: i64,
    pub quantity: i32,
    /// On update, `None` keeps the current cover photo.
    pub image_path: Option<&'a str>,
    /// On update, `None` keeps the current gallery.
    pub gallery_paths: Option<&'a [String]>,
    pub winner_note: Option<&'a str>,
}

impl Db {
    pub async fn create_item(&self, seller_id: Uuid, staff_id: Uuid, item: NewItem<'_>) -> DbResult<Item> {
        let id = sqlx::query_scalar!(
            r#"select (app.create_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)).id as "id!""#,
            seller_id,
            staff_id,
            item.code,
            item.title,
            item.description,
            item.price_paise,
            item.quantity,
            item.image_path,
            item.gallery_paths.unwrap_or_default(),
            item.winner_note
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_item(id).await
    }

    /// Edit an item. Quantity can grow at any time; it cannot drop below units already taken.
    pub async fn update_item(&self, item_id: Uuid, staff_id: Uuid, item: NewItem<'_>) -> DbResult<Item> {
        sqlx::query_scalar!(
            r#"select (app.update_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)).id as "id!""#,
            item_id,
            staff_id,
            item.code,
            item.title,
            item.description,
            item.price_paise,
            item.quantity,
            item.image_path,
            item.gallery_paths,
            item.winner_note
        )
        .fetch_one(&self.pool)
        .await?;
        self.get_item(item_id).await
    }

    pub async fn archive_item(&self, item_id: Uuid, staff_id: Uuid) -> DbResult<()> {
        sqlx::query!("select app.archive_item($1, $2)", item_id, staff_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_item(&self, item_id: Uuid) -> DbResult<Item> {
        Ok(sqlx::query_as!(
            Item,
            r#"select id, seller_id, code, title, description, price_paise, quantity, image_path, gallery_paths,
                      winner_note, status as "status: ItemStatus", open_live_id, opened_at, created_at, updated_at
               from items where id = $1"#,
            item_id
        )
        .fetch_one(&self.pool)
        .await?)
    }

    /// The seller's catalogue with live counts, in one query.
    pub async fn items_with_counts(&self, seller_id: Uuid) -> DbResult<Vec<ItemWithCounts>> {
        let rows = sqlx::query!(
            r#"select i.id, i.seller_id, i.code, i.title, i.description, i.price_paise, i.quantity, i.image_path,
                      i.gallery_paths, i.winner_note, i.status as "status: ItemStatus", i.open_live_id, i.opened_at,
                      i.created_at, i.updated_at,
                      count(c.id) filter (where c.status = 'held') as "held!",
                      count(c.id) filter (where c.status = 'paid') as "paid!",
                      count(c.id) filter (where c.status = 'waitlisted') as "waitlist!"
               from items i left join claims c on c.item_id = i.id
               where i.seller_id = $1 and i.archived_at is null
               group by i.id order by i.created_at desc"#,
            seller_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| ItemWithCounts {
                units_left: (i64::from(r.quantity) - r.held - r.paid).max(0),
                held: r.held,
                paid: r.paid,
                waitlist: r.waitlist,
                item: Item {
                    id: r.id,
                    seller_id: r.seller_id,
                    code: r.code,
                    title: r.title,
                    description: r.description,
                    price_paise: r.price_paise,
                    quantity: r.quantity,
                    image_path: r.image_path,
                    gallery_paths: r.gallery_paths,
                    winner_note: r.winner_note,
                    status: r.status,
                    open_live_id: r.open_live_id,
                    opened_at: r.opened_at,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                },
            })
            .collect())
    }

    /// A drop's lineup as buyers see it, in the seller's order, with live availability.
    pub async fn lineup(&self, live_id: Uuid) -> DbResult<Vec<PublicItem>> {
        Ok(sqlx::query_as!(
            PublicItem,
            r#"select i.id, i.code, i.title, i.description, i.price_paise, i.quantity, i.image_path, i.gallery_paths,
                      i.status as "status: ItemStatus", i.opened_at,
                      greatest(i.quantity - count(c.id) filter (where c.status in ('held', 'paid')), 0) as "units_left!",
                      count(c.id) filter (where c.status = 'waitlisted') as "waitlist!"
               from live_lineup l
               join items i on i.id = l.item_id and i.archived_at is null
               left join claims c on c.item_id = i.id
               where l.live_id = $1
               group by i.id, l.sort order by l.sort"#,
            live_id
        )
        .fetch_all(&self.pool)
        .await?)
    }

    /// Items open for claims in a drop.
    pub async fn open_items(&self, live_id: Uuid) -> DbResult<Vec<PublicItem>> {
        Ok(sqlx::query_as!(
            PublicItem,
            r#"select i.id, i.code, i.title, i.description, i.price_paise, i.quantity, i.image_path, i.gallery_paths,
                      i.status as "status: ItemStatus", i.opened_at,
                      greatest(i.quantity - count(c.id) filter (where c.status in ('held', 'paid')), 0) as "units_left!",
                      count(c.id) filter (where c.status = 'waitlisted') as "waitlist!"
               from items i left join claims c on c.item_id = i.id
               where i.open_live_id = $1
               group by i.id order by i.opened_at"#,
            live_id
        )
        .fetch_all(&self.pool)
        .await?)
    }
}
