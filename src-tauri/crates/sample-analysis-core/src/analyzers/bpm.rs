//! BPM (tempo) detection analyzer.
//!
//! Uses onset strength envelope and autocorrelation for tempo estimation.

use crate::error::Result;
use crate::fft::{autocorrelate, frames_to_time, onset_strength};
use crate::types::BPMResult;

/// Configuration for BPM detection.
#[derive(Debug, Clone)]
pub struct BPMConfig {
    /// Initial BPM estimate for the algorithm
    pub start_bpm: f64,
    /// Minimum BPM to consider
    pub min_bpm: f64,
    /// Maximum BPM to consider
    pub max_bpm: f64,
    /// Include beat positions in result
    pub include_beats: bool,
    /// Hop length for onset analysis
    pub hop_length: usize,
}

impl Default for BPMConfig {
    fn default() -> Self {
        Self {
            start_bpm: 120.0,
            min_bpm: 60.0,
            max_bpm: 200.0,
            include_beats: false,
            hop_length: 512,
        }
    }
}

/// Analyze BPM/tempo.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - BPM detection configuration
///
/// # Returns
/// BPMResult with detected tempo
pub fn analyze_bpm(samples: &[f32], sample_rate: u32, config: &BPMConfig) -> Result<BPMResult> {
    // Compute onset strength envelope
    let onset_env = onset_strength(samples, sample_rate)?;

    if onset_env.len() < 10 {
        return Err(crate::error::AnalysisError::AudioTooShort);
    }

    // Compute autocorrelation of onset envelope
    let acf = autocorrelate(&onset_env);

    // Find tempo using autocorrelation peaks
    let (bpm, confidence) = find_tempo_from_acf(&acf, sample_rate, config);

    // Optionally detect beat positions
    let (beat_frames, beat_times) = if config.include_beats {
        let beats = detect_beats(&onset_env, bpm, sample_rate, config.hop_length);
        let times = frames_to_time(&beats, sample_rate, config.hop_length);
        (Some(beats), Some(times))
    } else {
        (None, None)
    };

    Ok(BPMResult {
        bpm,
        confidence,
        beat_frames,
        beat_times,
    })
}

/// Find tempo from autocorrelation function.
fn find_tempo_from_acf(acf: &[f32], sample_rate: u32, config: &BPMConfig) -> (f64, f64) {
    let hop_length = config.hop_length;

    // Convert BPM range to lag range (in frames)
    let min_lag = bpm_to_lag(config.max_bpm, sample_rate, hop_length);
    let max_lag = bpm_to_lag(config.min_bpm, sample_rate, hop_length);

    let min_lag = min_lag.max(1);
    let max_lag = max_lag.min(acf.len() - 1);

    if min_lag >= max_lag {
        return (config.start_bpm, 0.0);
    }

    // Find peak in autocorrelation within tempo range
    let mut best_lag = min_lag;
    let mut best_value = acf[min_lag];

    for lag in min_lag..=max_lag {
        // Weight by a prior centered on start_bpm
        let lag_bpm = lag_to_bpm(lag, sample_rate, hop_length);
        let prior = tempo_prior(lag_bpm, config.start_bpm);
        let weighted = acf[lag] * prior;

        if weighted > best_value {
            best_value = weighted;
            best_lag = lag;
        }
    }

    let bpm = lag_to_bpm(best_lag, sample_rate, hop_length);

    // Confidence is the autocorrelation value at the peak
    // (already normalized to 0-1 in autocorrelate)
    let confidence = acf[best_lag].clamp(0.0, 1.0) as f64;

    (bpm, confidence)
}

/// Convert BPM to lag in frames.
fn bpm_to_lag(bpm: f64, sample_rate: u32, hop_length: usize) -> usize {
    let period_seconds = 60.0 / bpm;
    let period_samples = period_seconds * sample_rate as f64;
    let lag_frames = period_samples / hop_length as f64;
    lag_frames.round() as usize
}

