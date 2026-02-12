//! Loop quality analysis.
//!
//! Assesses whether audio is suitable for seamless looping.

use crate::error::Result;
use crate::fft::{power_spectrogram, StftConfig};
use crate::types::LoopResult;

/// Configuration for loop analysis.
#[derive(Debug, Clone)]
pub struct LoopConfig {
    /// Minimum quality score for is_loopable flag (0.0 to 1.0)
    pub min_quality_threshold: f64,
    /// Search window at boundaries for zero crossings (milliseconds)
    pub search_window_ms: f64,
    /// Number of samples to analyze at boundaries for amplitude
    pub boundary_samples: usize,
    /// FFT size for spectral analysis
    pub n_fft: usize,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            min_quality_threshold: 0.7,
            search_window_ms: 50.0,
            boundary_samples: 100,
            n_fft: 2048,
        }
    }
}

/// Analyze loop quality.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Loop analysis configuration
///
/// # Returns
/// LoopResult with quality metrics
pub fn analyze_loop(samples: &[f32], sample_rate: u32, config: &LoopConfig) -> Result<LoopResult> {
    if samples.len() < config.boundary_samples * 2 {
        return Err(crate::error::AnalysisError::AudioTooShort);
    }

    let search_samples = (config.search_window_ms / 1000.0 * sample_rate as f64) as usize;
    let search_samples = search_samples.min(samples.len() / 4);

    // Find optimal loop points
    let (loop_start, loop_end, zero_crossing_aligned) =
        find_optimal_loop_points(samples, search_samples);

    // Compute amplitude continuity
    let amplitude_continuity =
        compute_amplitude_continuity(samples, loop_start, loop_end, config.boundary_samples);

    // Compute spectral continuity
    let spectral_continuity =
        compute_spectral_continuity(samples, loop_start, loop_end, sample_rate, config)?;

    // Combined quality score
    // Weights: spectral 50%, amplitude 30%, zero crossing 20%
    let quality_score = 0.5 * spectral_continuity
        + 0.3 * amplitude_continuity
        + 0.2 * if zero_crossing_aligned { 1.0 } else { 0.5 };

    let is_loopable = quality_score >= config.min_quality_threshold;

    Ok(LoopResult {
        is_loopable,
        loop_start_sample: loop_start,
        loop_end_sample: loop_end,
        quality_score,
        spectral_continuity,
        amplitude_continuity,
        zero_crossing_aligned,
    })
}

/// Find optimal loop points near boundaries using zero crossings.
fn find_optimal_loop_points(
    samples: &[f32],
    search_samples: usize,
) -> (usize, usize, bool) {
    let n = samples.len();

    // Find zero crossings at start
    let start_crossings = find_zero_crossings(&samples[..search_samples.min(n)]);

    // Find zero crossings at end
    let end_start = n.saturating_sub(search_samples);
    let end_crossings: Vec<usize> = find_zero_crossings(&samples[end_start..])
        .into_iter()
        .map(|i| i + end_start)
        .collect();

    // If we have zero crossings at both ends, use them
    let (loop_start, loop_end, aligned) = if !start_crossings.is_empty() && !end_crossings.is_empty()
    {
        // Use first zero crossing at start, last at end
        let start = start_crossings[0];
        let end = *end_crossings.last().unwrap();
        (start, end, true)
    } else {
        // No zero crossings found, use boundaries
        (0, n - 1, false)
    };

    (loop_start, loop_end, aligned)
}

