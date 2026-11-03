use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use pehle_db::DbError;
use serde::Serialize;
use utoipa::ToSchema;

/// Every error response: `{ "error": { "code": "...", "message": "..." } }`. Messages are written for
/// the person using the app.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Sign in to continue.")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error("Chat is unavailable right now. Try again in a moment.")]
    Upstream(#[source] pehle_nexconn::Error),
    #[error("Something went wrong on our side.")]
    Internal(#[source] anyhow::Error),
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            Self::Unprocessable(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid"),
            Self::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream"),
            Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }

    pub fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self::Internal(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        match &self {
            Self::Internal(e) => tracing::error!(error = ?e, "internal error"),
            Self::Upstream(e) => tracing::warn!(error = %e, "nexconn error"),
            _ => {}
        }
        (status, Json(ErrorBody { error: ErrorDetail { code, message: self.to_string() } })).into_response()
    }
}

impl From<DbError> for ApiError {
    fn from(error: DbError) -> Self {
        match error {
            DbError::Forbidden(m) => Self::Forbidden(m),
            DbError::NotFound(m) => Self::NotFound(m),
            DbError::Conflict(m) => Self::Conflict(m),
            DbError::Invalid(m) => Self::Unprocessable(m),
            DbError::Sqlx(e) => Self::Internal(e.into()),
            DbError::Other(m) => Self::Internal(anyhow::anyhow!(m)),
        }
    }
}

impl From<pehle_nexconn::Error> for ApiError {
    fn from(error: pehle_nexconn::Error) -> Self {
        Self::Upstream(error)
    }
}
