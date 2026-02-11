//! Beat-aligned audio segmentation.
//!
//! Splits audio at beat boundaries.

use crate::analyzers::bpm::{analyze_bpm, BPMConfig};
use crate::error::Result;
use crate::types::AudioChunk;

/// Configuration for beat segmentation.
#[derive(Debug, Clone)]
pub struct BeatConfig {
    /// Number of bars per chunk (default 8)
    pub bars_per_chunk: usize,
    /// Beats per bar (default 4 for 4/4 time)
    pub beats_per_bar: usize,
    /// BPM (if known, otherwise will be detected)
    pub bpm: Option<f64>,
}

impl Default for BeatConfig {
    fn default() -> Self {
        Self {
            bars_per_chunk: 8,
            beats_per_bar: 4,
            bpm: None,
        }
    }
}

/// Segment audio at beat boundaries.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Beat segmentation configuration
///
/// # Returns
/// Vector of AudioChunks at beat boundaries
pub fn segment_by_beats(
    samples: &[f32],
    sample_rate: u32,
    config: &BeatConfig,
) -> Result<Vec<AudioChunk>> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    // Detect BPM if not provided
    let bpm = if let Some(b) = config.bpm {
        b
    } else {
        let bpm_config = BPMConfig {
            include_beats: true,
            ..Default::default()
        };
        let bpm_result = analyze_bpm(samples, sample_rate, &bpm_config)?;
        bpm_result.bpm
    };

    // Calculate beat positions
    let beat_positions = detect_beat_positions(samples, sample_rate, bpm);

    if beat_positions.len() < 2 {
        // Not enough beats, return entire audio
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

    // Group beats into chunks
    let beats_per_chunk = config.bars_per_chunk * config.beats_per_bar;
    let mut chunks = Vec::new();

    let mut i = 0;
    while i < beat_positions.len() {
        let start_sample = beat_positions[i];
        let end_idx = (i + beats_per_chunk).min(beat_positions.len() - 1);
        let end_sample = if end_idx + 1 < beat_positions.len() {
            beat_positions[end_idx]
        } else {
            samples.len()
        };

        let start_time = start_sample as f64 / sample_rate as f64;
        let end_time = end_sample as f64 / sample_rate as f64;

        chunks.push(AudioChunk {
            start_sample,
            end_sample,
            start_time,
            end_time,
            duration: end_time - start_time,
            path: None,
        });

        i += beats_per_chunk;
    }

    Ok(chunks)
}

/// Detect beat positions using BPM.
fn detect_beat_positions(samples: &[f32], sample_rate: u32, bpm: f64) -> Vec<usize> {
    if bpm <= 0.0 {
        return Vec::new();
    }

    let beat_period_samples = (60.0 / bpm * sample_rate as f64) as usize;

    if beat_period_samples == 0 {
        return Vec::new();
    }

    // Generate beat positions at regular intervals
    let mut positions = Vec::new();
    let mut pos = 0;

    while pos < samples.len() {
        positions.push(pos);
        pos += beat_period_samples;
    }

    positions
}

/// Segment audio file by beats.
pub fn segment_by_beats_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<BeatConfig>,
) -> Result<Vec<AudioChunk>> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    segment_by_beats(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_beat_segmentation() {
        // Generate 8 bars at 120 BPM (4/4)
        let sr = 44100;
        let bpm = 120.0;
        let beats_per_bar = 4;
        let bars = 16;
        let total_beats = bars * beats_per_bar;
        let beat_duration = 60.0 / bpm;
        let total_duration = beat_duration * total_beats as f64;
        let n_samples = (sr as f64 * total_duration) as usize;

        // Generate click track
        let mut samples = vec![0.0f32; n_samples];
        for beat in 0..total_beats {
            let sample_idx = (beat as f64 * beat_duration * sr as f64) as usize;
            if sample_idx < n_samples {
                for i in 0..100.min(n_samples - sample_idx) {
                    samples[sample_idx + i] = (-(i as f32) / 10.0).exp();
                }
            }
        }

        let config = BeatConfig {
            bars_per_chunk: 4,
            beats_per_bar: 4,
            bpm: Some(bpm),
        };

        let chunks = segment_by_beats(&samples, sr, &config).unwrap();

        // Should get 4 chunks (16 bars / 4 bars per chunk)
        assert_eq!(chunks.len(), 4, "Expected 4 chunks, got {}", chunks.len());

        // Each chunk should be approximately 4 bars = 16 beats = 8 seconds
        let expected_duration = 4.0 * 4.0 * beat_duration;
        for (i, chunk) in chunks.iter().enumerate() {
            // Allow some tolerance
            assert!(
                (chunk.duration - expected_duration).abs() < 1.0,
                "Chunk {} duration {} expected ~{}",
                i,
                chunk.duration,
                expected_duration
            );
        }
    }

    #[test]
    fn test_beat_positions() {
        let sr = 44100;
        let bpm = 120.0; // 2 beats per second

        let samples = vec![0.0f32; sr as usize * 4]; // 4 seconds = 8 beats
        let positions = detect_beat_positions(&samples, sr, bpm);

        // Should have approximately 8 beat positions
        assert!(positions.len() >= 7 && positions.len() <= 9);

        // Beats should be ~0.5 seconds apart (22050 samples at 44100)
        if positions.len() >= 2 {
            let gap = positions[1] - positions[0];
            let expected_gap = (sr as f64 * 0.5) as usize;
            assert!((gap as i64 - expected_gap as i64).abs() < 100);
        }
    }
}