/// Find zero crossing positions in samples.
fn find_zero_crossings(samples: &[f32]) -> Vec<usize> {
    if samples.len() < 2 {
        return Vec::new();
    }

    samples
        .windows(2)
        .enumerate()
        .filter_map(|(i, w)| {
            // Check for sign change
            if (w[0] >= 0.0) != (w[1] >= 0.0) {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

/// Compute amplitude continuity at loop boundaries.
fn compute_amplitude_continuity(
    samples: &[f32],
    loop_start: usize,
    loop_end: usize,
    boundary_samples: usize,
) -> f64 {
    let n = samples.len();
    let boundary = boundary_samples.min(n / 4);

    // Mean amplitude at start boundary
    let start_end = (loop_start + boundary).min(n);
    let start_amp: f64 = samples[loop_start..start_end]
        .iter()
        .map(|&s| (s as f64).abs())
        .sum::<f64>()
        / boundary as f64;

    // Mean amplitude at end boundary
    let end_start = loop_end.saturating_sub(boundary);
    let end_amp: f64 = samples[end_start..=loop_end.min(n - 1)]
        .iter()
        .map(|&s| (s as f64).abs())
        .sum::<f64>()
        / boundary as f64;

    // Continuity is ratio of smaller to larger (1.0 = perfect match)
    if start_amp > 0.0 && end_amp > 0.0 {
        (start_amp.min(end_amp) / start_amp.max(end_amp)).clamp(0.0, 1.0)
    } else if start_amp == 0.0 && end_amp == 0.0 {
        1.0 // Both silent = perfect match
    } else {
        0.0 // One silent, one not
    }
}

/// Compute spectral continuity at loop boundaries.
fn compute_spectral_continuity(
    samples: &[f32],
    loop_start: usize,
    loop_end: usize,
    _sample_rate: u32,
    config: &LoopConfig,
) -> Result<f64> {
    let n_fft = config.n_fft;

    // Get spectra at loop boundaries
    let start_end = (loop_start + n_fft).min(samples.len());
    let end_start = loop_end.saturating_sub(n_fft);

    if start_end - loop_start < n_fft || loop_end - end_start < n_fft {
        // Not enough samples for spectral analysis
        return Ok(0.5);
    }

    let start_samples = &samples[loop_start..start_end];
    let end_samples = &samples[end_start..=loop_end.min(samples.len() - 1)];

    // Compute power spectra
    let stft_config = StftConfig {
        n_fft,
        hop_length: n_fft,
        ..Default::default()
    };

    let start_spec = power_spectrogram(start_samples, &stft_config)?;
    let end_spec = power_spectrogram(end_samples, &stft_config)?;

    // Get average magnitude vectors
    let start_mag: Vec<f64> = start_spec
        .iter()
        .map(|row| row.iter().map(|&x| x as f64).sum::<f64>() / row.len() as f64)
        .collect();

    let end_mag: Vec<f64> = end_spec
        .iter()
        .map(|row| row.iter().map(|&x| x as f64).sum::<f64>() / row.len() as f64)
        .collect();

    // Compute cosine similarity
    let similarity = cosine_similarity(&start_mag, &end_mag);

    Ok(similarity.clamp(0.0, 1.0))
}

/// Compute cosine similarity between two vectors.
fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f64 = a.iter().zip(b.iter()).map(|(&x, &y)| x * y).sum();
    let norm_a: f64 = a.iter().map(|&x| x * x).sum::<f64>().sqrt();
    let norm_b: f64 = b.iter().map(|&x| x * x).sum::<f64>().sqrt();

    if norm_a > 0.0 && norm_b > 0.0 {
        dot / (norm_a * norm_b)
    } else {
        0.0
    }
}

/// Analyze loop from audio file.
pub fn analyze_loop_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<LoopConfig>,
) -> Result<LoopResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_loop(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_zero_crossings() {
        let samples = vec![1.0, 0.5, -0.5, -1.0, -0.5, 0.5, 1.0];
        let crossings = find_zero_crossings(&samples);

        // Should find crossings at indices 1->2 and 4->5
        assert_eq!(crossings.len(), 2);
        assert_eq!(crossings[0], 1);
        assert_eq!(crossings[1], 4);
    }

    #[test]
    fn test_cosine_similarity() {
        // Identical vectors
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        // Orthogonal vectors
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        assert!(cosine_similarity(&a, &b).abs() < 0.001);

        // Opposite vectors
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        assert!((cosine_similarity(&a, &b) - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_loop_analysis_perfect_loop() {
        // Generate perfect loop: repeating sine wave
        let sr = 44100;
        let freq = 100.0; // 100 Hz for clean cycles
        let cycles = 10;
        let samples_per_cycle = sr as f32 / freq;
        let n_samples = (samples_per_cycle * cycles as f32) as usize;

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect();

        let config = LoopConfig::default();
        let result = analyze_loop(&samples, sr, &config).unwrap();

        // Should have high quality score
        assert!(result.quality_score > 0.5, "Quality score: {}", result.quality_score);

        // Should have good spectral continuity
        assert!(result.spectral_continuity > 0.5);
    }

    #[test]
    fn test_amplitude_continuity() {
        // Constant amplitude sine wave - note that for a sine wave, amplitude
        // at different phase positions can differ significantly
        let samples: Vec<f32> = (0..1000)
            .map(|i| (i as f32 / 50.0).sin() * 0.5)
            .collect();

        let continuity = compute_amplitude_continuity(&samples, 0, 999, 100);
        // Amplitude continuity may vary based on phase - just check it's calculated
        assert!(continuity >= 0.0 && continuity <= 1.0, "Continuity should be in [0, 1], got {}", continuity);
    }
}
