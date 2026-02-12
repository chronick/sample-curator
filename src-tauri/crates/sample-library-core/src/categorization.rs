//! Smart categorization based on acoustic properties.
//!
//! Derives descriptive tags from spectral and quality features:
//! - bright/dark (spectral centroid)
//! - punchy/sustained (crest factor)
//! - noisy/clean (spectral flatness)
//! - short/medium/long (duration)

use crate::db::Sample;
use serde::{Deserialize, Serialize};

/// Acoustic property tags derived from analysis.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcousticTags {
    /// Brightness tag: "bright", "neutral", or "dark"
    pub brightness: Option<String>,
    /// Dynamics tag: "punchy", "balanced", or "sustained"
    pub dynamics: Option<String>,
    /// Tonality tag: "tonal", "noisy", or "mixed"
    pub tonality: Option<String>,
    /// Duration tag: "short", "medium", or "long"
    pub duration: Option<String>,
    /// Frequency range tag: "sub", "low", "mid", "high", or "full"
    pub frequency_range: Option<String>,
    /// All tags as a flat list.
    pub all_tags: Vec<String>,
}

/// Thresholds for categorization.
#[derive(Debug, Clone)]
pub struct CategorizationThresholds {
    /// Spectral centroid threshold for "bright" (Hz)
    pub bright_centroid: f64,
    /// Spectral centroid threshold for "dark" (Hz)
    pub dark_centroid: f64,
    /// Crest factor threshold for "punchy" (dB)
    pub punchy_crest: f64,
    /// Crest factor threshold for "sustained" (dB)
    pub sustained_crest: f64,
    /// Spectral flatness threshold for "noisy"
    pub noisy_flatness: f64,
    /// Spectral flatness threshold for "tonal"
    pub tonal_flatness: f64,
    /// Duration threshold for "short" (seconds)
    pub short_duration: f64,
    /// Duration threshold for "long" (seconds)
    pub long_duration: f64,
}

impl Default for CategorizationThresholds {
    fn default() -> Self {
        Self {
            bright_centroid: 4000.0,
            dark_centroid: 1500.0,
            punchy_crest: 12.0,
            sustained_crest: 6.0,
            noisy_flatness: 0.5,
            tonal_flatness: 0.1,
            short_duration: 0.5,
            long_duration: 4.0,
        }
    }
}

/// Categorize a sample based on its acoustic properties.
pub fn categorize_sample(sample: &Sample) -> AcousticTags {
    categorize_with_thresholds(sample, &CategorizationThresholds::default())
}

/// Categorize a sample with custom thresholds.
pub fn categorize_with_thresholds(
    sample: &Sample,
    thresholds: &CategorizationThresholds,
) -> AcousticTags {
    let mut tags = AcousticTags::default();

    // Brightness (from spectral centroid)
    if let Some(centroid) = sample.spectral_centroid {
        let brightness = if centroid > thresholds.bright_centroid {
            "bright"
        } else if centroid < thresholds.dark_centroid {
            "dark"
        } else {
            "neutral"
        };
        tags.brightness = Some(brightness.to_string());
        tags.all_tags.push(brightness.to_string());

        // Frequency range
        let range = if centroid < 200.0 {
            "sub"
        } else if centroid < 500.0 {
            "low"
        } else if centroid < 2000.0 {
            "mid"
        } else if centroid < 6000.0 {
            "high"
        } else {
            "air"
        };
        tags.frequency_range = Some(range.to_string());
        tags.all_tags.push(range.to_string());
    }

    // Dynamics (from crest factor)
    if let Some(crest) = sample.crest_factor {
        let dynamics = if crest > thresholds.punchy_crest {
            "punchy"
        } else if crest < thresholds.sustained_crest {
            "sustained"
        } else {
            "balanced"
        };
        tags.dynamics = Some(dynamics.to_string());
        tags.all_tags.push(dynamics.to_string());
    }

    // Tonality (from spectral flatness)
    if let Some(flatness) = sample.spectral_flatness {
        let tonality = if flatness > thresholds.noisy_flatness {
            "noisy"
        } else if flatness < thresholds.tonal_flatness {
            "tonal"
        } else {
            "mixed"
        };
        tags.tonality = Some(tonality.to_string());
        tags.all_tags.push(tonality.to_string());
    }

    // Duration
    if let Some(duration) = sample.duration {
        let dur_tag = if duration < thresholds.short_duration {
            "short"
        } else if duration > thresholds.long_duration {
            "long"
        } else {
            "medium"
        };
        tags.duration = Some(dur_tag.to_string());
        tags.all_tags.push(dur_tag.to_string());
    }

    // Loop detection
    if sample.is_loopable == Some(true) {
        tags.all_tags.push("loopable".to_string());
    }

    tags
}

