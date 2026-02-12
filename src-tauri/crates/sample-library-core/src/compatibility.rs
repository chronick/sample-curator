//! Compatibility search for finding samples that complement each other.
//!
//! Unlike similarity search (finding samples that sound alike),
//! compatibility search finds samples that work well together:
//! - Compatible keys (same key, relative major/minor, circle of fifths)
//! - Compatible BPM (same, half-time, double-time)
//! - Complementary frequencies (non-overlapping spectral space)
//! - Dynamic compatibility (transient + sustain layering)

use crate::db::{Database, Sample};
use crate::error::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Criteria for compatibility search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityCriteria {
    /// Check key compatibility.
    pub check_key: bool,
    /// Check BPM compatibility.
    pub check_bpm: bool,
    /// Check frequency complementarity.
    pub check_frequency: bool,
    /// Check dynamic complementarity.
    pub check_dynamics: bool,
    /// BPM tolerance percentage (default 5%).
    pub bpm_tolerance: f64,
}

impl Default for CompatibilityCriteria {
    fn default() -> Self {
        Self {
            check_key: true,
            check_bpm: true,
            check_frequency: true,
            check_dynamics: true,
            bpm_tolerance: 0.05,
        }
    }
}

impl CompatibilityCriteria {
    /// Criteria for layering (frequency and dynamics focus).
    pub fn for_layering() -> Self {
        Self {
            check_key: false,
            check_bpm: false,
            check_frequency: true,
            check_dynamics: true,
            bpm_tolerance: 0.05,
        }
    }

    /// Criteria for melodic matching (key focus).
    pub fn for_melodic() -> Self {
        Self {
            check_key: true,
            check_bpm: true,
            check_frequency: false,
            check_dynamics: false,
            bpm_tolerance: 0.05,
        }
    }

    /// Criteria for building a pack (all checks).
    pub fn for_pack_building() -> Self {
        Self::default()
    }
}

/// Result from compatibility search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityResult {
    /// Sample ID.
    pub sample_id: i64,
    /// Overall compatibility score (0.0 to 1.0).
    pub score: f64,
    /// Key compatibility score.
    pub key_score: f64,
    /// BPM compatibility score.
    pub bpm_score: f64,
    /// Frequency complementarity score.
    pub frequency_score: f64,
    /// Dynamic complementarity score.
    pub dynamics_score: f64,
    /// Compatibility notes (human-readable).
    pub notes: Vec<String>,
}

/// Compatibility search engine.
pub struct CompatibilitySearch {
    /// Circle of fifths for key compatibility.
    key_circle: Vec<&'static str>,
    /// Relative major/minor pairs.
    relative_keys: HashMap<&'static str, &'static str>,
}

impl CompatibilitySearch {
    /// Create a new compatibility search engine.
    pub fn new() -> Self {
        // Circle of fifths (major keys)
        let key_circle = vec![
            "C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F",
        ];

        // Relative major/minor pairs
        let mut relative_keys = HashMap::new();
        relative_keys.insert("C", "Am");
        relative_keys.insert("Am", "C");
        relative_keys.insert("G", "Em");
        relative_keys.insert("Em", "G");
        relative_keys.insert("D", "Bm");
        relative_keys.insert("Bm", "D");
        relative_keys.insert("A", "F#m");
        relative_keys.insert("F#m", "A");
        relative_keys.insert("E", "C#m");
        relative_keys.insert("C#m", "E");
        relative_keys.insert("B", "G#m");
        relative_keys.insert("G#m", "B");
        relative_keys.insert("F#", "D#m");
        relative_keys.insert("D#m", "F#");
        relative_keys.insert("Db", "Bbm");
        relative_keys.insert("Bbm", "Db");
        relative_keys.insert("Ab", "Fm");
        relative_keys.insert("Fm", "Ab");
        relative_keys.insert("Eb", "Cm");
        relative_keys.insert("Cm", "Eb");
        relative_keys.insert("Bb", "Gm");
        relative_keys.insert("Gm", "Bb");
        relative_keys.insert("F", "Dm");
        relative_keys.insert("Dm", "F");

        Self {
            key_circle,
            relative_keys,
        }
    }

