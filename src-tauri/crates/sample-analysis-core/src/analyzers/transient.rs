//! Transient and onset detection analyzer.
//!
//! Detects sudden changes in the audio signal (onsets/transients).

use crate::error::Result;
use crate::fft::{frames_to_time, onset_strength};
use crate::types::TransientResult;

/// Configuration for transient detection.
#[derive(Debug, Clone)]
pub struct TransientConfig {
    /// Hop length for analysis
    pub hop_length: usize,
    /// Whether to backtrack to nearest local minimum
    pub backtrack: bool,
    /// Detection threshold (relative to max onset strength)
    pub threshold: f32,
    /// Include onset strength values in result
    pub include_strengths: bool,
    /// Minimum time between consecutive onsets (seconds)
    pub min_onset_gap: f32,
}

impl Default for TransientConfig {
    fn default() -> Self {
        Self {
            hop_length: 512,
            backtrack: true,
            threshold: 0.1,
            include_strengths: false,
            min_onset_gap: 0.03, // 30ms
        }
    }
}

/// Analyze transients/onsets in audio.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Transient detection configuration
///
/// # Returns
/// TransientResult with onset positions
pub fn analyze_transients(
    samples: &[f32],
    sample_rate: u32,
    config: &TransientConfig,
) -> Result<TransientResult> {
    // Compute onset strength envelope
    let onset_env = onset_strength(samples, sample_rate)?;

    // Find peaks in onset envelope
    let onset_frames = detect_onsets(&onset_env, config, sample_rate);

    // Convert frames to times
    let onset_times = frames_to_time(&onset_frames, sample_rate, config.hop_length);

    // Optionally get strength values at onset positions
    let onset_strengths = if config.include_strengths {
        Some(
            onset_frames
                .iter()
                .map(|&f| onset_env.get(f).copied().unwrap_or(0.0) as f64)
                .collect(),
        )
    } else {
        None
    };

    let num_onsets = onset_frames.len();

    Ok(TransientResult {
        onset_frames,
        onset_times,
        onset_strengths,
        num_onsets,
    })
}

/// Detect onset frames using peak picking.
fn detect_onsets(onset_env: &[f32], config: &TransientConfig, sample_rate: u32) -> Vec<usize> {
    if onset_env.is_empty() {
        return Vec::new();
    }

    let threshold = config.threshold;
    let min_gap_frames =
        (config.min_onset_gap * sample_rate as f32 / config.hop_length as f32) as usize;

    let mut onsets = Vec::new();
    let mut last_onset: Option<usize> = None;

    // Simple peak detection with threshold
    for i in 1..onset_env.len() - 1 {
        let current = onset_env[i];
        let prev = onset_env[i - 1];
        let next = onset_env[i + 1];

        // Check if this is a local maximum above threshold
        if current > prev && current >= next && current > threshold {
            // Check minimum gap constraint
            if let Some(last) = last_onset {
                if i - last < min_gap_frames {
                    continue;
                }
            }

            let onset_frame = if config.backtrack {
                // Backtrack to nearest local minimum
                backtrack_to_minimum(onset_env, i)
            } else {
                i
            };

            onsets.push(onset_frame);
            last_onset = Some(i);
        }
    }

    onsets
}

/// Backtrack from peak to nearest local minimum.
fn backtrack_to_minimum(envelope: &[f32], peak_idx: usize) -> usize {
    let mut idx = peak_idx;

    // Look back up to 10 frames
    let lookback = 10.min(peak_idx);

    for i in (peak_idx - lookback..peak_idx).rev() {
        if envelope[i] <= envelope[idx] {
            idx = i;
        }
        // Stop if we start going up again
        if i > 0 && envelope[i - 1] > envelope[i] {
            break;
        }
    }

    idx
}

/// Analyze transients from audio file.
pub fn analyze_transients_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<TransientConfig>,
) -> Result<TransientResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_transients(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_onset_detection_clicks() {
        // Generate click track: short impulses every 0.5 seconds
        let sr = 44100;
        let duration = 2.0;
        let n_samples = (sr as f32 * duration) as usize;
        let click_interval = 0.5; // seconds

        let mut samples = vec![0.0f32; n_samples];

        // Add clicks
        let mut time = 0.0;
        while time < duration {
            let sample_idx = (time * sr as f32) as usize;
            if sample_idx < n_samples {
                // Short impulse
                for i in 0..100.min(n_samples - sample_idx) {
                    samples[sample_idx + i] = (-(i as f32) / 100.0 * 10.0).exp();
                }
            }
            time += click_interval;
        }

        let config = TransientConfig {
            threshold: 0.05,
            include_strengths: true,
            ..Default::default()
        };

        let result = analyze_transients(&samples, sr, &config).unwrap();

        // Should detect approximately 4 onsets (at 0, 0.5, 1.0, 1.5)
        assert!(result.num_onsets >= 2 && result.num_onsets <= 6);

        // Onset times should be roughly 0.5s apart
        if result.onset_times.len() >= 2 {
            let gap = result.onset_times[1] - result.onset_times[0];
            assert!(gap > 0.3 && gap < 0.7);
        }
    }

    #[test]
    fn test_backtrack_to_minimum() {
        let envelope = vec![0.1, 0.2, 0.15, 0.1, 0.5, 0.8, 0.9, 0.7, 0.4];
        let peak_idx = 6; // Peak at 0.9

        let backtracked = backtrack_to_minimum(&envelope, peak_idx);

        // Should backtrack to local minimum before the rise
        assert!(backtracked <= peak_idx);
        assert!(envelope[backtracked] <= envelope[peak_idx]);
    }

    #[test]
    fn test_empty_audio() {
        let samples: Vec<f32> = vec![];
        let result = analyze_transients(&samples, 44100, &TransientConfig::default());
        assert!(result.is_err());
    }
}