/// Suggest sample type based on acoustic properties.
///
/// This is a simple rule-based classifier. For more accurate
/// classification, use ML models (CLAP, drum classifier).
pub fn suggest_sample_type(sample: &Sample) -> Option<String> {
    let centroid = sample.spectral_centroid?;
    let crest = sample.crest_factor?;
    let duration = sample.duration.unwrap_or(1.0);

    // Very short + punchy + low frequency = likely kick or percussion
    if duration < 0.5 && crest > 10.0 {
        if centroid < 300.0 {
            return Some("kick".to_string());
        } else if centroid > 5000.0 {
            return Some("hihat".to_string());
        } else if centroid > 2000.0 {
            return Some("snare".to_string());
        } else {
            return Some("perc".to_string());
        }
    }

    // Sustained + tonal + mid-high frequency = likely pad or lead
    if duration > 1.0 && crest < 8.0 {
        let flatness = sample.spectral_flatness.unwrap_or(0.5);
        if flatness < 0.2 {
            if centroid > 2000.0 {
                return Some("lead".to_string());
            } else {
                return Some("pad".to_string());
            }
        }
    }

    // Low frequency + sustained = likely bass
    if centroid < 500.0 && duration > 0.3 {
        return Some("bass".to_string());
    }

    // High flatness = likely noise/fx
    if let Some(flatness) = sample.spectral_flatness {
        if flatness > 0.7 {
            return Some("fx".to_string());
        }
    }

    // Default based on duration
    if duration < 0.3 {
        Some("oneshot".to_string())
    } else if sample.is_loopable == Some(true) {
        Some("loop".to_string())
    } else {
        None
    }
}

/// Drum type classifier based on spectral features.
///
/// Simple rule-based classification. For higher accuracy,
/// train an ML model on labeled drum samples.
pub fn classify_drum_type(
    spectral_centroid: f64,
    spectral_flatness: f64,
    crest_factor: f64,
    duration: f64,
) -> Option<String> {
    // Very short duration is a good indicator of percussive sound
    if duration > 1.0 {
        return None; // Probably not a drum
    }

    // Kick: low centroid, punchy, short
    if spectral_centroid < 300.0 && crest_factor > 8.0 {
        return Some("kick".to_string());
    }

    // Hi-hat / cymbal: high centroid, noisy
    if spectral_centroid > 5000.0 && spectral_flatness > 0.3 {
        if duration < 0.2 {
            return Some("hihat".to_string());
        } else {
            return Some("cymbal".to_string());
        }
    }

    // Snare: mid centroid, moderate flatness (body + noise)
    if spectral_centroid > 1000.0
        && spectral_centroid < 5000.0
        && spectral_flatness > 0.2
        && spectral_flatness < 0.6
    {
        return Some("snare".to_string());
    }

    // Clap: similar to snare but often more diffuse attack
    if spectral_centroid > 2000.0
        && spectral_centroid < 6000.0
        && spectral_flatness > 0.4
        && crest_factor < 10.0
    {
        return Some("clap".to_string());
    }

    // Tom: low-mid centroid, tonal, punchy
    if spectral_centroid > 200.0
        && spectral_centroid < 1000.0
        && spectral_flatness < 0.3
        && crest_factor > 6.0
    {
        return Some("tom".to_string());
    }

    // Rim / stick: high centroid, very short, punchy
    if spectral_centroid > 3000.0 && duration < 0.1 && crest_factor > 12.0 {
        return Some("rim".to_string());
    }

    // Generic percussion
    Some("perc".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sample(
        centroid: Option<f64>,
        flatness: Option<f64>,
        crest: Option<f64>,
        duration: Option<f64>,
    ) -> Sample {
        Sample {
            id: 1,
            path: "test.wav".to_string(),
            source_type: "imported".to_string(),
            sample_type: None,
            bpm: None,
            key: None,
            duration,
            sample_rate: Some(44100),
            channels: Some(2),
            rms_db: None,
            peak_db: None,
            crest_factor: crest,
            dynamic_range: None,
            clipping_detected: None,
            spectral_centroid: centroid,
            spectral_flatness: flatness,
            spectral_bandwidth: None,
            spectral_rolloff: None,
            loop_quality: None,
            is_loopable: None,
            quality_score: None,
            applicability_score: None,
            fingerprint: None,
            fingerprint_hash: None,
            duplicate_of_id: None,
            pack_id: None,
            created_at: None,
            updated_at: None,
            analyzed_at: None,
        }
    }

    #[test]
    fn test_brightness_categorization() {
        let bright_sample = make_sample(Some(5000.0), None, None, None);
        let dark_sample = make_sample(Some(1000.0), None, None, None);

        let bright_tags = categorize_sample(&bright_sample);
        let dark_tags = categorize_sample(&dark_sample);

        assert_eq!(bright_tags.brightness, Some("bright".to_string()));
        assert_eq!(dark_tags.brightness, Some("dark".to_string()));
    }

    #[test]
    fn test_dynamics_categorization() {
        let punchy_sample = make_sample(None, None, Some(15.0), None);
        let sustained_sample = make_sample(None, None, Some(4.0), None);

        let punchy_tags = categorize_sample(&punchy_sample);
        let sustained_tags = categorize_sample(&sustained_sample);

        assert_eq!(punchy_tags.dynamics, Some("punchy".to_string()));
        assert_eq!(sustained_tags.dynamics, Some("sustained".to_string()));
    }

    #[test]
    fn test_drum_classifier() {
        // Kick-like: low centroid, punchy
        let kick = classify_drum_type(200.0, 0.2, 12.0, 0.3);
        assert_eq!(kick, Some("kick".to_string()));

        // Hi-hat-like: high centroid, noisy, short
        let hihat = classify_drum_type(8000.0, 0.5, 8.0, 0.1);
        assert_eq!(hihat, Some("hihat".to_string()));

        // Snare-like: mid centroid, moderate noise
        let snare = classify_drum_type(3000.0, 0.4, 10.0, 0.2);
        assert_eq!(snare, Some("snare".to_string()));
    }
}
