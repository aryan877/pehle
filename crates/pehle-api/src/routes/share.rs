//! Link previews. When a seller shares a drop or shop link on WhatsApp, Instagram or X, the
//! preview crawler gets a small page with Open Graph tags: the photo, the shop and when the drop
//! starts. Caddy routes only known crawler user agents here; people get the app.

use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{FixedOffset, Utc};
use pehle_db::LiveStatus;

use crate::money::format_inr;
use crate::state::AppState;

struct Preview {
    title: String,
    description: String,
    image: Option<String>,
    url: String,
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn page(preview: &Preview) -> Response {
    let title = escape(&preview.title);
    let description = escape(&preview.description);
    let url = escape(&preview.url);
    let image = preview
        .image
        .as_deref()
        .map(|i| format!(r#"<meta property="og:image" content="{0}"><meta name="twitter:image" content="{0}">"#, escape(i)))
        .unwrap_or_default();
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:site_name" content="Pehle"><meta property="og:type" content="website">
<meta property="og:title" content="{title}"><meta property="og:description" content="{description}">
<meta property="og:url" content="{url}">{image}
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={url}"></head>
<body><a href="{url}">{title}</a></body></html>"#
    );
    let mut response = (StatusCode::OK, html).into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=300"));
    response
}

/// "Today 8:00 PM", "Tomorrow 9:00 PM" or "Sun 23 Nov, 8:00 PM" in India time.
fn when(at: chrono::DateTime<Utc>) -> String {
    let ist = FixedOffset::east_opt(5 * 3600 + 1800).expect("IST offset");
    let local = at.with_timezone(&ist);
    let today = Utc::now().with_timezone(&ist).date_naive();
    let time = local.format("%-I:%M %p");
    match (local.date_naive() - today).num_days() {
        0 => format!("Today {time}"),
        1 => format!("Tomorrow {time}"),
        _ => format!("{}, {time}", local.format("%a %-d %b")),
    }
}

pub async fn drop_preview(State(state): State<AppState>, Path(slug): Path<String>) -> Response {
    let Ok(live) = state.db.live_by_slug(&slug).await else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    let (Ok(shop), Ok(lineup)) = (state.db.public_shop_by_id(live.seller_id).await, state.db.lineup(live.id).await) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Try again").into_response();
    };
    let cheapest = lineup.iter().map(|i| i.price_paise).min();
    let pieces = match lineup.len() {
        1 => "1 piece".to_string(),
        n => format!("{n} pieces"),
    };
    let summary = match cheapest {
        None => String::new(),
        Some(0) => format!(" {pieces}, free to claim."),
        Some(p) => format!(" {pieces} from {}.", format_inr(p)),
    };
    let status = match (live.status, live.scheduled_for) {
        (LiveStatus::Live, _) => "Live now. First to claim gets it.".to_string(),
        (LiveStatus::Ended, _) => "This drop has ended. Join the shop's club for the next one.".to_string(),
        (_, Some(at)) => format!("Starts {}. Tap Remind me.", when(at)),
        _ => "Coming soon. First to claim gets it.".to_string(),
    };
    let image = live
        .youtube_video_id
        .as_deref()
        .filter(|_| lineup.iter().all(|i| i.image_path.is_none()))
        .map(|id| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"))
        .or_else(|| lineup.iter().find_map(|i| i.image_path.as_deref()).map(|p| state.media_url(p)))
        .or_else(|| shop.avatar_path.as_deref().map(|p| state.media_url(p)));
    page(&Preview {
        title: format!("{}: {}", shop.display_name, live.title),
        description: format!("{status}{summary}"),
        image,
        url: state.room_url(&live.slug),
    })
}

pub async fn shop_preview(State(state): State<AppState>, Path(handle): Path<String>) -> Response {
    let Ok(shop) = state.db.public_shop(&handle).await else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    let base = state.config.public_url.as_str().trim_end_matches('/');
    page(&Preview {
        title: format!("{} on Pehle", shop.display_name),
        description: shop.tagline.clone().unwrap_or_else(|| "Fair live drops. First to claim gets it.".into()),
        image: shop.cover_path.as_deref().or(shop.avatar_path.as_deref()).map(|p| state.media_url(p)),
        url: format!("{base}/s/{}", shop.handle),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_everything_a_seller_can_type() {
        assert_eq!(escape(r#"<b>"Meera's" & co</b>"#), "&lt;b&gt;&quot;Meera&#39;s&quot; &amp; co&lt;/b&gt;");
    }
}
