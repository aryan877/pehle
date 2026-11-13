//! Reads a seller's public YouTube live chat with an API key and turns "mine" comments into claims.
//!
//! - `videos.list?part=liveStreamingDetails` gives the stream's `activeLiveChatId` (1 quota unit).
//! - `liveChatMessages.list` returns new messages since a page token (5 units per call). Pehle waits
//!   at least `pollingIntervalMillis` and never less than [`MIN_POLL`] between calls to stay inside
//!   the default 10,000 units a day.
//! - The first page is the existing backlog, which is skipped so old comments never claim.
//! - "pehle 1234" links the commenter's YouTube channel to the Pehle buyer who was shown that code.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use pehle_db::claims::ClaimRequest;
use pehle_db::youtube::YoutubeTarget;
use pehle_db::{ClaimOutcome, ClaimSource};
use serde::Deserialize;
use tokio::sync::watch;
use uuid::Uuid;

use crate::intent::{Intent, classify};
use crate::state::AppState;

const API: &str = "https://www.googleapis.com/youtube/v3";
pub const MIN_POLL: Duration = Duration::from_secs(5);

/// The video ID in a YouTube watch, live, shorts or youtu.be link.
pub fn video_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.trim_start_matches("www.").trim_start_matches("m.");
    let id = match host {
        "youtu.be" => parsed.path().trim_start_matches('/').split('/').next().map(str::to_string),
        "youtube.com" | "music.youtube.com" => {
            if parsed.path() == "/watch" {
                parsed.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.into_owned())
            } else {
                let mut parts = parsed.path().trim_start_matches('/').split('/');
                match parts.next() {
                    Some("live" | "shorts" | "embed") => parts.next().map(str::to_string),
                    _ => None,
                }
            }
        }
        _ => None,
    }?;
    (6..=20).contains(&id.len()).then_some(id).filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
}

