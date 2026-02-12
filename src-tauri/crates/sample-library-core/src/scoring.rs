//! Applicability scoring algorithm for sample quality and usability.
//!
//! Computes weighted scores based on:
//! - Technical quality (35%): RMS level, crest factor, clipping
//! - Loop quality (25%): Seamless loop potential
//! - Spectral balance (20%): Centroid position, flatness
//! - Usability (20%): Duration, sample rate appropriateness

use serde::{Deserialize, Serialize};

// Ideal ranges for scoring
const IDEAL_RMS_DB: f64 = -18.0; // Standard mastering headroom
const IDEAL_RMS_TOLERANCE: f64 = 6.0; // +/- 6dB from ideal
const IDEAL_CREST_MIN: f64 = 6.0; // Minimum crest factor for punch
const IDEAL_CREST_MAX: f64 = 12.0; // Maximum crest factor (too dynamic = weak)
const IDEAL_CENTROID_HZ: f64 = 3000.0; // Ideal brightness for balanced mix
const CENTROID_TOLERANCE_HZ: f64 = 2000.0; // Acceptable range around ideal

const MIN_USABLE_DURATION: f64 = 0.1; // 100ms minimum
const MAX_USABLE_DURATION: f64 = 30.0; // 30s maximum (beyond this = full track)
const MIN_SAMPLE_RATE: i32 = 44100; // CD quality minimum

/// Individual score components for transparency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreComponents {
    /// Technical quality score (0-100).
    pub quality: f64,
    /// Loop quality score (0-100).
    pub loop_score: f64,
    /// Spectral balance score (0-100).
    pub spectral: f64,
    /// Usability score (0-100).
    pub usability: f64,
    /// Total weighted score (0-100).
    pub total: f64,
}

/// Compute technical quality score (0-100).
///
/// Evaluates:
/// - RMS level relative to ideal (-18dB)
/// - Crest factor (peak-to-RMS ratio) for punch
/// - Absence of clipping
/// - Dynamic range preservation
pub fn compute_quality_score(
    rms_db: Option<f64>,
    _peak_db: Option<f64>,
    crest_factor: Option<f64>,
    dynamic_range: Option<f64>,
    clipping_detected: Option<bool>,
) -> f64 {
    if rms_db.is_none() && crest_factor.is_none() {
        return 50.0; // Neutral score if no data
    }

    let mut penalties: Vec<(f64, f64)> = Vec::new(); // (weight, score)

    // RMS level scoring (40% of quality)
    if let Some(rms) = rms_db {
        let rms_deviation = (rms - IDEAL_RMS_DB).abs();
        let rms_score = if rms_deviation <= IDEAL_RMS_TOLERANCE {
            100.0
        } else {
            // Gradual penalty beyond tolerance
            let excess = rms_deviation - IDEAL_RMS_TOLERANCE;
            (100.0 - excess * 5.0).max(0.0) // -5 points per dB
        };
        penalties.push((0.4, rms_score));
    }

    // Crest factor scoring (30% of quality)
    if let Some(crest) = crest_factor {
        let crest_score = if crest >= IDEAL_CREST_MIN && crest <= IDEAL_CREST_MAX {
            100.0
        } else if crest < IDEAL_CREST_MIN {
            // Too compressed - sounds flat
            let deficit = IDEAL_CREST_MIN - crest;
            (100.0 - deficit * 10.0).max(0.0)
        } else {
            // Too dynamic - sounds weak
            let excess = crest - IDEAL_CREST_MAX;
            (100.0 - excess * 5.0).max(0.0)
        };
        penalties.push((0.3, crest_score));
    }

    // Clipping penalty (20% of quality)
    if let Some(clipping) = clipping_detected {
        let clipping_score = if clipping { 0.0 } else { 100.0 };
        penalties.push((0.2, clipping_score));
    }

    // Dynamic range (10% of quality)
    if let Some(dr) = dynamic_range {
        let dr_score = if dr >= 12.0 {
            100.0
        } else if dr >= 6.0 {
            50.0 + ((dr - 6.0) / 6.0) * 50.0
        } else {
            (dr / 6.0) * 50.0
        };
        penalties.push((0.1, dr_score));
    }

    if penalties.is_empty() {
        return 50.0;
    }

    // Compute weighted average
    let total_weight: f64 = penalties.iter().map(|(w, _)| w).sum();
    let weighted_sum: f64 = penalties.iter().map(|(w, s)| w * s).sum();
    weighted_sum / total_weight
}