    /// Find compatible samples for a given sample.
    pub fn find_compatible(
        &self,
        db: &Database,
        sample_id: i64,
        criteria: &CompatibilityCriteria,
        limit: usize,
    ) -> Result<Vec<CompatibilityResult>> {
        let source = db
            .get_sample(sample_id)?
            .ok_or(crate::error::Error::SampleNotFound(sample_id))?;

        // Get all samples (we'll filter and score them)
        let candidates = db.get_samples(Some(1000), None, None, None, None)?;

        let mut results: Vec<CompatibilityResult> = candidates
            .iter()
            .filter(|s| s.id != sample_id)
            .filter_map(|candidate| {
                self.compute_compatibility(&source, candidate, criteria)
            })
            .collect();

        // Sort by overall score (highest first)
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        // Take top results
        results.truncate(limit);

        Ok(results)
    }

    /// Compute compatibility between two samples.
    fn compute_compatibility(
        &self,
        source: &Sample,
        candidate: &Sample,
        criteria: &CompatibilityCriteria,
    ) -> Option<CompatibilityResult> {
        let mut notes = Vec::new();
        let mut weights = Vec::new();
        let mut scores = Vec::new();

        // Key compatibility
        let key_score = if criteria.check_key {
            let score = self.key_compatibility(
                source.key.as_deref(),
                candidate.key.as_deref(),
                &mut notes,
            );
            weights.push(1.0);
            scores.push(score);
            score
        } else {
            1.0
        };

        // BPM compatibility
        let bpm_score = if criteria.check_bpm {
            let score = self.bpm_compatibility(
                source.bpm,
                candidate.bpm,
                criteria.bpm_tolerance,
                &mut notes,
            );
            weights.push(1.0);
            scores.push(score);
            score
        } else {
            1.0
        };

        // Frequency complementarity
        let frequency_score = if criteria.check_frequency {
            let score = self.frequency_complementarity(
                source.spectral_centroid,
                source.spectral_bandwidth,
                candidate.spectral_centroid,
                candidate.spectral_bandwidth,
                &mut notes,
            );
            weights.push(1.0);
            scores.push(score);
            score
        } else {
            1.0
        };

        // Dynamic complementarity
        let dynamics_score = if criteria.check_dynamics {
            let score = self.dynamic_complementarity(
                source.crest_factor,
                candidate.crest_factor,
                &mut notes,
            );
            weights.push(1.0);
            scores.push(score);
            score
        } else {
            1.0
        };

        // Compute weighted average
        let total_weight: f64 = weights.iter().sum();
        let overall_score = if total_weight > 0.0 {
            scores.iter().zip(weights.iter())
                .map(|(s, w)| s * w)
                .sum::<f64>() / total_weight
        } else {
            0.0
        };

        // Filter out low-scoring results
        if overall_score < 0.3 {
            return None;
        }

        Some(CompatibilityResult {
            sample_id: candidate.id,
            score: overall_score,
            key_score,
            bpm_score,
            frequency_score,
            dynamics_score,
            notes,
        })
    }

    /// Compute key compatibility score.
    fn key_compatibility(
        &self,
        key_a: Option<&str>,
        key_b: Option<&str>,
        notes: &mut Vec<String>,
    ) -> f64 {
        match (key_a, key_b) {
            (Some(a), Some(b)) => {
                let a_normalized = self.normalize_key(a);
                let b_normalized = self.normalize_key(b);

                // Same key
                if a_normalized == b_normalized {
                    notes.push(format!("Same key: {}", a));
                    return 1.0;
                }

                // Relative major/minor
                if let Some(relative) = self.relative_keys.get(a_normalized.as_str()) {
                    if *relative == b_normalized {
                        notes.push(format!("Relative key: {} ↔ {}", a, b));
                        return 0.95;
                    }
                }

                // Circle of fifths neighbors
                let a_pos = self.key_circle.iter().position(|&k| k == self.get_root_key(&a_normalized));
                let b_pos = self.key_circle.iter().position(|&k| k == self.get_root_key(&b_normalized));

                if let (Some(ap), Some(bp)) = (a_pos, b_pos) {
                    let distance = ((ap as i32 - bp as i32).abs()).min(12 - (ap as i32 - bp as i32).abs());
                    if distance <= 1 {
                        notes.push(format!("Circle of fifths neighbor: {} ↔ {}", a, b));
                        return 0.85;
                    } else if distance <= 2 {
                        notes.push(format!("Compatible keys: {} ↔ {}", a, b));
                        return 0.7;
                    }
                }

                // Different key
                notes.push(format!("Different keys: {} vs {}", a, b));
                0.3
            }
            (None, _) | (_, None) => {
                // Unknown key - neutral score
                0.5
            }
        }
    }

