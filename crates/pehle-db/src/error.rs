/// Database errors, with the `app.*` functions' SQLSTATE `PHxxx` codes mapped to meaning.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Sqlx(sqlx::Error),
    #[error("{0}")]
    Other(String),
}

pub type DbResult<T> = Result<T, DbError>;

impl From<sqlx::Error> for DbError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db) = &error {
            let message = db.message().to_string();
            match db.code().as_deref() {
                Some("PH403") => return Self::Forbidden(message),
                Some("PH404") => return Self::NotFound(message),
                Some("PH409") => return Self::Conflict(message),
                Some("PH422") => return Self::Invalid(message),
                // Constraint failures from direct inserts and updates.
                Some("23505") => return Self::Conflict(constraint_message(db.constraint(), "already exists")),
                Some("23514") | Some("22001") | Some("22P02") => {
                    return Self::Invalid(constraint_message(db.constraint(), "is not valid"));
                }
                Some("23503") => return Self::NotFound("A referenced record does not exist.".into()),
                _ => {}
            }
        }
        if matches!(error, sqlx::Error::RowNotFound) {
            return Self::NotFound("Not found.".into());
        }
        Self::Sqlx(error)
    }
}

fn constraint_message(constraint: Option<&str>, suffix: &str) -> String {
    match constraint {
        Some(name) => {
            let field = name.split('_').skip(1).take_while(|p| *p != "check" && *p != "key").collect::<Vec<_>>();
            if field.is_empty() { format!("This value {suffix}.") } else { format!("The {} {suffix}.", field.join(" ")) }
        }
        None => format!("This value {suffix}."),
    }
}

impl From<sqlx::migrate::MigrateError> for DbError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Other(error.to_string())
    }
}