#[derive(Deserialize)]
struct VideoList {
    #[serde(default)]
    items: Vec<Video>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Video {
    live_streaming_details: Option<LiveDetails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveDetails {
    active_live_chat_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagePage {
    next_page_token: Option<String>,
    #[serde(default)]
    polling_interval_millis: u64,
    offline_at: Option<String>,
    #[serde(default)]
    items: Vec<ChatItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatItem {
    id: String,
    snippet: Snippet,
    author_details: Author,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snippet {
    #[serde(rename = "type")]
    kind: String,
    published_at: DateTime<Utc>,
    #[serde(default)]
    display_message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Author {
    channel_id: String,
    display_name: String,
    #[serde(default)]
    is_chat_owner: bool,
}

async fn get<T: for<'de> Deserialize<'de>>(state: &AppState, key: &str, path: &str, query: &[(&str, &str)]) -> Result<T> {
    let response = state.http.get(format!("{API}{path}")).query(query).query(&[("key", key)]).send().await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        bail!("youtube {path} failed ({status}): {}", text.chars().take(300).collect::<String>());
    }
    serde_json::from_str(&text).with_context(|| format!("youtube {path}: unexpected response"))
}

async fn active_chat_id(state: &AppState, key: &str, video_id: &str) -> Result<Option<String>> {
    let videos: VideoList = get(state, key, "/videos", &[("part", "liveStreamingDetails"), ("id", video_id)]).await?;
    Ok(videos.items.into_iter().next().and_then(|v| v.live_streaming_details).and_then(|d| d.active_live_chat_id))
}

/// Read every running live's YouTube chat on its own schedule.
pub async fn run(state: AppState, mut shutdown: watch::Receiver<bool>) {
    let Some(key) = state.config.youtube_api_key.clone() else {
        tracing::info!("YOUTUBE_API_KEY is not set: YouTube chat claims are off");
        return;
    };
    let mut next_poll: HashMap<Uuid, Instant> = HashMap::new();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tick.tick() => {}
        }
        let targets = match state.db.youtube_targets().await {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!(%error, "youtube target query failed");
                continue;
            }
        };
        next_poll.retain(|id, _| targets.iter().any(|t| t.live_id == *id));
        for target in targets {
            if next_poll.get(&target.live_id).is_some_and(|at| Instant::now() < *at) {
                continue;
            }
            let wait = match poll(&state, &key, &target).await {
                Ok(wait) => wait,
                Err(error) => {
                    tracing::warn!(live = %target.live_id, error = %format!("{error:#}"), "youtube chat poll failed");
                    Duration::from_secs(30)
                }
            };
            next_poll.insert(target.live_id, Instant::now() + wait);
        }
    }
}

async fn poll(state: &AppState, key: &str, target: &YoutubeTarget) -> Result<Duration> {
    let Some(chat_id) = target.live_chat_id.clone() else {
        // Find the chat; until the stream is actually live there is none.
        return match active_chat_id(state, key, &target.video_id).await? {
            Some(chat_id) => {
                // Read the backlog once and keep only its page token, so old comments never claim.
                let page: MessagePage =
                    get(state, key, "/liveChat/messages", &[("liveChatId", &chat_id), ("part", "id"), ("maxResults", "200")]).await?;
                state.db.set_youtube_chat(target.live_id, Some(&chat_id), page.next_page_token.as_deref()).await?;
                tracing::info!(live = %target.live_id, "connected to YouTube live chat");
                Ok(MIN_POLL)
            }
            None => Ok(Duration::from_secs(30)),
        };
    };
    let mut query = vec![("liveChatId", chat_id.as_str()), ("part", "snippet,authorDetails"), ("maxResults", "2000")];
    if let Some(token) = target.page_token.as_deref() {
        query.push(("pageToken", token));
    }
    let page: MessagePage = get(state, key, "/liveChat/messages", &query).await?;
    if page.offline_at.is_some() {
        state.db.set_youtube_chat(target.live_id, None, None).await?;
        return Ok(Duration::from_secs(60));
    }
    let mut items = page.items;
    items.sort_by_key(|i| i.snippet.published_at);
    for item in items {
        if item.snippet.kind != "textMessageEvent" || item.author_details.is_chat_owner {
            continue;
        }
        if let Err(error) = handle(state, target.live_id, &item).await {
            tracing::warn!(error = %format!("{error:#}"), "youtube message handling failed");
        }
    }
    state.db.set_youtube_chat(target.live_id, Some(&chat_id), page.next_page_token.as_deref()).await?;
    Ok(Duration::from_millis(page.polling_interval_millis).max(MIN_POLL))
}

/// "pehle 1234" links accounts; anything the claim matcher accepts becomes a claim.
fn link_code(text: &str) -> Option<&str> {
    let mut words = text.split_whitespace();
    let first = words.next()?;
    if !first.eq_ignore_ascii_case("pehle") {
        return None;
    }
    let code = words.next()?;
    (code.len() == 4 && code.chars().all(|c| c.is_ascii_digit()) && words.next().is_none()).then_some(code)
}

async fn handle(state: &AppState, live_id: Uuid, item: &ChatItem) -> Result<()> {
    let text = item.snippet.display_message.trim();
    let author = &item.author_details;
    if let Some(code) = link_code(text) {
        let linked = state.db.link_youtube(live_id, code, &author.channel_id, &author.display_name).await?;
        tracing::info!(%live_id, linked = linked.is_some(), "youtube link code");
        return Ok(());
    }
    let codes: Vec<String> = state.db.open_items(live_id).await?.into_iter().map(|i| i.code).collect();
    let Intent::Claim { code } = classify(text, &codes) else {
        return Ok(());
    };
    let buyer_id = state.db.youtube_buyer(&author.channel_id, &author.display_name).await?;
    let message_id = format!("yt:{}", item.id);
    let result = state
        .db
        .claim(ClaimRequest {
            live_id,
            buyer_id,
            item_code: code.as_deref(),
            source: ClaimSource::Youtube,
            said: text,
            message_id: Some(&message_id),
            received_at: Some(item.snippet.published_at),
        })
        .await?;
    if !matches!(result.outcome, ClaimOutcome::Replay) {
        tracing::info!(%live_id, who = %author.display_name, outcome = ?result.outcome, position = ?result.position, "youtube claim");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_video_ids() {
        assert_eq!(video_id("https://www.youtube.com/watch?v=abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(video_id("https://youtube.com/live/abcDEF12345?si=x").as_deref(), Some("abcDEF12345"));
        assert_eq!(video_id("https://youtu.be/abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(video_id("https://m.youtube.com/shorts/abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(video_id("https://www.instagram.com/meera/live"), None);
        assert_eq!(video_id("https://youtube.com/@meerasarees"), None);
    }

    #[test]
    fn reads_link_codes() {
        assert_eq!(link_code("pehle 4821"), Some("4821"));
        assert_eq!(link_code("PEHLE 4821"), Some("4821"));
        assert_eq!(link_code("pehle 48211"), None);
        assert_eq!(link_code("pehle 4821 mine"), None);
        assert_eq!(link_code("mine"), None);
    }
}
