//! Audio quality metrics analyzer.
//!
//! Computes various quality metrics including:
//! - RMS level
//! - Peak level
//! - Crest factor
//! - Dynamic range
//! - DC offset
//! - Clipping detection

use crate::error::Result;
use crate::types::QualityResult;

/// Configuration for quality analysis.
#[derive(Debug, Clone)]
pub struct QualityConfig {
    /// Threshold for clipping detection (0.0 to 1.0, default 0.99)
    pub clipping_threshold: f32,
    /// Percentile for dynamic range calculation (default 10.0)
    pub dynamic_range_percentile: f32,
    /// Frame size in seconds for dynamic range calculation (default 0.05)
    pub frame_duration: f32,
}

impl Default for QualityConfig {
    fn default() -> Self {
        Self {
            clipping_threshold: 0.99,
            dynamic_range_percentile: 10.0,
            frame_duration: 0.05,
        }
    }
}

/// Analyze audio quality metrics.
///
/// # Arguments
/// * `samples` - Audio samples (mono, normalized to -1.0 to 1.0)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Quality analysis configuration
///
/// # Returns
/// QualityResult with all computed metrics
pub fn analyze_quality(samples: &[f32], sample_rate: u32, config: &QualityConfig) -> Result<QualityResult> {
    if samples.is_empty() {
        return Err(crate::error::AnalysisError::AudioTooShort);
    }

    // DC offset (mean of samples)
    let dc_offset: f64 = samples.iter().map(|&s| s as f64).sum::<f64>() / samples.len() as f64;

    // Center the signal (remove DC offset)
    let centered: Vec<f32> = samples.iter().map(|&s| s - dc_offset as f32).collect();

    // RMS level
    let rms = compute_rms(&centered);
    let rms_db = amplitude_to_db(rms);

    // Peak level
    let peak = centered.iter().map(|&s| s.abs()).fold(0.0f32, f32::max);
    let peak_db = amplitude_to_db(peak);

    // Crest factor (peak / RMS ratio in dB)
    let crest_factor = if rms > 0.0 {
        peak_db - rms_db
    } else {
        0.0
    };

    // Clipping detection
    let clipping_count = samples
        .iter()
        .filter(|&&s| s.abs() >= config.clipping_threshold)
        .count();
    let clipping_ratio = clipping_count as f64 / samples.len() as f64;
    let clipping_detected = clipping_ratio > 0.0001; // More than 0.01%

    // Dynamic range
    let dynamic_range = compute_dynamic_range(&centered, sample_rate, config);

    Ok(QualityResult {
        rms_db,
        peak_db,
        crest_factor,
        dynamic_range,
        clipping_detected,
        clipping_ratio,
        dc_offset,
    })
}

/// Compute RMS (Root Mean Square) of samples.
fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt() as f32
}

/// Convert amplitude to dB.
fn amplitude_to_db(amplitude: f32) -> f64 {
    if amplitude <= 0.0 {
        return -120.0; // Floor
    }
    20.0 * (amplitude as f64).log10()
}

/// Compute dynamic range using frame-based RMS analysis.
fn compute_dynamic_range(samples: &[f32], sample_rate: u32, config: &QualityConfig) -> f64 {
    let frame_size = (config.frame_duration * sample_rate as f32) as usize;
    let hop_size = frame_size / 2;

    if frame_size == 0 || samples.len() < frame_size {
        return 0.0;
    }

    // Calculate RMS for each frame
    let mut frame_rms: Vec<f32> = Vec::new();
    let mut pos = 0;

    while pos + frame_size <= samples.len() {
        let frame = &samples[pos..pos + frame_size];
        let rms = compute_rms(frame);
        if rms > 0.0 {
            frame_rms.push(rms);
        }
        pos += hop_size;
    }

    if frame_rms.is_empty() {
        return 0.0;
    }

    // Sort to find percentiles
    frame_rms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let low_idx = ((config.dynamic_range_percentile / 100.0) * frame_rms.len() as f32) as usize;
    let high_idx = (((100.0 - config.dynamic_range_percentile) / 100.0) * frame_rms.len() as f32) as usize;

    let low_idx = low_idx.min(frame_rms.len() - 1);
    let high_idx = high_idx.min(frame_rms.len() - 1).max(low_idx);

    let quiet_rms = frame_rms[low_idx];
    let loud_rms = frame_rms[high_idx];

    if quiet_rms <= 0.0 {
        return 0.0;
    }

    20.0 * ((loud_rms / quiet_rms) as f64).log10()
}

/// Analyze quality from audio file path.
pub fn analyze_quality_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<QualityConfig>,
) -> Result<QualityResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_quality(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_rms() {
        // Constant signal
        let samples = vec![0.5f32; 100];
        let rms = compute_rms(&samples);
        assert!((rms - 0.5).abs() < 0.001);

        // Zero signal
        let zeros = vec![0.0f32; 100];
        assert_eq!(compute_rms(&zeros), 0.0);
    }

    #[test]
    fn test_amplitude_to_db() {
        // Full scale = 0 dB
        assert!((amplitude_to_db(1.0) - 0.0).abs() < 0.001);

        // Half amplitude = -6 dB
        assert!((amplitude_to_db(0.5) - (-6.02)).abs() < 0.1);

        // Zero amplitude
        assert!(amplitude_to_db(0.0) <= -100.0);
    }

    #[test]
    fn test_quality_analysis() {
        // Generate test signal: sine wave
        let sr = 44100;
        let duration = 0.5;
        let n_samples = (sr as f32 * duration) as usize;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / sr as f32).sin())
            .collect();

        let result = analyze_quality(&samples, sr, &QualityConfig::default()).unwrap();

        // RMS of 0.5 amplitude sine = 0.5 / sqrt(2) ≈ 0.354
        assert!(result.rms_db < 0.0); // Should be negative dB

        // Peak should be around -6 dB (0.5 amplitude)
        assert!((result.peak_db - (-6.02)).abs() < 0.5);

        // Sine wave crest factor ≈ 3 dB
        assert!((result.crest_factor - 3.0).abs() < 0.5);

        // No clipping
        assert!(!result.clipping_detected);
        assert!(result.clipping_ratio < 0.0001);
    }

    #[test]
    fn test_clipping_detection() {
        // Signal with clipping
        let samples: Vec<f32> = (0..1000)
            .map(|i| {
                let val = (i as f32 / 100.0).sin() * 1.5;
                val.clamp(-1.0, 1.0)
            })
            .collect();

        let config = QualityConfig {
            clipping_threshold: 0.99,
            ..Default::default()
        };

        let result = analyze_quality(&samples, 44100, &config).unwrap();
        assert!(result.clipping_detected);
        assert!(result.clipping_ratio > 0.0);
    }
}
