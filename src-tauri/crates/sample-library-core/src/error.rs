//! Error types for sample-library-core.

use thiserror::Error;

/// Library error type.
#[derive(Error, Debug)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Analysis error: {0}")]
    Analysis(#[from] sample_analysis_core::AnalysisError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Sample not found: {0}")]
    SampleNotFound(i64),

    #[error("Project not found: {0}")]
    ProjectNotFound(i64),

    #[error("Job not found: {0}")]
    JobNotFound(i64),

    #[error("Embedding not found for sample: {0}")]
    EmbeddingNotFound(i64),

    #[error("Index error: {0}")]
    Index(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Duplicate entry: {0}")]
    Duplicate(String),
}

/// Result type alias.
pub type Result<T> = std::result::Result<T, Error>;
