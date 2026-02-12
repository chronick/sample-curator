//! FFT utilities for spectral analysis.
//!
//! Provides STFT computation and related functions.

use crate::error::{AnalysisError, Result};
use rayon::prelude::*;
use realfft::RealFftPlanner;
use std::f32::consts::PI;

/// STFT (Short-Time Fourier Transform) configuration.
#[derive(Debug, Clone)]
pub struct StftConfig {
    /// FFT size (typically 2048)
    pub n_fft: usize,
    /// Hop length between frames
    pub hop_length: usize,
    /// Window function to use
    pub window: WindowType,
    /// Whether to center the signal with padding
    pub center: bool,
}

impl Default for StftConfig {
    fn default() -> Self {
        Self {
            n_fft: 2048,
            hop_length: 512,
            window: WindowType::Hann,
            center: true,
        }
    }
}

/// Window function types.
#[derive(Debug, Clone, Copy)]
pub enum WindowType {
    Hann,
    Hamming,
    Blackman,
    Rectangular,
}

/// Generate a window function.
pub fn generate_window(window_type: WindowType, size: usize) -> Vec<f32> {
    match window_type {
        WindowType::Hann => hann_window(size),
        WindowType::Hamming => hamming_window(size),
        WindowType::Blackman => blackman_window(size),
        WindowType::Rectangular => vec![1.0; size],
    }
}

/// Hann window function.
pub fn hann_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / (size - 1) as f32).cos()))
        .collect()
}

/// Hamming window function.
pub fn hamming_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|n| 0.54 - 0.46 * (2.0 * PI * n as f32 / (size - 1) as f32).cos())
        .collect()
}

/// Blackman window function.
pub fn blackman_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|n| {
            let x = 2.0 * PI * n as f32 / (size - 1) as f32;
            0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
        })
        .collect()
}

/// Compute STFT (Short-Time Fourier Transform).
///
/// Returns a 2D array of complex magnitudes [n_freqs x n_frames].
/// n_freqs = n_fft / 2 + 1
pub fn stft(samples: &[f32], config: &StftConfig) -> Result<Vec<Vec<f32>>> {
    if samples.is_empty() {
        return Err(AnalysisError::AudioTooShort);
    }

    let n_fft = config.n_fft;
    let hop_length = config.hop_length;

    // Generate window
    let window = generate_window(config.window, n_fft);

    // Pad signal if centering
    let padded: Vec<f32>;
    let signal: &[f32] = if config.center {
        let pad_len = n_fft / 2;
        padded = std::iter::repeat(0.0f32)
            .take(pad_len)
            .chain(samples.iter().copied())
            .chain(std::iter::repeat(0.0f32).take(pad_len))
            .collect();
        &padded
    } else {
        samples
    };

    // Calculate number of frames
    let n_frames = if signal.len() >= n_fft {
        1 + (signal.len() - n_fft) / hop_length
    } else {
        0
    };

    if n_frames == 0 {
        return Err(AnalysisError::AudioTooShort);
    }

    let n_freqs = n_fft / 2 + 1;

    // Process frames in parallel - each thread gets its own FFT planner
    // Returns Vec of (frame_idx, magnitudes) pairs
    let frame_results: Vec<(usize, Vec<f32>)> = (0..n_frames)
        .into_par_iter()
        .map(|frame_idx| {
            // Each thread creates its own FFT planner (they're not thread-safe)
            let mut planner = RealFftPlanner::<f32>::new();
            let fft = planner.plan_fft_forward(n_fft);

            let mut input = vec![0.0f32; n_fft];
            let mut spectrum = fft.make_output_vec();

            let start = frame_idx * hop_length;

            // Copy and window the frame
            for (i, &w) in window.iter().enumerate() {
                input[i] = signal.get(start + i).copied().unwrap_or(0.0) * w;
            }

            // Compute FFT
            fft.process(&mut input, &mut spectrum).unwrap();

            // Extract magnitudes
            let magnitudes: Vec<f32> = spectrum
                .iter()
                .map(|c| (c.re * c.re + c.im * c.im).sqrt())
                .collect();

            (frame_idx, magnitudes)
        })
        .collect();

    // Transpose results to [n_freqs x n_frames] format
    let mut result = vec![vec![0.0f32; n_frames]; n_freqs];
    for (frame_idx, magnitudes) in frame_results {
        for (freq_idx, &mag) in magnitudes.iter().enumerate() {
            result[freq_idx][frame_idx] = mag;
        }
    }

    Ok(result)
}

/// Compute power spectrogram (squared magnitudes).
pub fn power_spectrogram(samples: &[f32], config: &StftConfig) -> Result<Vec<Vec<f32>>> {
    let mag_spec = stft(samples, config)?;

    Ok(mag_spec
        .into_iter()
        .map(|row| row.into_iter().map(|m| m * m).collect())
        .collect())
}

