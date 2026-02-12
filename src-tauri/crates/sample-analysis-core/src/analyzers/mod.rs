//! Audio analyzers for various features.
//!
//! Each analyzer provides a specific analysis capability:
//! - `bpm`: Tempo and beat detection
//! - `key`: Musical key detection
//! - `quality`: Audio quality metrics
//! - `spectral`: Spectral features
//! - `spectrogram`: Mel spectrogram generation
//! - `transient`: Onset/transient detection
//! - `loop_analysis`: Loop quality assessment

pub mod bpm;
pub mod key;
pub mod loop_analysis;
pub mod quality;
pub mod spectral;
pub mod spectrogram;
pub mod transient;
