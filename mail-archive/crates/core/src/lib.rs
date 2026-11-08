pub mod events;
pub mod mbox;
pub mod meta;
pub mod model;
pub mod parse;
pub mod paths;
pub mod store;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use parse::ParseError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Parse(#[from] ParseError),
    #[error("store error: {0}")]
    Store(String),
    #[error("event log error: {0}")]
    Events(String),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("metadata error: {0}")]
    Meta(String),
}

pub type Result<T> = std::result::Result<T, Error>;
