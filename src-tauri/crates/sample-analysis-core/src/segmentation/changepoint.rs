//! Change-point based audio segmentation.
//!
//! Splits audio at points of significant spectral change.

use crate::error::Result;
use crate::fft::{power_spectrogram, StftConfig};
use crate::mel::mfcc;
use crate::types::AudioChunk;

/// Configuration for change-point segmentation.
#[derive(Debug, Clone)]
pub struct ChangePointConfig {
    /// Minimum segment duration in seconds (default 30.0)
    pub min_segment_duration: f64,
    /// Number of segments (if specified, overrides penalty-based detection)
    pub n_segments: Option<usize>,
    /// Hop length for feature extraction
    pub hop_length: usize,
}

impl Default for ChangePointConfig {
    fn default() -> Self {
        Self {
            min_segment_duration: 30.0,
            n_segments: None,
            hop_length: 512,
        }
    }
}

/// Segment audio by detecting change points in spectral features.
///
/// Uses a simplified change-point detection algorithm based on
/// spectral feature differences.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Change-point configuration
///
/// # Returns
/// Vector of AudioChunks at change points
pub fn segment_by_changepoint(
    samples: &[f32],
    sample_rate: u32,
    config: &ChangePointConfig,
) -> Result<Vec<AudioChunk>> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    // Extract features
    let features = extract_features(samples, sample_rate, config)?;

    if features.is_empty() {
        let duration = samples.len() as f64 / sample_rate as f64;
        return Ok(vec![AudioChunk {
            start_sample: 0,
            end_sample: samples.len(),
            start_time: 0.0,
            end_time: duration,
            duration,
            path: None,
        }]);
    }

    // Detect change points
    let min_segment_frames =
        (config.min_segment_duration * sample_rate as f64 / config.hop_length as f64) as usize;

    let change_points = if let Some(n) = config.n_segments {
        // Find exactly n-1 change points
        find_n_changepoints(&features, n.saturating_sub(1), min_segment_frames)
    } else {
        // Use cost-based detection
        find_changepoints_by_cost(&features, min_segment_frames)
    };

    // Convert frame indices to samples and create chunks
    let mut chunks = Vec::new();
    let mut prev_sample = 0usize;

    for &cp_frame in &change_points {
        let sample = (cp_frame * config.hop_length).min(samples.len());

        if sample > prev_sample {
            let start_time = prev_sample as f64 / sample_rate as f64;
            let end_time = sample as f64 / sample_rate as f64;

            chunks.push(AudioChunk {
                start_sample: prev_sample,
                end_sample: sample,
                start_time,
                end_time,
                duration: end_time - start_time,
                path: None,
            });
        }

        prev_sample = sample;
    }

    // Add final chunk
    if prev_sample < samples.len() {
        let start_time = prev_sample as f64 / sample_rate as f64;
        let end_time = samples.len() as f64 / sample_rate as f64;

        chunks.push(AudioChunk {
            start_sample: prev_sample,
            end_sample: samples.len(),
            start_time,
            end_time,
            duration: end_time - start_time,
            path: None,
        });
    }

    Ok(chunks)
}

/// Extract features for change-point detection.
/// Returns features as [n_frames x n_features].
fn extract_features(
    samples: &[f32],
    sample_rate: u32,
    config: &ChangePointConfig,
) -> Result<Vec<Vec<f64>>> {
    // Use MFCCs as primary features
    let mfccs = mfcc(samples, sample_rate, 13, 128, 2048, config.hop_length)?;

    // Also get spectral centroid
    let stft_config = StftConfig {
        n_fft: 2048,
        hop_length: config.hop_length,
        ..Default::default()
    };
    let power_spec = power_spectrogram(samples, &stft_config)?;

    let n_frames = mfccs[0].len();

    // Compute spectral centroid per frame
    let mut centroid = vec![0.0f64; n_frames];
    let freqs: Vec<f64> = (0..power_spec.len())
        .map(|i| i as f64 * sample_rate as f64 / 2048.0)
        .collect();

    for frame in 0..n_frames {
        let mut weighted_sum = 0.0f64;
        let mut total = 0.0f64;

        for (freq_idx, &freq) in freqs.iter().enumerate() {
            let power = power_spec[freq_idx][frame] as f64;
            weighted_sum += freq * power;
            total += power;
        }

        if total > 0.0 {
            centroid[frame] = weighted_sum / total;
        }
    }

    // Combine features: MFCCs + centroid
    let mut features = Vec::with_capacity(n_frames);
    for frame in 0..n_frames {
        let mut frame_features = Vec::with_capacity(14);
        for mfcc_idx in 0..13 {
            frame_features.push(mfccs[mfcc_idx][frame] as f64);
        }
        frame_features.push(centroid[frame] / 10000.0); // Normalize centroid
        features.push(frame_features);
    }

    Ok(features)
}

