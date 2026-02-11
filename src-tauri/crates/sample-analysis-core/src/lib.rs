//! High-performance audio analysis library for sample libraries.
//!
//! This crate provides audio analysis capabilities including:
//! - Audio file loading (WAV, MP3, FLAC, OGG)
//! - BPM and beat detection
//! - Key detection
//! - Quality metrics (RMS, peak, clipping)
//! - Spectral features (centroid, rolloff, MFCCs)
//! - Spectrogram generation
//! - Transient/onset detection
//! - Loop quality analysis
//! - Audio segmentation

pub mod audio;
pub mod error;
pub mod fft;
pub mod mel;
pub mod types;

pub mod analyzers;
pub mod segmentation;

pub use audio::{get_audio_info, load_audio};
pub use error::{AnalysisError, Result};
pub use types::*;

/// Re-export all analyzers for convenience
pub use analyzers::{
    bpm::analyze_bpm,
    key::analyze_key,
    loop_analysis::analyze_loop,
    quality::analyze_quality,
    spectral::analyze_spectral,
    spectrogram::analyze_spectrogram,
    transient::analyze_transients,
};

/// Re-export segmentation functions
pub use segmentation::{segment_by_beats, segment_by_changepoint, segment_by_silence};
