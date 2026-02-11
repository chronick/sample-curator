//! Result types matching Python Pydantic models.
//!
//! These structs are designed to serialize to JSON that matches
//! the Python Pydantic models in sample_analysis.models.

use serde::{Deserialize, Serialize};

/// BPM detection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BPMResult {
    /// Detected BPM (beats per minute)
    pub bpm: f64,
    /// Confidence in the BPM detection (0.0 to 1.0)
    pub confidence: f64,
    /// Beat positions as frame indices (if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beat_frames: Option<Vec<usize>>,
    /// Beat positions as times in seconds (if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beat_times: Option<Vec<f64>>,
}

/// Musical key detection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyResult {
    /// Detected key (e.g., "C", "F#", "Bb")
    pub key: String,
    /// Mode ("major" or "minor")
    pub mode: String,
    /// Confidence in the key detection (0.0 to 1.0)
    pub confidence: f64,
    /// Alternate keys with confidences (key, mode, confidence)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternate_keys: Option<Vec<(String, String, f64)>>,
    /// 12-element chroma profile (if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chroma_profile: Option<Vec<f64>>,
}

/// Spectral features result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectralResult {
    /// Spectral centroid in Hz (center of mass of spectrum)
    pub spectral_centroid: f64,
    /// Spectral rolloff in Hz (frequency where 85% of energy is below)
    pub spectral_rolloff: f64,
    /// Spectral bandwidth in Hz
    pub spectral_bandwidth: f64,
    /// Spectral flatness (0=tonal, 1=noisy)
    pub spectral_flatness: f64,
    /// Zero crossing rate
    pub zero_crossing_rate: f64,
    /// Mel-frequency cepstral coefficients (13 by default)
    pub mfccs: Vec<f64>,
}

/// Audio quality metrics result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityResult {
    /// RMS level in dB
    pub rms_db: f64,
    /// Peak level in dB
    pub peak_db: f64,
    /// Crest factor in dB (peak / RMS)
    pub crest_factor: f64,
    /// Dynamic range in dB
    pub dynamic_range: f64,
    /// Whether clipping was detected
    pub clipping_detected: bool,
    /// Ratio of clipped samples (0.0 to 1.0)
    pub clipping_ratio: f64,
    /// DC offset
    pub dc_offset: f64,
}

/// Transient/onset detection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransientResult {
    /// Onset frame indices
    pub onset_frames: Vec<usize>,
    /// Onset times in seconds
    pub onset_times: Vec<f64>,
    /// Onset strengths (if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onset_strengths: Option<Vec<f64>>,
    /// Number of detected onsets
    pub num_onsets: usize,
}

/// Loop quality analysis result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopResult {
    /// Whether the audio is suitable for looping
    pub is_loopable: bool,
    /// Suggested loop start sample
    pub loop_start_sample: usize,
    /// Suggested loop end sample
    pub loop_end_sample: usize,
    /// Overall loop quality score (0.0 to 1.0)
    pub quality_score: f64,
    /// Spectral continuity at loop point (0.0 to 1.0)
    pub spectral_continuity: f64,
    /// Amplitude continuity at loop point (0.0 to 1.0)
    pub amplitude_continuity: f64,
    /// Whether loop points are zero-crossing aligned
    pub zero_crossing_aligned: bool,
}

/// Spectrogram result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrogramResult {
    /// 2D spectrogram data [height x width], normalized to [0, 1]
    pub spectrogram: Vec<Vec<f64>>,
    /// Audio duration in seconds
    pub duration: f64,
    /// Spectrogram width (time bins)
    pub width: usize,
    /// Spectrogram height (frequency bins)
    pub height: usize,
    /// Sample rate used
    pub sample_rate: u32,
}

/// Audio file information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioInfo {
    /// File path
    pub path: String,
    /// Duration in seconds
    pub duration_sec: f64,
    /// Sample rate in Hz
    pub sample_rate: u32,
    /// Number of channels
    pub channels: u16,
    /// Bit depth (bits per sample)
    pub bit_depth: u16,
    /// Audio format (e.g., "wav", "mp3", "flac")
    pub format: String,
}

/// Audio chunk from segmentation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioChunk {
    /// Start sample index
    pub start_sample: usize,
    /// End sample index
    pub end_sample: usize,
    /// Start time in seconds
    pub start_time: f64,
    /// End time in seconds
    pub end_time: f64,
    /// Duration in seconds
    pub duration: f64,
    /// Output path (if exported)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
