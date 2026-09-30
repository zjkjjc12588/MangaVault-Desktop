use thiserror::Error;

#[derive(Debug, Error)]
pub enum MangaVaultError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("image error: {0}")]
    Image(#[from] image::ImageError),
    #[error("pdf error: {0}")]
    Pdf(#[from] lopdf::Error),
    #[error("invalid path")]
    InvalidPath,
    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),
    #[error("external extractor unavailable for {0}")]
    ExtractorUnavailable(String),
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, MangaVaultError>;

impl serde::Serialize for MangaVaultError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