/// Convert power spectrogram to dB scale.
///
/// # Arguments
/// * `power_spec` - Power spectrogram [n_freqs x n_frames]
/// * `ref_value` - Reference value (usually max value in spec)
/// * `top_db` - Threshold to clip minimum value (e.g., 80.0)
pub fn power_to_db(power_spec: &[Vec<f32>], ref_value: f32, top_db: f32) -> Vec<Vec<f32>> {
    let ref_power = ref_value * ref_value;
    let amin = 1e-10f32; // Minimum amplitude to avoid log(0)

    power_spec
        .iter()
        .map(|row| {
            row.iter()
                .map(|&p| {
                    let db = 10.0 * (p.max(amin) / ref_power.max(amin)).log10();
                    db.max(-top_db)
                })
                .collect()
        })
        .collect()
}

/// Compute onset strength envelope.
///
/// This is a simplified version of librosa's onset_strength.
/// It computes the spectral flux (half-wave rectified difference).
pub fn onset_strength(samples: &[f32], _sample_rate: u32) -> Result<Vec<f32>> {
    let config = StftConfig {
        n_fft: 2048,
        hop_length: 512,
        window: WindowType::Hann,
        center: true,
    };

    let power_spec = power_spectrogram(samples, &config)?;
    let n_frames = power_spec[0].len();

    if n_frames < 2 {
        return Err(AnalysisError::AudioTooShort);
    }

    // Compute spectral flux
    let mut onset_env = vec![0.0f32; n_frames];

    for frame_idx in 1..n_frames {
        let mut flux = 0.0f32;

        for freq_idx in 0..power_spec.len() {
            let diff = power_spec[freq_idx][frame_idx] - power_spec[freq_idx][frame_idx - 1];
            // Half-wave rectification (only positive differences)
            flux += diff.max(0.0);
        }

        onset_env[frame_idx] = flux;
    }

    // Normalize
    let max_val = onset_env.iter().cloned().fold(0.0f32, f32::max);
    if max_val > 0.0 {
        for v in onset_env.iter_mut() {
            *v /= max_val;
        }
    }

    Ok(onset_env)
}

/// Get frequency bins for STFT result.
pub fn fft_frequencies(sample_rate: u32, n_fft: usize) -> Vec<f32> {
    let n_freqs = n_fft / 2 + 1;
    (0..n_freqs)
        .map(|i| i as f32 * sample_rate as f32 / n_fft as f32)
        .collect()
}

/// Get time positions for STFT frames.
pub fn frames_to_time(frames: &[usize], sample_rate: u32, hop_length: usize) -> Vec<f64> {
    frames
        .iter()
        .map(|&f| f as f64 * hop_length as f64 / sample_rate as f64)
        .collect()
}

/// Convert time positions to frame indices.
pub fn time_to_frames(times: &[f64], sample_rate: u32, hop_length: usize) -> Vec<usize> {
    times
        .iter()
        .map(|&t| (t * sample_rate as f64 / hop_length as f64).round() as usize)
        .collect()
}

/// Compute autocorrelation of a signal.
pub fn autocorrelate(signal: &[f32]) -> Vec<f32> {
    let n = signal.len();
    let mut result = vec![0.0f32; n];

    for lag in 0..n {
        let mut sum = 0.0f32;
        for i in 0..(n - lag) {
            sum += signal[i] * signal[i + lag];
        }
        result[lag] = sum;
    }

    // Normalize by zero-lag value
    if result[0] > 0.0 {
        let norm = result[0];
        for v in result.iter_mut() {
            *v /= norm;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hann_window() {
        let window = hann_window(1024);
        assert_eq!(window.len(), 1024);
        assert!((window[0]).abs() < 0.001); // Should start near 0
        assert!((window[512] - 1.0).abs() < 0.001); // Should peak at center
        assert!((window[1023]).abs() < 0.001); // Should end near 0
    }

    #[test]
    fn test_stft_basic() {
        // Generate a simple sine wave
        let sample_rate = 44100;
        let freq = 440.0;
        let duration = 0.1;
        let n_samples = (sample_rate as f32 * duration) as usize;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * PI * freq * i as f32 / sample_rate as f32).sin())
            .collect();

        let config = StftConfig::default();
        let result = stft(&samples, &config).unwrap();

        // Check dimensions
        let n_freqs = config.n_fft / 2 + 1;
        assert_eq!(result.len(), n_freqs);
        assert!(result[0].len() > 0);
    }

    #[test]
    fn test_autocorrelation() {
        let signal = vec![1.0, 0.5, 0.0, -0.5, -1.0, -0.5, 0.0, 0.5];
        let acf = autocorrelate(&signal);

        assert_eq!(acf.len(), signal.len());
        assert!((acf[0] - 1.0).abs() < 0.001); // Normalized zero-lag should be 1
    }
}
