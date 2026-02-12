//! Mel filterbank generation and mel spectrogram computation.
//!
//! Implements the mel scale conversion and triangular filterbank
//! as used by librosa for audio analysis.

use crate::error::Result;
use crate::fft::{power_spectrogram, StftConfig};
use rayon::prelude::*;

/// Convert frequency in Hz to mel scale.
///
/// Uses the HTK formula: mel = 2595 * log10(1 + hz / 700)
#[inline]
pub fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

/// Convert mel scale to frequency in Hz.
///
/// Inverse of hz_to_mel: hz = 700 * (10^(mel / 2595) - 1)
#[inline]
pub fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10.0f32.powf(mel / 2595.0) - 1.0)
}

/// Generate mel filterbank matrix.
///
/// # Arguments
/// * `n_mels` - Number of mel bands
/// * `n_fft` - FFT size
/// * `sample_rate` - Sample rate in Hz
/// * `f_min` - Minimum frequency in Hz (default 0)
/// * `f_max` - Maximum frequency in Hz (default sample_rate / 2)
///
/// # Returns
/// Filterbank matrix of shape [n_mels x (n_fft / 2 + 1)]
pub fn mel_filterbank(
    n_mels: usize,
    n_fft: usize,
    sample_rate: u32,
    f_min: f32,
    f_max: Option<f32>,
) -> Vec<Vec<f32>> {
    let f_max = f_max.unwrap_or(sample_rate as f32 / 2.0);
    let n_freqs = n_fft / 2 + 1;

    // Compute mel points
    let mel_min = hz_to_mel(f_min);
    let mel_max = hz_to_mel(f_max);

    // n_mels + 2 points for triangular filters
    let mel_points: Vec<f32> = (0..=n_mels + 1)
        .map(|i| mel_min + (mel_max - mel_min) * i as f32 / (n_mels + 1) as f32)
        .collect();

    // Convert mel points back to Hz
    let hz_points: Vec<f32> = mel_points.iter().map(|&m| mel_to_hz(m)).collect();

    // Convert Hz points to FFT bin indices
    let bin_points: Vec<f32> = hz_points
        .iter()
        .map(|&hz| hz * n_fft as f32 / sample_rate as f32)
        .collect();

    // Create filterbank
    let mut filterbank = vec![vec![0.0f32; n_freqs]; n_mels];

    for m in 0..n_mels {
        let f_start = bin_points[m];
        let f_center = bin_points[m + 1];
        let f_end = bin_points[m + 2];

        for k in 0..n_freqs {
            let k_f = k as f32;

            if k_f >= f_start && k_f <= f_center {
                // Rising slope
                if f_center > f_start {
                    filterbank[m][k] = (k_f - f_start) / (f_center - f_start);
                }
            } else if k_f > f_center && k_f <= f_end {
                // Falling slope
                if f_end > f_center {
                    filterbank[m][k] = (f_end - k_f) / (f_end - f_center);
                }
            }
        }
    }

    filterbank
}

/// Compute mel spectrogram.
///
/// # Arguments
/// * `samples` - Audio samples
/// * `sample_rate` - Sample rate in Hz
/// * `n_fft` - FFT size (default 2048)
/// * `hop_length` - Hop length (default 512)
/// * `n_mels` - Number of mel bands (default 128)
/// * `f_min` - Minimum frequency (default 0)
/// * `f_max` - Maximum frequency (default sample_rate / 2)
///
/// # Returns
/// Mel spectrogram of shape [n_mels x n_frames]
pub fn mel_spectrogram(
    samples: &[f32],
    sample_rate: u32,
    n_fft: usize,
    hop_length: usize,
    n_mels: usize,
    f_min: f32,
    f_max: Option<f32>,
) -> Result<Vec<Vec<f32>>> {
    // Compute power spectrogram
    let config = StftConfig {
        n_fft,
        hop_length,
        ..Default::default()
    };
    let power_spec = power_spectrogram(samples, &config)?;

    // Generate mel filterbank
    let filterbank = mel_filterbank(n_mels, n_fft, sample_rate, f_min, f_max);

    let n_frames = power_spec[0].len();

    // Apply filterbank: mel_spec = filterbank @ power_spec
    // Parallelize over mel bands for better performance
    let mel_spec: Vec<Vec<f32>> = filterbank
        .par_iter()
        .map(|filter| {
            (0..n_frames)
                .map(|frame_idx| {
                    filter
                        .iter()
                        .enumerate()
                        .filter(|(_, &weight)| weight > 0.0)
                        .map(|(freq_idx, &weight)| weight * power_spec[freq_idx][frame_idx])
                        .sum()
                })
                .collect()
        })
        .collect();

    Ok(mel_spec)
}

