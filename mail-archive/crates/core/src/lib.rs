pub mod mbox;
pub mod model;
pub mod parse;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use parse::ParseError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Parse(#[from] ParseError),
}

pub type Result<T> = std::result::Result<T, Error>;
