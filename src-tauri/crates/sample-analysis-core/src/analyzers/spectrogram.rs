//! Mel spectrogram generator for visualization.
//!
//! Generates mel spectrograms suitable for display in a GUI.
//! Output is normalized to [0, 1] range.

use crate::error::Result;
use crate::fft::{power_spectrogram, power_to_db, StftConfig};
use crate::mel::mel_spectrogram;
use crate::types::SpectrogramResult;

/// Scale type for spectrogram frequency axis.
#[derive(Debug, Clone, PartialEq)]
pub enum SpectrogramScale {
    Mel,
    Linear,
}

/// Configuration for spectrogram generation.
#[derive(Debug, Clone)]
pub struct SpectrogramConfig {
    /// Target width (time bins)
    pub width: usize,
    /// Target height (mel bins)
    pub height: usize,
    /// FFT size
    pub n_fft: usize,
    /// Minimum frequency in Hz
    pub f_min: f32,
    /// Maximum frequency in Hz (None = sample_rate / 2)
    pub f_max: Option<f32>,
    /// Top dB threshold for normalization
    pub top_db: f32,
    /// Frequency axis scale (Mel or Linear)
    pub scale: SpectrogramScale,
}

impl Default for SpectrogramConfig {
    fn default() -> Self {
        Self {
            width: 800,
            height: 128,
            n_fft: 1024, // Reduced from 2048 for faster visualization
            f_min: 0.0,
            f_max: None,
            top_db: 80.0,
            scale: SpectrogramScale::Mel,
        }
    }
}

/// Generate spectrogram for visualization.
///
/// Supports both mel-scale and linear-scale spectrograms depending on
/// `config.scale`.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Spectrogram configuration
///
/// # Returns
/// SpectrogramResult with normalized 2D data [height x width]
pub fn analyze_spectrogram(
    samples: &[f32],
    sample_rate: u32,
    config: &SpectrogramConfig,
) -> Result<SpectrogramResult> {
    let duration = samples.len() as f64 / sample_rate as f64;

    let hop_length = if samples.len() > config.width {
        (samples.len() / config.width).max(1)
    } else {
        512
    };

    match config.scale {
        SpectrogramScale::Mel => {
            // Existing mel spectrogram path
            let mel_spec = mel_spectrogram(
                samples,
                sample_rate,
                config.n_fft,
                hop_length,
                config.height,
                config.f_min,
                config.f_max,
            )?;

            let max_val = mel_spec
                .iter()
                .flat_map(|row| row.iter())
                .cloned()
                .fold(0.0f32, f32::max);

            let ref_value = max_val.sqrt().max(1e-10);
            let mel_db = power_to_db(&mel_spec, ref_value, config.top_db);

            let min_db = -config.top_db;
            let max_db = 0.0f32;
            let db_range = max_db - min_db;

            let normalized: Vec<Vec<f64>> = mel_db
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|&db| ((db - min_db) / db_range).clamp(0.0, 1.0) as f64)
                        .collect()
                })
                .collect();

            let actual_width = normalized.first().map(|r| r.len()).unwrap_or(0);

            let final_spec = if actual_width != config.width {
                resample_spectrogram(&normalized, config.width)
            } else {
                normalized
            };

            Ok(SpectrogramResult {
                spectrogram: final_spec,
                duration,
                width: config.width,
                height: config.height,
                sample_rate,
            })
        }
        SpectrogramScale::Linear => {
            // Linear frequency scale: use power spectrogram directly
            let stft_config = StftConfig {
                n_fft: config.n_fft,
                hop_length,
                ..Default::default()
            };
            let power_spec = power_spectrogram(samples, &stft_config)?;

            let max_val = power_spec
                .iter()
                .flat_map(|row| row.iter())
                .cloned()
                .fold(0.0f32, f32::max);

            let ref_value = max_val.sqrt().max(1e-10);
            let spec_db = power_to_db(&power_spec, ref_value, config.top_db);

            let min_db = -config.top_db;
            let max_db = 0.0f32;
            let db_range = max_db - min_db;

            let normalized: Vec<Vec<f64>> = spec_db
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|&db| ((db - min_db) / db_range).clamp(0.0, 1.0) as f64)
                        .collect()
                })
                .collect();

            // Resample to target dimensions (both height and width)
            let resampled_width = resample_spectrogram(&normalized, config.width);
            let final_spec = resample_spectrogram_height(&resampled_width, config.height);

            Ok(SpectrogramResult {
                spectrogram: final_spec,
                duration,
                width: config.width,
                height: config.height,
                sample_rate,
            })
        }
    }
}

