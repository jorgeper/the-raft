pub mod events;
pub mod import;
pub mod index;
pub mod library;
pub mod mbox;
pub mod meta;
pub mod model;
pub mod parse;
pub mod paths;
pub mod query;
pub mod rebuild;
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
    #[error("search index error: {0}")]
    Index(String),
    #[error("library is in use by another process")]
    LibraryInUse,
    #[error("import source error: {0}")]
    Source(String),
    #[error("cancelled")]
    Cancelled,
    #[error("the import source changed since it was scanned; scan it again")]
    SourceChanged,
    #[error("the scan is stale (the library changed since it was scanned); please rescan")]
    StaleScan,
    #[error("library needs a rebuild before importing")]
    NeedsRebuild,
    #[error(
        "import failed ({cause}) and could not be rolled back ({rollback}); \
         reopen the library to finish the rollback"
    )]
    RollbackFailed { cause: String, rollback: String },
}

impl From<tantivy::TantivyError> for Error {
    fn from(e: tantivy::TantivyError) -> Self {
        Error::Index(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
