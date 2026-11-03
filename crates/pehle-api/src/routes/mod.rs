pub mod approvals;
pub mod browse;
pub mod demo;
pub mod media;
pub mod notify;
pub mod payments;
pub mod rooms;
pub mod session;
pub mod share;
pub mod studio;
pub mod webhooks;

use std::time::Duration;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router, middleware};
use serde_json::json;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::compression::CompressionLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::sensitive_headers::SetSensitiveRequestHeadersLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::csrf_guard;
use crate::state::AppState;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Pehle API",
        version = "1",
        description = "Fair drops for Indian live sellers and creators. Mutating requests need the header `X-Pehle: 1`."
    ),
    tags(
        (name = "session", description = "Sign-in and chat tokens"),
        (name = "room", description = "Buyer side: the live room, claims and checkout"),
        (name = "studio", description = "Seller studio: catalogue, lives and orders"),
        (name = "public", description = "Open data")
    )
)]
struct ApiDoc;

fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(session::get_session))
        .routes(routes!(session::join_as_buyer))
        .routes(routes!(session::logout))
        .routes(routes!(session::chat_token))
        .routes(routes!(session::dev_sign_in))
        .routes(routes!(session::phone_sign_in))
        .routes(routes!(notify::key))
        .routes(routes!(notify::subscribe, notify::unsubscribe))
        .routes(routes!(demo::join))
        .routes(routes!(demo::seller))
        .routes(routes!(demo::race))
        .routes(routes!(browse::browse))
        .routes(routes!(browse::shop_page))
        .routes(routes!(browse::following))
        .routes(routes!(studio::create_shop))
        .routes(routes!(studio::get_shop, studio::update_shop))
        .routes(routes!(studio::shop_stats))
        .routes(routes!(studio::list_items, studio::create_item))
        .routes(routes!(studio::update_item, studio::archive_item))
        .routes(routes!(studio::list_lives, studio::create_live))
        .routes(routes!(studio::update_live))
        .routes(routes!(studio::lineup))
        .routes(routes!(studio::report))
        .routes(routes!(studio::conversations))
        .routes(routes!(studio::buyer_orders))
        .routes(routes!(studio::start_live))
        .routes(routes!(studio::end_live))
        .routes(routes!(studio::drop_item))
        .routes(routes!(studio::close_item))
        .routes(routes!(studio::live_console))
        .routes(routes!(studio::shop_orders))
        .routes(routes!(studio::confirm_payment))
        .routes(routes!(studio::cancel_order))
        .routes(routes!(studio::block_buyer))
        .routes(routes!(studio::unblock_buyer))
        .routes(routes!(approvals::pending))
        .routes(routes!(approvals::decide))
        .routes(routes!(media::upload))
        .routes(routes!(rooms::get_room))
        .routes(routes!(rooms::claim))
        .routes(routes!(rooms::fairness))
        .routes(routes!(rooms::follow, rooms::unfollow))
        .routes(routes!(rooms::remind))
        .routes(routes!(rooms::my_conversations))
        .routes(routes!(rooms::open_conversation))
        .routes(routes!(rooms::orders_with_shop))
        .routes(routes!(rooms::release))
        .routes(routes!(rooms::youtube_code))
        .routes(routes!(rooms::get_order))
        .routes(routes!(rooms::my_orders))
        .routes(routes!(rooms::report_payment))
        .routes(routes!(rooms::public_stats))
        .routes(routes!(rooms::public_shop))
        .routes(routes!(payments::get_setup, payments::connect, payments::disconnect))
        .routes(routes!(payments::pay))
        .routes(routes!(payments::check))
}

/// The OpenAPI document, written to `packages/api-client/openapi.json` by `pehle-api openapi`.
pub fn openapi() -> utoipa::openapi::OpenApi {
    api_router().split_for_parts().1
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let database = state.db.ping().await.is_ok();
    let backlog = state.db.outbox_backlog().await.unwrap_or(-1);
    let status = if database { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (status, Json(json!({ "database": database, "chat": state.nexconn.is_live(), "outboxBacklog": backlog })))
}

pub fn router(state: AppState) -> Router {
    let (api, _) = api_router().split_for_parts();
    let request_id = HeaderName::from_static("x-request-id");

    let mut app = Router::new()
        .merge(api)
        .route("/api/v1/auth/google/start", get(session::google_start))
        .route("/api/v1/auth/google/callback", get(session::google_callback))
        .route("/webhooks/nexconn", post(webhooks::nexconn))
        .route("/webhooks/razorpay/{seller_id}", post(payments::webhook))
        .route("/share/l/{slug}", get(share::drop_preview))
        .route("/share/s/{handle}", get(share::shop_preview))
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz));

    // In development the API serves uploads itself; in production Caddy serves /media directly.
    if state.config.dev_login {
        app = app.nest_service("/media", tower_http::services::ServeDir::new(&state.config.media_dir));
    }

    app.layer(DefaultBodyLimit::max(media::MAX_UPLOAD_BYTES + 64 * 1024))
        .layer(middleware::from_fn(csrf_guard))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-store"),
        ))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(30)))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(request_id.clone()))
        .layer(SetRequestIdLayer::new(request_id, MakeRequestUuid))
        .layer(SetSensitiveRequestHeadersLayer::new([axum::http::header::COOKIE, axum::http::header::AUTHORIZATION]))
        .with_state(state)
}
