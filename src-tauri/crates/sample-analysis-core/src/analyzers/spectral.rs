//! Spectral features analyzer.
//!
//! Computes various spectral features:
//! - Spectral centroid (center of mass)
//! - Spectral rolloff (frequency at which 85% of energy is below)
//! - Spectral bandwidth (spread around centroid)
//! - Spectral flatness (tonality vs noise)
//! - Zero crossing rate
//! - MFCCs

use crate::error::Result;
use crate::fft::{fft_frequencies, power_spectrogram, StftConfig};
use crate::mel::mfcc_mean;
use crate::types::SpectralResult;

/// Configuration for spectral analysis.
#[derive(Debug, Clone)]
pub struct SpectralConfig {
    /// FFT size
    pub n_fft: usize,
    /// Hop length
    pub hop_length: usize,
    /// Number of MFCCs to compute
    pub n_mfcc: usize,
    /// Rolloff percentage (default 0.85)
    pub roll_percent: f32,
}

impl Default for SpectralConfig {
    fn default() -> Self {
        Self {
            n_fft: 2048,
            hop_length: 512,
            n_mfcc: 13,
            roll_percent: 0.85,
        }
    }
}

/// Analyze spectral features.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Spectral analysis configuration
///
/// # Returns
/// SpectralResult with all computed features
pub fn analyze_spectral(
    samples: &[f32],
    sample_rate: u32,
    config: &SpectralConfig,
) -> Result<SpectralResult> {
    // Compute power spectrogram
    let stft_config = StftConfig {
        n_fft: config.n_fft,
        hop_length: config.hop_length,
        ..Default::default()
    };
    let power_spec = power_spectrogram(samples, &stft_config)?;

    // Get frequency bins
    let freqs = fft_frequencies(sample_rate, config.n_fft);

    // Compute spectral features (averaged over time)
    let spectral_centroid = compute_spectral_centroid(&power_spec, &freqs);
    let spectral_rolloff = compute_spectral_rolloff(&power_spec, &freqs, config.roll_percent);
    let spectral_bandwidth = compute_spectral_bandwidth(&power_spec, &freqs, spectral_centroid);
    let spectral_flatness = compute_spectral_flatness(&power_spec);

    // Zero crossing rate
    let zero_crossing_rate = compute_zcr(samples);

    // MFCCs
    let mfccs = mfcc_mean(samples, sample_rate, config.n_mfcc)?;

    Ok(SpectralResult {
        spectral_centroid,
        spectral_rolloff,
        spectral_bandwidth,
        spectral_flatness,
        zero_crossing_rate,
        mfccs,
    })
}

/// Compute spectral centroid (center of mass of spectrum).
fn compute_spectral_centroid(power_spec: &[Vec<f32>], freqs: &[f32]) -> f64 {
    let n_frames = power_spec[0].len();
    let mut total_centroid = 0.0f64;

    for frame_idx in 0..n_frames {
        let mut weighted_sum = 0.0f64;
        let mut total_power = 0.0f64;

        for (freq_idx, &freq) in freqs.iter().enumerate() {
            let power = power_spec[freq_idx][frame_idx] as f64;
            weighted_sum += freq as f64 * power;
            total_power += power;
        }

        if total_power > 0.0 {
            total_centroid += weighted_sum / total_power;
        }
    }

    total_centroid / n_frames as f64
}

/// Compute spectral rolloff (frequency below which roll_percent of energy lies).
fn compute_spectral_rolloff(power_spec: &[Vec<f32>], freqs: &[f32], roll_percent: f32) -> f64 {
    let n_frames = power_spec[0].len();
    let n_freqs = freqs.len();
    let mut total_rolloff = 0.0f64;

    for frame_idx in 0..n_frames {
        // Total energy in this frame
        let total_energy: f64 = (0..n_freqs)
            .map(|f| power_spec[f][frame_idx] as f64)
            .sum();

        // Find frequency at which cumulative energy reaches threshold
        let threshold = total_energy * roll_percent as f64;
        let mut cumulative = 0.0f64;
        let mut rolloff_freq = freqs.last().copied().unwrap_or(0.0) as f64;

        for (freq_idx, &freq) in freqs.iter().enumerate() {
            cumulative += power_spec[freq_idx][frame_idx] as f64;
            if cumulative >= threshold {
                rolloff_freq = freq as f64;
                break;
            }
        }

        total_rolloff += rolloff_freq;
    }

    total_rolloff / n_frames as f64
}

