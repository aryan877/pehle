use uuid::Uuid;

use crate::{Db, DbResult, Order, OrderStatus, OrderView};

pub struct PaymentReport<'a> {
    pub upi_reference: &'a str,
    pub ship_name: &'a str,
    pub ship_phone: &'a str,
    pub ship_address: &'a str,
    pub ship_pincode: &'a str,
}

/// Which orders a seller wants to see.
#[derive(Clone, Copy, Debug)]
pub enum OrderFilter {
    Open,
    Paid,
    All,
}

impl OrderFilter {
    fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Paid => "paid",
            Self::All => "all",
        }
    }
}

/// Selector for the single order-view query.
struct Scope {
    order_id: Option<Uuid>,
    seller_id: Option<Uuid>,
    buyer_id: Option<Uuid>,
    filter: &'static str,
    limit: i64,
}

impl Db {
    /// Orders with everything checkout needs, in one query. The winner note appears once paid.
    async fn order_views(&self, scope: Scope) -> DbResult<Vec<OrderView>> {
        let rows = sqlx::query!(
            r#"select o.id, o.claim_id, o.seller_id, o.buyer_id, o.item_id, o.live_id, o.amount_paise,
                      o.status as "status: OrderStatus", o.upi_reference, o.ship_name, o.ship_phone,
                      o.ship_address, o.ship_pincode, o.created_at, o.payment_reported_at, o.paid_at, o.closed_at,
                      o.payment_link_url, o.paid_via, o.gateway_rrn, o.refund_id,
                      i.code as item_code, i.title as item_title, i.image_path as item_image_path,
                      case when o.status = 'paid' then i.winner_note end as winner_note,
                      c.position as claim_position, c.hold_expires_at,
                      b.display_name as buyer_name, b.nexconn_user_id as "buyer_nexconn_user_id!",
                      s.handle::text as "shop_handle!", s.display_name as shop_name,
                      s.cohost_user_id as "shop_cohost_user_id!", s.avatar_path as shop_avatar_path, s.is_demo as shop_is_demo,
                      s.upi_vpa, s.upi_payee_name,
                      l.slug as live_slug
               from orders o
               join items i on i.id = o.item_id
               join claims c on c.id = o.claim_id
               join buyers b on b.id = o.buyer_id
               join sellers s on s.id = o.seller_id
               join lives l on l.id = o.live_id
               where ($1::uuid is null or o.id = $1)
                 and ($2::uuid is null or o.seller_id = $2)
                 and ($3::uuid is null or o.buyer_id = $3)
                 and case $4::text
                       when 'open' then o.status in ('awaiting_payment', 'payment_reported')
                       when 'paid' then o.status = 'paid'
                       else true end
               order by case when $4::text = 'open' then (o.status = 'payment_reported')::int end desc,
                        case when $4::text = 'paid' then o.paid_at end desc,
                        o.created_at desc
               limit $5"#,
            scope.order_id,
            scope.seller_id,
            scope.buyer_id,
            scope.filter,
            scope.limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| OrderView {
                order: Order {
                    id: r.id,
                    claim_id: r.claim_id,
                    seller_id: r.seller_id,
                    buyer_id: r.buyer_id,
                    item_id: r.item_id,
                    live_id: r.live_id,
                    amount_paise: r.amount_paise,
                    status: r.status,
                    upi_reference: r.upi_reference,
                    ship_name: r.ship_name,
                    ship_phone: r.ship_phone,
                    ship_address: r.ship_address,
                    ship_pincode: r.ship_pincode,
                    created_at: r.created_at,
                    payment_reported_at: r.payment_reported_at,
                    paid_at: r.paid_at,
                    closed_at: r.closed_at,
                    payment_link_url: r.payment_link_url,
                    paid_via: r.paid_via,
                    gateway_rrn: r.gateway_rrn,
                    refund_id: r.refund_id,
                },
                item_code: r.item_code,
                item_title: r.item_title,
                item_image_path: r.item_image_path,
                claim_position: r.claim_position,
                hold_expires_at: r.hold_expires_at,
                buyer_name: r.buyer_name,
                buyer_nexconn_user_id: r.buyer_nexconn_user_id,
                shop_handle: r.shop_handle,
                shop_name: r.shop_name,
                shop_cohost_user_id: r.shop_cohost_user_id,
                shop_avatar_path: r.shop_avatar_path,
                shop_is_demo: r.shop_is_demo,
                upi_vpa: r.upi_vpa,
                upi_payee_name: r.upi_payee_name,
                live_slug: r.live_slug,
                winner_note: r.winner_note,
            })
            .collect())
    }

    pub async fn order_view(&self, order_id: Uuid) -> DbResult<OrderView> {
        self.order_views(Scope { order_id: Some(order_id), seller_id: None, buyer_id: None, filter: "all", limit: 1 })
            .await?
            .pop()
            .ok_or_else(|| crate::DbError::NotFound("Order not found.".into()))
    }

    pub async fn orders_for_buyer(&self, buyer_id: Uuid) -> DbResult<Vec<OrderView>> {
        self.order_views(Scope { order_id: None, seller_id: None, buyer_id: Some(buyer_id), filter: "all", limit: 100 }).await
    }

    /// A buyer's orders with one shop, for the conversation sidebar.
    pub async fn orders_between(&self, seller_id: Uuid, buyer_id: Uuid) -> DbResult<Vec<OrderView>> {
        self.order_views(Scope { order_id: None, seller_id: Some(seller_id), buyer_id: Some(buyer_id), filter: "all", limit: 50 })
            .await
    }

    pub async fn orders_for_seller(&self, seller_id: Uuid, filter: OrderFilter) -> DbResult<Vec<OrderView>> {
        self.order_views(Scope { order_id: None, seller_id: Some(seller_id), buyer_id: None, filter: filter.as_str(), limit: 200 })
            .await
    }

    pub async fn report_payment(&self, order_id: Uuid, buyer_id: Uuid, report: PaymentReport<'_>) -> DbResult<OrderView> {
        sqlx::query_scalar!(
            r#"select (app.report_payment($1, $2, $3, $4, $5, $6, $7)).id as "id!""#,
            order_id,
            buyer_id,
            report.upi_reference,
            report.ship_name,
            report.ship_phone,
            report.ship_address,
            report.ship_pincode
        )
        .fetch_one(&self.pool)
        .await?;
        self.order_view(order_id).await
    }

    pub async fn confirm_payment(&self, order_id: Uuid, staff_id: Uuid) -> DbResult<OrderView> {
        sqlx::query_scalar!(r#"select (app.confirm_payment($1, $2)).id as "id!""#, order_id, staff_id)
            .fetch_one(&self.pool)
            .await?;
        self.order_view(order_id).await
    }

    pub async fn cancel_order(&self, order_id: Uuid, staff_id: Uuid, reason: &str) -> DbResult<OrderView> {
        sqlx::query_scalar!(r#"select (app.cancel_order($1, $2, $3)).id as "id!""#, order_id, staff_id, reason)
            .fetch_one(&self.pool)
            .await?;
        self.order_view(order_id).await
    }

    /// Remember the checkout card's Nexconn message so later status changes can update it in place.
    pub async fn set_order_card_message(&self, order_id: Uuid, message_id: &str) -> DbResult<()> {
        sqlx::query!(
            r#"select app.log('checkout.card', seller_id, live_id, item_id, buyer_id, claim_id, id,
                              jsonb_build_object('message_id', $2::text))
               from orders where id = $1"#,
            order_id,
            message_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn order_card_message(&self, order_id: Uuid) -> DbResult<Option<String>> {
        Ok(sqlx::query_scalar!(
            r#"select data->>'message_id' as "id" from events where kind = 'checkout.card' and order_id = $1
               order by id desc limit 1"#,
            order_id
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    pub async fn order_for_claim(&self, claim_id: Uuid) -> DbResult<Option<Uuid>> {
        Ok(sqlx::query_scalar!("select id from orders where claim_id = $1", claim_id).fetch_optional(&self.pool).await?)
    }
}