    /// Normalize key notation (e.g., "A minor" -> "Am").
    fn normalize_key(&self, key: &str) -> String {
        let re = Regex::new(r"(?i)^([A-G][#b]?)\s*(m|min|minor)?$").unwrap();

        if let Some(caps) = re.captures(key.trim()) {
            let root = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let minor = caps.get(2).is_some();

            let root_upper = root.chars().next().unwrap().to_uppercase().to_string()
                + &root.chars().skip(1).collect::<String>();

            if minor {
                format!("{}m", root_upper)
            } else {
                root_upper
            }
        } else {
            key.to_string()
        }
    }

    /// Get the root major key from a key string.
    fn get_root_key(&self, key: &str) -> String {
        if key.ends_with('m') {
            // Minor key - convert to relative major
            if let Some(major) = self.relative_keys.get(key) {
                return major.to_string();
            }
        }
        key.to_string()
    }

    /// Compute BPM compatibility score.
    fn bpm_compatibility(
        &self,
        bpm_a: Option<f64>,
        bpm_b: Option<f64>,
        tolerance: f64,
        notes: &mut Vec<String>,
    ) -> f64 {
        match (bpm_a, bpm_b) {
            (Some(a), Some(b)) => {
                // Check for exact match (within tolerance)
                let diff_pct = (a - b).abs() / a;
                if diff_pct <= tolerance {
                    notes.push(format!("Same BPM: {:.0} ≈ {:.0}", a, b));
                    return 1.0;
                }

                // Check for half/double time relationships
                let ratios = [0.5, 2.0, 0.25, 4.0, 0.75, 1.5];
                for ratio in ratios {
                    let adjusted = b * ratio;
                    let diff_pct = (a - adjusted).abs() / a;
                    if diff_pct <= tolerance {
                        let relation = if ratio < 1.0 { "half-time" } else { "double-time" };
                        notes.push(format!("Compatible BPM ({relation}): {:.0} ↔ {:.0}", a, b));
                        return 0.9;
                    }
                }

                // Different BPM
                notes.push(format!("Different BPM: {:.0} vs {:.0}", a, b));
                0.2
            }
            (None, _) | (_, None) => {
                // Unknown BPM - neutral score
                0.5
            }
        }
    }

    /// Compute frequency complementarity score.
    ///
    /// Samples that occupy different frequency bands layer well together.
    fn frequency_complementarity(
        &self,
        centroid_a: Option<f64>,
        bandwidth_a: Option<f64>,
        centroid_b: Option<f64>,
        bandwidth_b: Option<f64>,
        notes: &mut Vec<String>,
    ) -> f64 {
        match (centroid_a, centroid_b) {
            (Some(ca), Some(cb)) => {
                let bw_a = bandwidth_a.unwrap_or(1000.0);
                let bw_b = bandwidth_b.unwrap_or(1000.0);

                // Compute spectral overlap
                // Lower overlap = better complementarity
                let range_a = (ca - bw_a / 2.0, ca + bw_a / 2.0);
                let range_b = (cb - bw_b / 2.0, cb + bw_b / 2.0);

                let overlap_start = range_a.0.max(range_b.0);
                let overlap_end = range_a.1.min(range_b.1);
                let overlap = (overlap_end - overlap_start).max(0.0);

                let total_span = (range_a.1.max(range_b.1)) - (range_a.0.min(range_b.0));
                let overlap_ratio = if total_span > 0.0 {
                    overlap / total_span
                } else {
                    0.0
                };

                // Complementarity is inverse of overlap
                let score = 1.0 - overlap_ratio * 0.7; // Don't penalize too harshly

                // Add descriptive notes
                if ca < 500.0 {
                    if cb > 4000.0 {
                        notes.push("Good frequency separation: low + high".to_string());
                    } else if cb > 1000.0 {
                        notes.push("Decent frequency separation: low + mid".to_string());
                    }
                } else if ca > 4000.0 {
                    if cb < 500.0 {
                        notes.push("Good frequency separation: high + low".to_string());
                    } else if cb < 2000.0 {
                        notes.push("Decent frequency separation: high + mid".to_string());
                    }
                }

                score.clamp(0.0, 1.0)
            }
            (None, _) | (_, None) => {
                // Unknown frequency - neutral score
                0.5
            }
        }
    }