/// Find exactly n change points using binary segmentation.
fn find_n_changepoints(
    features: &[Vec<f64>],
    n: usize,
    min_segment_frames: usize,
) -> Vec<usize> {
    if n == 0 || features.len() < min_segment_frames * 2 {
        return Vec::new();
    }

    // Binary segmentation: recursively find the best split point
    let mut segments: Vec<(usize, usize)> = vec![(0, features.len())];
    let mut change_points = Vec::new();

    for _ in 0..n {
        // Find segment with highest cost reduction
        let mut best_gain = f64::NEG_INFINITY;
        let mut best_segment_idx = 0;
        let mut best_split = 0;

        for (seg_idx, &(start, end)) in segments.iter().enumerate() {
            if end - start < min_segment_frames * 2 {
                continue;
            }

            // Find best split in this segment
            let (split, gain) = find_best_split(features, start, end, min_segment_frames);

            if gain > best_gain {
                best_gain = gain;
                best_segment_idx = seg_idx;
                best_split = split;
            }
        }

        if best_gain == f64::NEG_INFINITY {
            break;
        }

        // Split the segment
        let (start, end) = segments.remove(best_segment_idx);
        segments.push((start, best_split));
        segments.push((best_split, end));
        change_points.push(best_split);
    }

    change_points.sort();
    change_points
}

/// Find the best split point in a segment.
fn find_best_split(
    features: &[Vec<f64>],
    start: usize,
    end: usize,
    min_size: usize,
) -> (usize, f64) {
    let segment = &features[start..end];
    let total_cost = segment_cost(segment);

    let mut best_split = start + min_size;
    let mut best_gain = f64::NEG_INFINITY;

    for split in (start + min_size)..=(end - min_size) {
        let left_cost = segment_cost(&features[start..split]);
        let right_cost = segment_cost(&features[split..end]);
        let combined_cost = left_cost + right_cost;
        let gain = total_cost - combined_cost;

        if gain > best_gain {
            best_gain = gain;
            best_split = split;
        }
    }

    (best_split, best_gain)
}

/// Find change points using cost-based detection.
fn find_changepoints_by_cost(features: &[Vec<f64>], min_segment_frames: usize) -> Vec<usize> {
    if features.len() < min_segment_frames * 2 {
        return Vec::new();
    }

    // Compute feature difference signal
    let mut diff_signal = vec![0.0f64; features.len()];

    for i in 1..features.len() {
        let dist = euclidean_distance(&features[i - 1], &features[i]);
        diff_signal[i] = dist;
    }

    // Find peaks in difference signal that are above threshold
    let threshold = compute_threshold(&diff_signal);
    let mut change_points = Vec::new();
    let mut last_cp = 0usize;

    for i in 1..diff_signal.len() - 1 {
        // Check if local maximum and above threshold
        if diff_signal[i] > diff_signal[i - 1]
            && diff_signal[i] > diff_signal[i + 1]
            && diff_signal[i] > threshold
            && i - last_cp >= min_segment_frames
        {
            change_points.push(i);
            last_cp = i;
        }
    }

    change_points
}

/// Compute cost of a segment (sum of variances).
fn segment_cost(features: &[Vec<f64>]) -> f64 {
    if features.is_empty() || features[0].is_empty() {
        return 0.0;
    }

    let n = features.len() as f64;
    let n_features = features[0].len();

    let mut total_variance = 0.0f64;

    for f_idx in 0..n_features {
        // Mean
        let mean: f64 = features.iter().map(|f| f[f_idx]).sum::<f64>() / n;

        // Variance
        let variance: f64 = features.iter().map(|f| (f[f_idx] - mean).powi(2)).sum::<f64>() / n;

        total_variance += variance;
    }

    total_variance * n
}

/// Euclidean distance between feature vectors.
fn euclidean_distance(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| (x - y).powi(2))
        .sum::<f64>()
        .sqrt()
}

/// Compute adaptive threshold for change detection.
fn compute_threshold(signal: &[f64]) -> f64 {
    if signal.is_empty() {
        return 0.0;
    }

    let mean: f64 = signal.iter().sum::<f64>() / signal.len() as f64;
    let variance: f64 =
        signal.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / signal.len() as f64;
    let std_dev = variance.sqrt();

    mean + 1.5 * std_dev
}

/// Segment audio file by change points.
pub fn segment_by_changepoint_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<ChangePointConfig>,
) -> Result<Vec<AudioChunk>> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    segment_by_changepoint(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_euclidean_distance() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![3.0, 4.0, 0.0];

        let dist = euclidean_distance(&a, &b);
        assert!((dist - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_segment_cost() {
        // Constant features should have zero cost
        let features = vec![vec![1.0, 2.0]; 10];
        let cost = segment_cost(&features);
        assert!(cost.abs() < 0.001);

        // Varying features should have non-zero cost
        let features: Vec<Vec<f64>> = (0..10).map(|i| vec![i as f64, i as f64]).collect();
        let cost = segment_cost(&features);
        assert!(cost > 0.0);
    }

    #[test]
    fn test_changepoint_detection() {
        // Generate audio with two distinct sections
        let sr = 22050;
        let section_duration = 5.0; // 5 seconds each
        let n_samples_section = (sr as f64 * section_duration) as usize;

        let mut samples = Vec::new();

        // Section 1: Low frequency
        for i in 0..n_samples_section {
            samples.push((2.0 * std::f32::consts::PI * 100.0 * i as f32 / sr as f32).sin());
        }

        // Section 2: High frequency
        for i in 0..n_samples_section {
            samples.push((2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr as f32).sin());
        }

        let config = ChangePointConfig {
            min_segment_duration: 2.0,
            n_segments: Some(2),
            ..Default::default()
        };

        let chunks = segment_by_changepoint(&samples, sr, &config).unwrap();

        // Should detect 2 segments
        assert_eq!(chunks.len(), 2, "Expected 2 chunks, got {}", chunks.len());
    }
}
