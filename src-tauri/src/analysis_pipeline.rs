//! Analysis pipeline dispatcher.
//!
//! Provides a reusable entry point for running analysis on a sample,
//! decoupled from the import job's progress tracking. Today there's
//! one pipeline (`Standard`); future work adds per-tag routing.

use sample_analysis_core::analyzers::{
    bpm::analyze_bpm_file,
    key::analyze_key_file,
    quality::analyze_quality_file,
    spectral::analyze_spectral_file,
};
use sample_library_core::db::Database;

/// Which analysis steps to run on a sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisPipeline {
    /// BPM + key + quality + spectral (default for recordings and imports).
    Standard,
    // Future variants:
    // SingleHit,     // skip BPM, focus on transient/spectral
    // DrumLoop,      // BPM + loop quality + transient density
    // Vocal,         // key + spectral + formant analysis
    // FullRecording, // BPM + key + quality + spectral + structure
}

/// Result of running analysis on a sample.
#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub analyzed: bool,
    pub errors: Vec<String>,
}

/// Select a pipeline based on tags. Falls back to `Standard`.
pub fn pipeline_for_tags(_tags: &[&str]) -> AnalysisPipeline {
    // Future: match on tags like "vocal", "single-hit", "drum-loop"
    AnalysisPipeline::Standard
}

/// Run the specified analysis pipeline on a sample and update the database.
pub fn analyze_sample(
    db: &Database,
    sample_id: i64,
    file_path: &str,
    pipeline: AnalysisPipeline,
) -> AnalysisResult {
    match pipeline {
        AnalysisPipeline::Standard => run_standard(db, sample_id, file_path),
    }
}

/// Standard pipeline: BPM + key + quality + spectral.
fn run_standard(db: &Database, sample_id: i64, file_path: &str) -> AnalysisResult {
    let mut errors = Vec::new();

    let mut bpm: Option<f64> = None;
    let mut key: Option<String> = None;
    let mut rms_db: Option<f64> = None;
    let mut peak_db: Option<f64> = None;
    let mut crest_factor: Option<f64> = None;
    let mut dynamic_range: Option<f64> = None;
    let mut clipping_detected: Option<bool> = None;
    let mut spectral_centroid: Option<f64> = None;
    let mut spectral_flatness: Option<f64> = None;
    let mut quality_score: Option<f64> = None;

    // BPM
    match analyze_bpm_file(file_path, None) {
        Ok(result) => bpm = Some(result.bpm),
        Err(e) => errors.push(format!("BPM: {}", e)),
    }

    // Key
    match analyze_key_file(file_path, None) {
        Ok(result) => key = Some(result.key),
        Err(e) => errors.push(format!("Key: {}", e)),
    }

    // Quality
    match analyze_quality_file(file_path, None) {
        Ok(result) => {
            rms_db = Some(result.rms_db);
            peak_db = Some(result.peak_db);
            crest_factor = Some(result.crest_factor);
            dynamic_range = Some(result.dynamic_range);
            clipping_detected = Some(result.clipping_detected);

            // Simple quality score from quality metrics
            let clip_penalty = if result.clipping_detected { 20.0 } else { 0.0 };
            let dr_score = (result.dynamic_range / 20.0 * 100.0).min(100.0);
            quality_score = Some((dr_score - clip_penalty).max(0.0));
        }
        Err(e) => errors.push(format!("Quality: {}", e)),
    }

    // Spectral
    match analyze_spectral_file(file_path, None) {
        Ok(result) => {
            spectral_centroid = Some(result.spectral_centroid);
            spectral_flatness = Some(result.spectral_flatness);
        }
        Err(e) => errors.push(format!("Spectral: {}", e)),
    }

    // Update database
    if let Err(e) = db.update_sample_analysis(
        sample_id,
        bpm,
        key.as_deref(),
        rms_db,
        peak_db,
        crest_factor,
        dynamic_range,
        clipping_detected,
        spectral_centroid,
        spectral_flatness,
        None, // loop_quality
        None, // is_loopable
        quality_score,
        None, // applicability_score
    ) {
        errors.push(format!("DB update: {}", e));
        return AnalysisResult {
            analyzed: false,
            errors,
        };
    }

    AnalysisResult {
        analyzed: true,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_for_tags_default() {
        assert_eq!(pipeline_for_tags(&[]), AnalysisPipeline::Standard);
        assert_eq!(pipeline_for_tags(&["recorded"]), AnalysisPipeline::Standard);
        assert_eq!(
            pipeline_for_tags(&["recorded", "vocal"]),
            AnalysisPipeline::Standard
        );
    }

    #[test]
    fn test_analysis_pipeline_is_copy() {
        let p = AnalysisPipeline::Standard;
        let p2 = p;
        assert_eq!(p, p2);
    }
}