/// Convert lag in frames to BPM.
fn lag_to_bpm(lag: usize, sample_rate: u32, hop_length: usize) -> f64 {
    if lag == 0 {
        return 0.0;
    }
    let period_samples = lag as f64 * hop_length as f64;
    let period_seconds = period_samples / sample_rate as f64;
    60.0 / period_seconds
}

/// Gaussian prior centered on expected tempo.
fn tempo_prior(bpm: f64, center_bpm: f64) -> f32 {
    let sigma = 40.0; // Wide prior
    let diff = bpm - center_bpm;
    (-(diff * diff) / (2.0 * sigma * sigma)).exp() as f32
}

/// Detect beat positions using onset envelope and detected tempo.
fn detect_beats(
    onset_env: &[f32],
    bpm: f64,
    sample_rate: u32,
    hop_length: usize,
) -> Vec<usize> {
    if onset_env.is_empty() || bpm <= 0.0 {
        return Vec::new();
    }

    // Expected frames between beats
    let beat_period_frames = bpm_to_lag(bpm, sample_rate, hop_length);

    if beat_period_frames == 0 {
        return Vec::new();
    }

    // Dynamic programming to find optimal beat sequence
    // Simplified version: greedy search starting from strong onset
    let mut beats = Vec::new();

    // Find first strong onset
    let threshold = 0.3;
    let start_frame = onset_env.iter().position(|&v| v > threshold).unwrap_or(0);

    // Search for beats at expected intervals
    let search_window = beat_period_frames / 4;
    let mut expected_frame = start_frame;

    while expected_frame < onset_env.len() {
        // Search around expected position
        let search_start = expected_frame.saturating_sub(search_window);
        let search_end = (expected_frame + search_window).min(onset_env.len() - 1);

        // Find local maximum in search window
        let mut best_frame = expected_frame.min(onset_env.len() - 1);
        let mut best_value = onset_env.get(best_frame).copied().unwrap_or(0.0);

        for frame in search_start..=search_end {
            if onset_env[frame] > best_value {
                best_value = onset_env[frame];
                best_frame = frame;
            }
        }

        beats.push(best_frame);
        expected_frame = best_frame + beat_period_frames;
    }

    beats
}

/// Analyze BPM from audio file.
pub fn analyze_bpm_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<BPMConfig>,
) -> Result<BPMResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_bpm(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bpm_to_lag_conversion() {
        let sr = 44100;
        let hop = 512;

        // 120 BPM = 0.5s period
        let lag = bpm_to_lag(120.0, sr, hop);
        let back = lag_to_bpm(lag, sr, hop);

        assert!((back - 120.0).abs() < 2.0);
    }

    #[test]
    fn test_bpm_detection_click_track() {
        // Generate 120 BPM click track
        let sr = 44100;
        let bpm = 120.0;
        let duration = 4.0;
        let n_samples = (sr as f32 * duration) as usize;
        let beat_interval = 60.0 / bpm; // seconds per beat

        let mut samples = vec![0.0f32; n_samples];

        // Add clicks at beat positions
        let mut time = 0.0;
        while time < duration {
            let sample_idx = (time * sr as f32) as usize;
            if sample_idx < n_samples {
                // Short click
                for i in 0..50.min(n_samples - sample_idx) {
                    samples[sample_idx + i] = (-(i as f32) / 10.0).exp();
                }
            }
            time += beat_interval as f32;
        }

        let config = BPMConfig {
            start_bpm: 120.0,
            include_beats: true,
            ..Default::default()
        };

        let result = analyze_bpm(&samples, sr, &config).unwrap();

        // Should detect approximately 120 BPM (within tolerance)
        assert!(
            (result.bpm - 120.0).abs() < 10.0,
            "Detected BPM {} should be close to 120",
            result.bpm
        );

        // Should have beats
        assert!(result.beat_times.is_some());
    }

    #[test]
    fn test_tempo_prior() {
        // Prior should be highest at center
        let center = 120.0;
        let at_center = tempo_prior(120.0, center);
        let away = tempo_prior(80.0, center);

        assert!(at_center > away);
        assert!((at_center - 1.0).abs() < 0.001);
    }
}