/// Compute spectral bandwidth (weighted standard deviation around centroid).
fn compute_spectral_bandwidth(power_spec: &[Vec<f32>], freqs: &[f32], centroid: f64) -> f64 {
    let n_frames = power_spec[0].len();
    let mut total_bandwidth = 0.0f64;

    for frame_idx in 0..n_frames {
        let mut weighted_var = 0.0f64;
        let mut total_power = 0.0f64;

        for (freq_idx, &freq) in freqs.iter().enumerate() {
            let power = power_spec[freq_idx][frame_idx] as f64;
            let diff = freq as f64 - centroid;
            weighted_var += power * diff * diff;
            total_power += power;
        }

        if total_power > 0.0 {
            total_bandwidth += (weighted_var / total_power).sqrt();
        }
    }

    total_bandwidth / n_frames as f64
}

/// Compute spectral flatness (geometric mean / arithmetic mean).
///
/// Returns value between 0 (tonal) and 1 (noisy/white noise).
fn compute_spectral_flatness(power_spec: &[Vec<f32>]) -> f64 {
    let n_frames = power_spec[0].len();
    let n_freqs = power_spec.len();
    let mut total_flatness = 0.0f64;

    for frame_idx in 0..n_frames {
        // Get magnitudes for this frame
        let magnitudes: Vec<f64> = (0..n_freqs)
            .map(|f| (power_spec[f][frame_idx] as f64).max(1e-10))
            .collect();

        // Arithmetic mean
        let arith_mean: f64 = magnitudes.iter().sum::<f64>() / n_freqs as f64;

        // Geometric mean (using log to avoid overflow)
        let log_sum: f64 = magnitudes.iter().map(|&m| m.ln()).sum();
        let geom_mean = (log_sum / n_freqs as f64).exp();

        if arith_mean > 0.0 {
            total_flatness += geom_mean / arith_mean;
        }
    }

    (total_flatness / n_frames as f64).clamp(0.0, 1.0)
}

/// Compute zero crossing rate.
fn compute_zcr(samples: &[f32]) -> f64 {
    if samples.len() < 2 {
        return 0.0;
    }

    let crossings = samples
        .windows(2)
        .filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0))
        .count();

    crossings as f64 / (samples.len() - 1) as f64
}

/// Analyze spectral features from audio file.
pub fn analyze_spectral_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<SpectralConfig>,
) -> Result<SpectralResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_spectral(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_crossing_rate() {
        // Sine wave should have consistent ZCR based on frequency
        let sr = 44100.0;
        let freq = 440.0;
        let duration = 0.1;
        let n_samples = (sr * duration) as usize;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect();

        let zcr = compute_zcr(&samples);

        // Expected ZCR ≈ 2 * freq / sr (two crossings per cycle)
        let expected = 2.0 * freq as f64 / sr as f64;
        assert!((zcr - expected).abs() < 0.01);
    }

    #[test]
    fn test_spectral_flatness() {
        // White noise should have high flatness
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Generate pseudo-random noise
        let n_samples = 4096;
        let samples: Vec<f32> = (0..n_samples)
            .map(|i| {
                let mut hasher = DefaultHasher::new();
                i.hash(&mut hasher);
                (hasher.finish() as f32 / u64::MAX as f32) * 2.0 - 1.0
            })
            .collect();

        let config = StftConfig {
            n_fft: 1024,
            hop_length: 512,
            ..Default::default()
        };
        let power_spec = power_spectrogram(&samples, &config).unwrap();
        let flatness = compute_spectral_flatness(&power_spec);

        // Noise should have flatness closer to 1
        assert!(flatness > 0.1);
    }

    #[test]
    fn test_spectral_analysis() {
        let sr = 22050;
        let duration = 0.5;
        let n_samples = (sr as f32 * duration) as usize;
        let freq = 440.0;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect();

        let result = analyze_spectral(&samples, sr, &SpectralConfig::default()).unwrap();

        // Centroid should be near the fundamental frequency
        assert!(result.spectral_centroid > 300.0 && result.spectral_centroid < 600.0);

        // Should have 13 MFCCs
        assert_eq!(result.mfccs.len(), 13);

        // ZCR should be reasonable for 440 Hz
        assert!(result.zero_crossing_rate > 0.01 && result.zero_crossing_rate < 0.1);
    }
}
