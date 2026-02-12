//! Musical key detection analyzer.
//!
//! Uses chroma features and correlation with Krumhansl-Kessler key profiles.

use crate::error::Result;
use crate::fft::{fft_frequencies, power_spectrogram, StftConfig};
use crate::types::KeyResult;

/// Krumhansl-Kessler key profile for major keys.
/// Values represent correlation weights for each pitch class (C, C#, D, ..., B).
const MAJOR_PROFILE: [f64; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/// Krumhansl-Kessler key profile for minor keys.
const MINOR_PROFILE: [f64; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/// Key names for major keys.
const MAJOR_KEYS: [&str; 12] = [
    "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

/// Key names for minor keys.
const MINOR_KEYS: [&str; 12] = [
    "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

/// Configuration for key detection.
#[derive(Debug, Clone)]
pub struct KeyConfig {
    /// FFT size for chroma computation
    pub n_fft: usize,
    /// Hop length
    pub hop_length: usize,
    /// Number of alternate keys to return
    pub num_alternates: usize,
    /// Include chroma profile in result
    pub include_chroma: bool,
}

impl Default for KeyConfig {
    fn default() -> Self {
        Self {
            n_fft: 4096,
            hop_length: 512,
            num_alternates: 3,
            include_chroma: false,
        }
    }
}

/// Analyze musical key.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Key detection configuration
///
/// # Returns
/// KeyResult with detected key and mode
pub fn analyze_key(samples: &[f32], sample_rate: u32, config: &KeyConfig) -> Result<KeyResult> {
    // Compute chroma features
    let chroma = compute_chroma(samples, sample_rate, config)?;

    // Average chroma across time
    let chroma_avg = average_chroma(&chroma);

    // Normalize chroma profile
    let sum: f64 = chroma_avg.iter().sum();
    let chroma_norm: Vec<f64> = if sum > 0.0 {
        chroma_avg.iter().map(|&c| c / sum).collect()
    } else {
        chroma_avg.clone()
    };

    // Correlate with all 24 key profiles
    let mut correlations: Vec<(String, String, f64)> = Vec::with_capacity(24);

    // Major keys
    for rotation in 0..12 {
        let rotated_profile = rotate_profile(&MAJOR_PROFILE, rotation);
        let corr = pearson_correlation(&chroma_norm, &rotated_profile);
        correlations.push((MAJOR_KEYS[rotation].to_string(), "major".to_string(), corr));
    }

    // Minor keys
    for rotation in 0..12 {
        let rotated_profile = rotate_profile(&MINOR_PROFILE, rotation);
        let corr = pearson_correlation(&chroma_norm, &rotated_profile);
        correlations.push((MINOR_KEYS[rotation].to_string(), "minor".to_string(), corr));
    }

    // Sort by correlation (descending)
    correlations.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // Best match
    let (key, mode, raw_confidence) = correlations[0].clone();

    // Map correlation [-1, 1] to confidence [0, 1]
    let confidence = (raw_confidence + 1.0) / 2.0;

    // Alternate keys
    let alternate_keys = if config.num_alternates > 0 {
        Some(
            correlations[1..=config.num_alternates.min(correlations.len() - 1)]
                .iter()
                .map(|(k, m, c)| (k.clone(), m.clone(), (*c + 1.0) / 2.0))
                .collect(),
        )
    } else {
        None
    };

    // Chroma profile
    let chroma_profile = if config.include_chroma {
        Some(chroma_norm)
    } else {
        None
    };

    Ok(KeyResult {
        key,
        mode,
        confidence,
        alternate_keys,
        chroma_profile,
    })
}

/// Compute chroma features from audio.
fn compute_chroma(samples: &[f32], sample_rate: u32, config: &KeyConfig) -> Result<Vec<Vec<f64>>> {
    // Compute power spectrogram
    let stft_config = StftConfig {
        n_fft: config.n_fft,
        hop_length: config.hop_length,
        ..Default::default()
    };
    let power_spec = power_spectrogram(samples, &stft_config)?;

    let freqs = fft_frequencies(sample_rate, config.n_fft);
    let n_frames = power_spec[0].len();

    // Initialize chroma (12 pitch classes x n_frames)
    let mut chroma = vec![vec![0.0f64; n_frames]; 12];

    // Map each frequency bin to pitch class
    for (freq_idx, &freq) in freqs.iter().enumerate() {
        if freq <= 0.0 {
            continue;
        }

        // Convert frequency to MIDI note number
        let midi_note = 12.0 * (freq / 440.0).log2() + 69.0;

        if midi_note < 0.0 || midi_note > 127.0 {
            continue;
        }

        // Pitch class (0-11)
        let pitch_class = (midi_note.round() as i32 % 12) as usize;

        // Add power to this pitch class for each frame
        for frame_idx in 0..n_frames {
            chroma[pitch_class][frame_idx] += power_spec[freq_idx][frame_idx] as f64;
        }
    }

    Ok(chroma)
}

/// Average chroma across time frames.
fn average_chroma(chroma: &[Vec<f64>]) -> Vec<f64> {
    chroma
        .iter()
        .map(|pitch_class| {
            if pitch_class.is_empty() {
                0.0
            } else {
                pitch_class.iter().sum::<f64>() / pitch_class.len() as f64
            }
        })
        .collect()
}

/// Rotate a key profile by n semitones.
fn rotate_profile(profile: &[f64; 12], rotation: usize) -> Vec<f64> {
    (0..12).map(|i| profile[(12 + i - rotation) % 12]).collect()
}

/// Compute Pearson correlation coefficient.
fn pearson_correlation(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.is_empty() {
        return 0.0;
    }

    let n = x.len() as f64;
    let mean_x: f64 = x.iter().sum::<f64>() / n;
    let mean_y: f64 = y.iter().sum::<f64>() / n;

    let mut cov = 0.0f64;
    let mut var_x = 0.0f64;
    let mut var_y = 0.0f64;

    for i in 0..x.len() {
        let dx = x[i] - mean_x;
        let dy = y[i] - mean_y;
        cov += dx * dy;
        var_x += dx * dx;
        var_y += dy * dy;
    }

    let denom = (var_x * var_y).sqrt();
    if denom > 0.0 {
        cov / denom
    } else {
        0.0
    }
}

/// Analyze key from audio file.
pub fn analyze_key_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<KeyConfig>,
) -> Result<KeyResult> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    analyze_key(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rotate_profile() {
        let profile = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0];

        // No rotation
        let rotated = rotate_profile(&profile, 0);
        assert_eq!(rotated[0], 1.0);

        // Rotate by 1 (C# major would use C major profile starting from C#)
        let rotated = rotate_profile(&profile, 1);
        assert_eq!(rotated[0], 12.0); // B becomes the new 0
    }

    #[test]
    fn test_pearson_correlation() {
        // Perfect correlation
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        let corr = pearson_correlation(&x, &y);
        assert!((corr - 1.0).abs() < 0.001);

        // Negative correlation
        let y_neg = vec![10.0, 8.0, 6.0, 4.0, 2.0];
        let corr_neg = pearson_correlation(&x, &y_neg);
        assert!((corr_neg - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_key_detection_c_major() {
        // Generate C major triad (C, E, G)
        let sr = 44100;
        let duration = 2.0;
        let n_samples = (sr as f32 * duration) as usize;

        let c_freq = 261.63; // C4
        let e_freq = 329.63; // E4
        let g_freq = 392.00; // G4

        let samples: Vec<f32> = (0..n_samples)
            .map(|i| {
                let t = i as f32 / sr as f32;
                let c = (2.0 * std::f32::consts::PI * c_freq * t).sin();
                let e = (2.0 * std::f32::consts::PI * e_freq * t).sin();
                let g = (2.0 * std::f32::consts::PI * g_freq * t).sin();
                (c + e + g) / 3.0
            })
            .collect();

        let config = KeyConfig {
            include_chroma: true,
            ..Default::default()
        };

        let result = analyze_key(&samples, sr, &config).unwrap();

        // Should detect C major (or relative minor Am)
        // C major and A minor are closely related
        assert!(
            result.key == "C" || result.key == "A",
            "Key should be C or A, got {}",
            result.key
        );

        // Confidence should be reasonable
        assert!(result.confidence > 0.3);

        // Should have chroma profile
        assert!(result.chroma_profile.is_some());
        let chroma = result.chroma_profile.unwrap();
        assert_eq!(chroma.len(), 12);
    }
}