/// Compute loop quality score (0-100).
pub fn compute_loop_score(loop_quality: Option<f64>, is_loopable: Option<bool>) -> f64 {
    if let Some(quality) = loop_quality {
        // loop_quality is already 0-100
        return quality.clamp(0.0, 100.0);
    }

    if let Some(loopable) = is_loopable {
        return if loopable { 75.0 } else { 25.0 };
    }

    // No loop analysis - neutral score
    50.0
}

/// Compute spectral balance score (0-100).
///
/// Evaluates:
/// - Centroid position (brightness) relative to ideal ~3kHz
/// - Spectral flatness (tonal vs noisy character)
pub fn compute_spectral_score(
    spectral_centroid: Option<f64>,
    spectral_flatness: Option<f64>,
) -> f64 {
    if spectral_centroid.is_none() && spectral_flatness.is_none() {
        return 50.0;
    }

    let mut scores: Vec<(f64, f64)> = Vec::new(); // (weight, score)

    // Centroid scoring (70% of spectral)
    if let Some(centroid) = spectral_centroid {
        let deviation = (centroid - IDEAL_CENTROID_HZ).abs();
        let centroid_score = if deviation <= CENTROID_TOLERANCE_HZ {
            100.0 - (deviation / CENTROID_TOLERANCE_HZ * 30.0)
        } else {
            let excess = deviation - CENTROID_TOLERANCE_HZ;
            (70.0 - (excess / 1000.0) * 20.0).max(0.0)
        };
        scores.push((0.7, centroid_score));
    }

    // Flatness scoring (30% of spectral)
    // Mid-range flatness (0.3-0.6) is most versatile
    if let Some(flatness) = spectral_flatness {
        let flatness_score = if flatness >= 0.3 && flatness <= 0.6 {
            100.0
        } else if flatness < 0.3 {
            // Very tonal - still useful but limited
            60.0 + (flatness / 0.3) * 40.0
        } else {
            // Very noisy - context-dependent
            let excess = flatness - 0.6;
            (100.0 - excess * 100.0).max(50.0)
        };
        scores.push((0.3, flatness_score));
    }

    if scores.is_empty() {
        return 50.0;
    }

    let total_weight: f64 = scores.iter().map(|(w, _)| w).sum();
    scores.iter().map(|(w, s)| w * s).sum::<f64>() / total_weight
}

/// Compute usability score (0-100).
///
/// Evaluates:
/// - Duration appropriateness (0.1-30s ideal)
/// - Sample rate quality (44.1kHz+ required)
pub fn compute_usability_score(duration: Option<f64>, sample_rate: Option<i32>) -> f64 {
    let mut scores: Vec<(f64, f64)> = Vec::new(); // (weight, score)

    // Duration scoring (60% of usability)
    if let Some(dur) = duration {
        let duration_score = if dur >= MIN_USABLE_DURATION && dur <= MAX_USABLE_DURATION {
            // Ideal range - perfect score
            100.0
        } else if dur < MIN_USABLE_DURATION {
            // Too short - may be just a click
            (dur / MIN_USABLE_DURATION) * 50.0
        } else {
            // Too long - may be a full track
            let excess = dur - MAX_USABLE_DURATION;
            (100.0 - (excess / 60.0) * 50.0).max(20.0) // -50 per minute over
        };
        scores.push((0.6, duration_score));
    }

    // Sample rate scoring (40% of usability)
    if let Some(sr) = sample_rate {
        let sr_score = if sr >= MIN_SAMPLE_RATE {
            100.0
        } else if sr >= 22050 {
            70.0 // Acceptable but not ideal
        } else {
            30.0 // Low quality
        };
        scores.push((0.4, sr_score));
    }

    if scores.is_empty() {
        return 50.0;
    }

    let total_weight: f64 = scores.iter().map(|(w, _)| w).sum();
    scores.iter().map(|(w, s)| w * s).sum::<f64>() / total_weight
}

