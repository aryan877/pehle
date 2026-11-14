//! Product photo uploads. Files are stored under their SHA-256, so the same photo is stored once
//! and its URL never changes; Caddy serves them from `/media` with a long cache lifetime.

use axum::Json;
use axum::extract::{Multipart, State};
use serde::Serialize;
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

use crate::auth::SignedInStaff;
use crate::error::{ApiError, ApiResult, ErrorBody};
use crate::state::AppState;

pub const MAX_UPLOAD_BYTES: usize = 6 * 1024 * 1024;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Uploaded {
    /// Store this on the item, for example `media/3f9a….webp`.
    pub path: String,
    pub url: String,
}

/// Recognise the image by its first bytes rather than trusting the file name or declared type.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("jpg"),
        [0x89, b'P', b'N', b'G', ..] => Some("png"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("webp"),
        _ => None,
    }
}

#[utoipa::path(post, path = "/api/v1/media", tag = "studio",
    request_body(content_type = "multipart/form-data", description = "One `file` field: a JPEG, PNG or WebP up to 6 MB."),
    responses((status = 200, body = Uploaded), (status = 422, body = ErrorBody)))]
pub async fn upload(State(state): State<AppState>, SignedInStaff(_staff): SignedInStaff, mut multipart: Multipart) -> ApiResult<Json<Uploaded>> {
    while let Some(field) = multipart.next_field().await.map_err(|e| ApiError::BadRequest(e.to_string()))? {
        if field.name() != Some("file") {
            continue;
        }
        let bytes = field.bytes().await.map_err(|_| ApiError::Unprocessable("The photo is larger than 6 MB.".into()))?;
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err(ApiError::Unprocessable("The photo is larger than 6 MB.".into()));
        }
        let stored = store(&state, &bytes).await?;
        return Ok(Json(Uploaded { url: state.media_url(&stored), path: stored }));
    }
    Err(ApiError::Unprocessable("Attach the photo in a field named file.".into()))
}

/// Store an image under its SHA-256 and return its path (`media/<hash>.<ext>`).
pub async fn store(state: &AppState, bytes: &[u8]) -> ApiResult<String> {
    let extension = sniff(bytes).ok_or_else(|| ApiError::Unprocessable("Upload a JPEG, PNG or WebP photo.".into()))?;
    let name = format!("{}.{extension}", hex_digest(bytes));
    let path = state.config.media_dir.join(&name);
    if tokio::fs::metadata(&path).await.is_err() {
        tokio::fs::create_dir_all(&state.config.media_dir).await.map_err(ApiError::internal)?;
        let temporary = state.config.media_dir.join(format!(".{name}.part"));
        tokio::fs::write(&temporary, bytes).await.map_err(ApiError::internal)?;
        tokio::fs::rename(&temporary, &path).await.map_err(ApiError::internal)?;
    }
    Ok(format!("media/{name}"))
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::sniff;

    #[test]
    fn recognises_images_by_content() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff(b"\x89PNG\r\n"), Some("png"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"<svg onload=alert(1)>"), None);
    }
}