/// Resample spectrogram to target width using linear interpolation.
fn resample_spectrogram(spec: &[Vec<f64>], target_width: usize) -> Vec<Vec<f64>> {
    if spec.is_empty() || spec[0].is_empty() {
        return vec![vec![0.0; target_width]; spec.len()];
    }

    let src_width = spec[0].len();

    spec.iter()
        .map(|row| {
            (0..target_width)
                .map(|i| {
                    let src_pos = i as f64 * (src_width - 1) as f64 / (target_width - 1).max(1) as f64;
                    let src_idx = src_pos as usize;
                    let frac = src_pos - src_idx as f64;

                    if src_idx + 1 < src_width {
                        row[src_idx] * (1.0 - frac) + row[src_idx + 1] * frac
                    } else {
                        row.last().copied().unwrap_or(0.0)
                    }
                })
                .collect()
        })
        .collect()
}

/// Resample spectrogram to target height using linear interpolation.
fn resample_spectrogram_height(spec: &[Vec<f64>], target_height: usize) -> Vec<Vec<f64>> {
    if spec.is_empty() {
        return vec![vec![]; target_height];
    }
    let src_height = spec.len();
    if src_height == target_height {
        return spec.to_vec();
    }
    let width = spec[0].len();
    (0..target_height)
        .map(|i| {
            let src_pos = i as f64 * (src_height - 1) as f64 / (target_height - 1).max(1) as f64;
            let src_idx = src_pos as usize;
            let frac = src_pos - src_idx as f64;
            (0..width)
                .map(|j| {
                    if src_idx + 1 < src_height {
                        spec[src_idx][j] * (1.0 - frac) + spec[src_idx + 1][j] * frac
                    } else {
                        spec.last().map(|r| r[j]).unwrap_or(0.0)
                    }
                })
                .collect()
        })
        .collect()
}

/// Generate spectrogram from audio file.
pub fn analyze_spectrogram_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<SpectrogramConfig>,
) -> Result<SpectrogramResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_spectrogram(&samples, sample_rate, &config)
}

/// Generate a simple waveform representation.
///
/// Returns peak values at evenly spaced intervals.
pub fn generate_waveform(samples: &[f32], width: usize) -> Vec<f32> {
    if samples.is_empty() || width == 0 {
        return vec![0.0; width];
    }

    let chunk_size = (samples.len() + width - 1) / width;

    (0..width)
        .map(|i| {
            let start = i * chunk_size;
            let end = ((i + 1) * chunk_size).min(samples.len());

            if start >= samples.len() {
                return 0.0;
            }

            // Return peak value in this chunk
            samples[start..end]
                .iter()
                .map(|&s| s.abs())
                .fold(0.0f32, f32::max)
        })
        .collect()
}