/// Compute MFCCs (Mel-Frequency Cepstral Coefficients).
///
/// # Arguments
/// * `samples` - Audio samples
/// * `sample_rate` - Sample rate in Hz
/// * `n_mfcc` - Number of MFCCs to return (default 13)
/// * `n_mels` - Number of mel bands (default 128)
/// * `n_fft` - FFT size (default 2048)
/// * `hop_length` - Hop length (default 512)
///
/// # Returns
/// MFCCs of shape [n_mfcc x n_frames]
pub fn mfcc(
    samples: &[f32],
    sample_rate: u32,
    n_mfcc: usize,
    n_mels: usize,
    n_fft: usize,
    hop_length: usize,
) -> Result<Vec<Vec<f32>>> {
    // Compute mel spectrogram
    let mel_spec = mel_spectrogram(samples, sample_rate, n_fft, hop_length, n_mels, 0.0, None)?;

    let n_frames = mel_spec[0].len();

    // Convert to log scale
    let log_mel: Vec<Vec<f32>> = mel_spec
        .iter()
        .map(|row| row.iter().map(|&x| (x + 1e-10).ln()).collect())
        .collect();

    // Apply DCT-II to get MFCCs
    // DCT-II: X[k] = sum_{n=0}^{N-1} x[n] * cos(pi/N * (n + 0.5) * k)
    let mut mfccs = vec![vec![0.0f32; n_frames]; n_mfcc];

    for frame_idx in 0..n_frames {
        // Extract mel coefficients for this frame
        let frame_mel: Vec<f32> = log_mel.iter().map(|row| row[frame_idx]).collect();

        // Apply DCT
        for k in 0..n_mfcc {
            let mut sum = 0.0f32;
            for (n, &x) in frame_mel.iter().enumerate() {
                let angle =
                    std::f32::consts::PI / n_mels as f32 * (n as f32 + 0.5) * k as f32;
                sum += x * angle.cos();
            }
            // Ortho normalization
            let norm = if k == 0 {
                (1.0 / n_mels as f32).sqrt()
            } else {
                (2.0 / n_mels as f32).sqrt()
            };
            mfccs[k][frame_idx] = sum * norm;
        }
    }

    Ok(mfccs)
}

/// Compute mean MFCCs across time frames.
pub fn mfcc_mean(
    samples: &[f32],
    sample_rate: u32,
    n_mfcc: usize,
) -> Result<Vec<f64>> {
    let mfccs = mfcc(samples, sample_rate, n_mfcc, 128, 2048, 512)?;

    let means: Vec<f64> = mfccs
        .iter()
        .map(|row| {
            let sum: f32 = row.iter().sum();
            sum as f64 / row.len() as f64
        })
        .collect();

    Ok(means)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hz_to_mel_conversion() {
        // Test known values
        let hz_1000 = hz_to_mel(1000.0);
        assert!((hz_1000 - 1000.0).abs() < 50.0); // Should be around 1000 mel

        // Test round-trip
        let hz = 440.0;
        let mel = hz_to_mel(hz);
        let back = mel_to_hz(mel);
        assert!((hz - back).abs() < 0.01);
    }

    #[test]
    fn test_filterbank_shape() {
        let n_mels = 128;
        let n_fft = 2048;
        let sr = 44100;

        let filterbank = mel_filterbank(n_mels, n_fft, sr, 0.0, None);

        assert_eq!(filterbank.len(), n_mels);
        assert_eq!(filterbank[0].len(), n_fft / 2 + 1);

        // Check that at least one filter has non-zero values
        let mid_filter = &filterbank[n_mels / 2];
        let sum: f32 = mid_filter.iter().sum();
        assert!(sum > 0.0, "Filter should have non-zero sum, got {}", sum);
    }

    #[test]
    fn test_mel_spectrogram() {
        // Generate test signal
        let sr = 22050;
        let duration = 0.5;
        let n_samples = (sr as f32 * duration) as usize;
        let freq = 440.0;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect();

        let mel_spec = mel_spectrogram(&samples, sr, 2048, 512, 128, 0.0, None).unwrap();

        assert_eq!(mel_spec.len(), 128); // n_mels
        assert!(mel_spec[0].len() > 0); // Should have frames
    }
}