/// Compute overall applicability score with component breakdown.
///
/// Weights:
/// - Technical quality: 35%
/// - Loop quality: 25%
/// - Spectral balance: 20%
/// - Usability: 20%
pub fn compute_applicability_score(
    // Quality metrics
    rms_db: Option<f64>,
    peak_db: Option<f64>,
    crest_factor: Option<f64>,
    dynamic_range: Option<f64>,
    clipping_detected: Option<bool>,
    // Loop metrics
    loop_quality: Option<f64>,
    is_loopable: Option<bool>,
    // Spectral metrics
    spectral_centroid: Option<f64>,
    spectral_flatness: Option<f64>,
    // Usability metrics
    duration: Option<f64>,
    sample_rate: Option<i32>,
) -> ScoreComponents {
    let quality = compute_quality_score(rms_db, peak_db, crest_factor, dynamic_range, clipping_detected);
    let loop_score = compute_loop_score(loop_quality, is_loopable);
    let spectral = compute_spectral_score(spectral_centroid, spectral_flatness);
    let usability = compute_usability_score(duration, sample_rate);

    // Weighted total
    let total = (quality * 0.35) + (loop_score * 0.25) + (spectral * 0.20) + (usability * 0.20);

    ScoreComponents {
        quality: (quality * 10.0).round() / 10.0,
        loop_score: (loop_score * 10.0).round() / 10.0,
        spectral: (spectral * 10.0).round() / 10.0,
        usability: (usability * 10.0).round() / 10.0,
        total: (total * 10.0).round() / 10.0,
    }
}

/// Score a sample from the database.
pub fn score_sample(sample: &crate::db::Sample) -> ScoreComponents {
    compute_applicability_score(
        sample.rms_db,
        sample.peak_db,
        sample.crest_factor,
        sample.dynamic_range,
        sample.clipping_detected,
        sample.loop_quality,
        sample.is_loopable,
        sample.spectral_centroid,
        sample.spectral_flatness,
        sample.duration,
        sample.sample_rate,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quality_score_ideal() {
        // Ideal sample: -18dB RMS, 9dB crest factor, no clipping, 15dB dynamic range
        let score = compute_quality_score(
            Some(-18.0),
            Some(-9.0),
            Some(9.0),
            Some(15.0),
            Some(false),
        );
        assert!(score > 90.0, "Ideal sample should score > 90, got {}", score);
    }

    #[test]
    fn test_quality_score_clipping() {
        // Sample with clipping
        let score = compute_quality_score(
            Some(-18.0),
            Some(-9.0),
            Some(9.0),
            Some(15.0),
            Some(true),
        );
        assert!(score < 90.0, "Clipping sample should score < 90, got {}", score);
    }

    #[test]
    fn test_loop_score() {
        assert!(compute_loop_score(Some(85.0), None) > 80.0);
        assert!(compute_loop_score(None, Some(true)) > 50.0);
        assert!(compute_loop_score(None, Some(false)) < 50.0);
        assert_eq!(compute_loop_score(None, None), 50.0);
    }

    #[test]
    fn test_spectral_score_ideal() {
        // Ideal spectral: 3kHz centroid, 0.45 flatness
        let score = compute_spectral_score(Some(3000.0), Some(0.45));
        assert!(score > 90.0, "Ideal spectral should score > 90, got {}", score);
    }

    #[test]
    fn test_usability_score() {
        // Ideal: 2 second duration, 44.1kHz
        let score = compute_usability_score(Some(2.0), Some(44100));
        assert!(score > 90.0, "Ideal usability should score > 90, got {}", score);

        // Too short
        let short_score = compute_usability_score(Some(0.01), Some(44100));
        assert!(short_score < 50.0, "Too short should score < 50, got {}", short_score);

        // Too long
        let long_score = compute_usability_score(Some(120.0), Some(44100));
        assert!(long_score < 80.0, "Too long should score < 80, got {}", long_score);
    }

    #[test]
    fn test_full_score() {
        let scores = compute_applicability_score(
            Some(-18.0), // rms_db
            Some(-9.0),  // peak_db
            Some(9.0),   // crest_factor
            Some(15.0),  // dynamic_range
            Some(false), // clipping_detected
            Some(80.0),  // loop_quality
            Some(true),  // is_loopable
            Some(3000.0), // spectral_centroid
            Some(0.45),  // spectral_flatness
            Some(2.0),   // duration
            Some(44100), // sample_rate
        );

        assert!(scores.total > 80.0, "Ideal sample should score > 80, got {}", scores.total);
    }
}
