//! Native audio analysis using sample-analysis-core.
//!
//! Provides Tauri commands for fast, native audio analysis without
//! going through the Python sidecar.

use sample_analysis_core::{
    analyzers::{
        quality::{analyze_quality, QualityConfig},
        spectrogram::{analyze_spectrogram, generate_waveform, SpectrogramConfig},
    },
    audio::{get_audio_info, load_audio},
};
use serde::Serialize;

/// Spectrogram result for frontend.
#[derive(Serialize)]
pub struct SpectrogramResponse {
    /// 2D spectrogram data [height x width], normalized to [0, 1]
    pub spectrogram: Vec<Vec<f64>>,
    /// Audio duration in seconds
    pub duration: f64,
    /// Spectrogram width (time bins)
    pub width: usize,
    /// Spectrogram height (frequency bins)
    pub height: usize,
}

/// Waveform result for frontend.
#[derive(Serialize)]
pub struct WaveformResponse {
    /// Peak values at evenly spaced intervals
    pub data: Vec<f64>,
    /// Audio duration in seconds
    pub duration: f64,
}

/// Quality metrics result for frontend.
#[derive(Serialize)]
pub struct QualityResponse {
    pub rms_db: f64,
    pub peak_db: f64,
    pub crest_factor: f64,
    pub dynamic_range: f64,
    pub clipping_detected: bool,
    pub clipping_ratio: f64,
    pub dc_offset: f64,
}

/// Audio info result for frontend.
#[derive(Serialize)]
pub struct AudioInfoResponse {
    pub path: String,
    pub duration_sec: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: u16,
    pub format: String,
}

/// Generate spectrogram for visualization (native, no sidecar).
#[tauri::command]
pub fn native_spectrogram(
    path: String,
    width: Option<usize>,
    height: Option<usize>,
) -> Result<SpectrogramResponse, String> {
    let width = width.unwrap_or(800);
    let height = height.unwrap_or(128);

    let (samples, sr) = load_audio(&path, None, true).map_err(|e| e.to_string())?;

    let config = SpectrogramConfig {
        width,
        height,
        ..Default::default()
    };

    let result = analyze_spectrogram(&samples, sr, &config).map_err(|e| e.to_string())?;

    Ok(SpectrogramResponse {
        spectrogram: result.spectrogram,
        duration: result.duration,
        width: result.width,
        height: result.height,
    })
}

/// Generate waveform for visualization (native, no sidecar).
#[tauri::command]
pub fn native_waveform(path: String, width: Option<usize>) -> Result<WaveformResponse, String> {
    let width = width.unwrap_or(800);

    let (samples, sr) = load_audio(&path, None, true).map_err(|e| e.to_string())?;

    let waveform = generate_waveform(&samples, width);
    let duration = samples.len() as f64 / sr as f64;

    Ok(WaveformResponse {
        data: waveform.into_iter().map(|x| x as f64).collect(),
        duration,
    })
}

/// Analyze audio quality metrics (native, no sidecar).
#[tauri::command]
pub fn native_quality(path: String) -> Result<QualityResponse, String> {
    let (samples, sr) = load_audio(&path, None, true).map_err(|e| e.to_string())?;

    let result =
        analyze_quality(&samples, sr, &QualityConfig::default()).map_err(|e| e.to_string())?;

    Ok(QualityResponse {
        rms_db: result.rms_db,
        peak_db: result.peak_db,
        crest_factor: result.crest_factor,
        dynamic_range: result.dynamic_range,
        clipping_detected: result.clipping_detected,
        clipping_ratio: result.clipping_ratio,
        dc_offset: result.dc_offset,
    })
}

/// Get audio file info (native, no sidecar).
#[tauri::command]
pub fn native_audio_info(path: String) -> Result<AudioInfoResponse, String> {
    let info = get_audio_info(&path).map_err(|e| e.to_string())?;

    Ok(AudioInfoResponse {
        path: info.path,
        duration_sec: info.duration_sec,
        sample_rate: info.sample_rate,
        channels: info.channels,
        bit_depth: info.bit_depth,
        format: info.format,
    })
}