/// Generate frequency waveform: peak amplitudes with spectral centroid at each position.
///
/// Returns (peaks, centroids_hz) where centroids_hz gives the spectral centroid frequency
/// at each waveform position.
pub fn generate_frequency_waveform(samples: &[f32], sample_rate: u32, width: usize) -> (Vec<f32>, Vec<f32>) {
    use crate::fft::{stft, StftConfig, fft_frequencies};

    if samples.is_empty() || width == 0 {
        return (vec![0.0; width], vec![0.0; width]);
    }

    // First get peaks (reuse existing logic)
    let peaks = generate_waveform(samples, width);

    // Compute STFT to get magnitudes at each time frame
    let n_fft = 1024;
    let hop_length = (samples.len() / width).max(1);
    let config = StftConfig {
        n_fft,
        hop_length,
        ..Default::default()
    };
    let magnitudes = match stft(samples, &config) {
        Ok(m) => m, // [n_freqs x n_frames]
        Err(_) => return (peaks, vec![0.0; width]),
    };
    let freqs = fft_frequencies(sample_rate, n_fft); // frequency for each bin

    // Compute spectral centroid at each STFT frame
    let n_frames = magnitudes.first().map(|r| r.len()).unwrap_or(0);
    let mut frame_centroids = Vec::with_capacity(n_frames);
    for frame_idx in 0..n_frames {
        let total_mag: f32 = magnitudes.iter().map(|freq_row| freq_row[frame_idx]).sum();
        if total_mag > 1e-10 {
            let weighted: f32 = magnitudes
                .iter()
                .zip(freqs.iter())
                .map(|(freq_row, &freq)| freq * freq_row[frame_idx])
                .sum();
            frame_centroids.push(weighted / total_mag);
        } else {
            frame_centroids.push(0.0);
        }
    }

    // Resample centroids to match width
    let centroids = if frame_centroids.len() == width {
        frame_centroids
    } else if frame_centroids.is_empty() {
        vec![0.0; width]
    } else {
        (0..width)
            .map(|i| {
                let src_pos = i as f32 * (frame_centroids.len() - 1) as f32 / (width - 1).max(1) as f32;
                let idx = src_pos as usize;
                let frac = src_pos - idx as f32;
                if idx + 1 < frame_centroids.len() {
                    frame_centroids[idx] * (1.0 - frac) + frame_centroids[idx + 1] * frac
                } else {
                    *frame_centroids.last().unwrap_or(&0.0)
                }
            })
            .collect()
    };

    (peaks, centroids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spectrogram_generation() {
        // Generate test sine wave
        let sr = 22050;
        let duration = 1.0;
        let n_samples = (sr as f32 * duration) as usize;
        let freq = 440.0;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect();

        let config = SpectrogramConfig {
            width: 100,
            height: 64,
            ..Default::default()
        };

        let result = analyze_spectrogram(&samples, sr, &config).unwrap();

        assert_eq!(result.height, 64);
        assert_eq!(result.width, 100);
        assert_eq!(result.spectrogram.len(), 64);
        assert_eq!(result.spectrogram[0].len(), 100);

        // Values should be normalized to [0, 1]
        for row in &result.spectrogram {
            for &val in row {
                assert!(val >= 0.0 && val <= 1.0);
            }
        }
    }

    #[test]
    fn test_waveform_generation() {
        let samples: Vec<f32> = (0..1000)
            .map(|i| (i as f32 / 50.0).sin() * 0.5)
            .collect();

        let waveform = generate_waveform(&samples, 100);

        assert_eq!(waveform.len(), 100);

        // All values should be positive (absolute values)
        for &v in &waveform {
            assert!(v >= 0.0);
            assert!(v <= 0.5 + 0.01); // Max amplitude was 0.5
        }
    }

    #[test]
    fn test_resample_spectrogram() {
        let spec = vec![
            vec![0.0, 0.5, 1.0],
            vec![1.0, 0.5, 0.0],
        ];

        let resampled = resample_spectrogram(&spec, 5);

        assert_eq!(resampled.len(), 2);
        assert_eq!(resampled[0].len(), 5);

        // First and last should match original
        assert!((resampled[0][0] - 0.0).abs() < 0.001);
        assert!((resampled[0][4] - 1.0).abs() < 0.001);
    }
}