    /// Compute dynamic complementarity score.
    ///
    /// Samples with different crest factors layer well:
    /// - Punchy (high crest) + sustained (low crest) = good
    /// - Two punchy samples = potential conflict
    fn dynamic_complementarity(
        &self,
        crest_a: Option<f64>,
        crest_b: Option<f64>,
        notes: &mut Vec<String>,
    ) -> f64 {
        match (crest_a, crest_b) {
            (Some(ca), Some(cb)) => {
                // Crest factor: higher = more punchy/transient
                // Typical range: 3-20 dB

                let diff = (ca - cb).abs();
                let avg = (ca + cb) / 2.0;

                // Complementary dynamics: one punchy, one sustained
                if diff > 6.0 {
                    if ca > cb {
                        notes.push("Good dynamic contrast: punchy + sustained".to_string());
                    } else {
                        notes.push("Good dynamic contrast: sustained + punchy".to_string());
                    }
                    return 0.9;
                }

                // Similar dynamics
                if diff < 3.0 {
                    if avg > 12.0 {
                        notes.push("Both punchy - may compete for transients".to_string());
                        return 0.5;
                    } else if avg < 6.0 {
                        notes.push("Both sustained - may blend well".to_string());
                        return 0.7;
                    }
                }

                // Moderate difference
                0.7
            }
            (None, _) | (_, None) => {
                // Unknown dynamics - neutral score
                0.5
            }
        }
    }
}

impl Default for CompatibilitySearch {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_compatibility() {
        let search = CompatibilitySearch::new();
        let mut notes = Vec::new();

        // Same key
        let score = search.key_compatibility(Some("Am"), Some("Am"), &mut notes);
        assert!((score - 1.0).abs() < 0.01);

        // Relative major/minor
        notes.clear();
        let score = search.key_compatibility(Some("Am"), Some("C"), &mut notes);
        assert!(score > 0.9);

        // Different keys
        notes.clear();
        let score = search.key_compatibility(Some("Am"), Some("F#m"), &mut notes);
        assert!(score < 0.5);
    }

    #[test]
    fn test_bpm_compatibility() {
        let search = CompatibilitySearch::new();
        let mut notes = Vec::new();

        // Same BPM
        let score = search.bpm_compatibility(Some(120.0), Some(120.0), 0.05, &mut notes);
        assert!((score - 1.0).abs() < 0.01);

        // Double time
        notes.clear();
        let score = search.bpm_compatibility(Some(120.0), Some(60.0), 0.05, &mut notes);
        assert!(score > 0.8);

        // Different BPM
        notes.clear();
        let score = search.bpm_compatibility(Some(120.0), Some(90.0), 0.05, &mut notes);
        assert!(score < 0.5);
    }

    #[test]
    fn test_normalize_key() {
        let search = CompatibilitySearch::new();

        assert_eq!(search.normalize_key("A minor"), "Am");
        assert_eq!(search.normalize_key("C#m"), "C#m");
        assert_eq!(search.normalize_key("G"), "G");
        assert_eq!(search.normalize_key("Bb min"), "Bbm");
    }
}
