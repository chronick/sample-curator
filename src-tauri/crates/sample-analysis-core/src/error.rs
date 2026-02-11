//! Error types for sample-analysis-core.

use thiserror::Error;

/// Main error type for analysis operations.
#[derive(Error, Debug)]
pub enum AnalysisError {
    #[error("Failed to open audio file: {0}")]
    FileOpen(String),

    #[error("Failed to decode audio: {0}")]
    Decode(String),

    #[error("Unsupported audio format: {0}")]
    UnsupportedFormat(String),

    #[error("Audio file is empty or too short")]
    AudioTooShort,

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("FFT error: {0}")]
    Fft(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result type alias for analysis operations.
pub type Result<T> = std::result::Result<T, AnalysisError>;
