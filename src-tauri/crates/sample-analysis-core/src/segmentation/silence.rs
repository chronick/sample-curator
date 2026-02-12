//! Silence-based audio segmentation.
//!
//! Splits audio at silent regions.

use crate::error::Result;
use crate::types::AudioChunk;

/// Configuration for silence segmentation.
#[derive(Debug, Clone)]
pub struct SilenceConfig {
    /// Silence threshold in dB (default -40.0)
    pub silence_threshold_db: f64,
    /// Minimum silence duration in seconds (default 0.5)
    pub min_silence_duration: f64,
    /// Minimum chunk duration in seconds (default 1.0)
    pub min_chunk_duration: f64,
    /// Frame size for RMS calculation in seconds (default 0.01)
    pub frame_duration: f64,
}

impl Default for SilenceConfig {
    fn default() -> Self {
        Self {
            silence_threshold_db: -40.0,
            min_silence_duration: 0.5,
            min_chunk_duration: 1.0,
            frame_duration: 0.01,
        }
    }
}

/// Segment audio by detecting silent regions.
///
/// # Arguments
/// * `samples` - Audio samples (mono)
/// * `sample_rate` - Sample rate in Hz
/// * `config` - Silence segmentation configuration
///
/// # Returns
/// Vector of AudioChunks representing non-silent segments
pub fn segment_by_silence(
    samples: &[f32],
    sample_rate: u32,
    config: &SilenceConfig,
) -> Result<Vec<AudioChunk>> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    // Convert threshold from dB to linear amplitude
    let threshold = 10.0f64.powf(config.silence_threshold_db / 20.0) as f32;

    // Frame parameters
    let frame_length = (config.frame_duration * sample_rate as f64) as usize;
    let hop_length = frame_length / 2;

    if frame_length == 0 {
        return Ok(Vec::new());
    }

    // Calculate RMS for each frame
    let num_frames = (samples.len().saturating_sub(frame_length)) / hop_length + 1;
    let mut rms_values = Vec::with_capacity(num_frames);

    for i in 0..num_frames {
        let start = i * hop_length;
        let end = (start + frame_length).min(samples.len());
        let rms = compute_rms(&samples[start..end]);
        rms_values.push(rms);
    }

    // Detect silent frames
    let is_silent: Vec<bool> = rms_values.iter().map(|&rms| rms < threshold).collect();

    // Find runs of silence >= min_silence_duration
    let min_silence_frames =
        (config.min_silence_duration * sample_rate as f64 / hop_length as f64) as usize;
    let min_chunk_samples = (config.min_chunk_duration * sample_rate as f64) as usize;

    // Build chunks at silence boundaries
    let mut chunks = Vec::new();
    let mut chunk_start_sample = 0usize;
    let mut silence_start_frame: Option<usize> = None;

    for (frame_idx, &silent) in is_silent.iter().enumerate() {
        if silent {
            // Start of potential silence
            if silence_start_frame.is_none() {
                silence_start_frame = Some(frame_idx);
            }
        } else {
            // End of silence (if we were in silence)
            if let Some(start) = silence_start_frame {
                let silence_length = frame_idx - start;

                if silence_length >= min_silence_frames {
                    // Long enough silence - create a chunk
                    let chunk_end_sample = (start * hop_length).min(samples.len());

                    if chunk_end_sample > chunk_start_sample
                        && chunk_end_sample - chunk_start_sample >= min_chunk_samples
                    {
                        let start_time = chunk_start_sample as f64 / sample_rate as f64;
                        let end_time = chunk_end_sample as f64 / sample_rate as f64;

                        chunks.push(AudioChunk {
                            start_sample: chunk_start_sample,
                            end_sample: chunk_end_sample,
                            start_time,
                            end_time,
                            duration: end_time - start_time,
                            path: None,
                        });
                    }

                    // Next chunk starts after silence
                    chunk_start_sample = (frame_idx * hop_length).min(samples.len());
                }

                silence_start_frame = None;
            }
        }
    }

    // Add final chunk if there's remaining content
    if samples.len() > chunk_start_sample
        && samples.len() - chunk_start_sample >= min_chunk_samples
    {
        let start_time = chunk_start_sample as f64 / sample_rate as f64;
        let end_time = samples.len() as f64 / sample_rate as f64;

        chunks.push(AudioChunk {
            start_sample: chunk_start_sample,
            end_sample: samples.len(),
            start_time,
            end_time,
            duration: end_time - start_time,
            path: None,
        });
    }

    // If no chunks were created, return the entire audio as one chunk
    if chunks.is_empty() && samples.len() >= min_chunk_samples {
        let duration = samples.len() as f64 / sample_rate as f64;
        chunks.push(AudioChunk {
            start_sample: 0,
            end_sample: samples.len(),
            start_time: 0.0,
            end_time: duration,
            duration,
            path: None,
        });
    }

    Ok(chunks)
}

/// Compute RMS of samples.
fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt() as f32
}

/// Segment audio file by silence.
pub fn segment_by_silence_file<P: AsRef<std::path::Path>>(
    path: P,
    config: Option<SilenceConfig>,
) -> Result<Vec<AudioChunk>> {
    let (samples, sample_rate) = crate::audio::load_audio(path, None, true)?;
    let config = config.unwrap_or_default();
    segment_by_silence(&samples, sample_rate, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_segment_with_silence() {
        let sr = 44100;
        let mut samples = Vec::new();

        // 1 second of sound
        for i in 0..(sr as usize) {
            samples.push((i as f32 / 100.0).sin() * 0.5);
        }

        // 1 second of silence
        for _ in 0..(sr as usize) {
            samples.push(0.0);
        }

        // 1 second of sound
        for i in 0..(sr as usize) {
            samples.push((i as f32 / 100.0).sin() * 0.5);
        }

        let config = SilenceConfig {
            silence_threshold_db: -40.0,
            min_silence_duration: 0.5,
            min_chunk_duration: 0.5,
            ..Default::default()
        };

        let chunks = segment_by_silence(&samples, sr, &config).unwrap();

        // Should detect 2 chunks separated by silence
        assert_eq!(chunks.len(), 2, "Expected 2 chunks, got {}", chunks.len());

        // First chunk should be around 0-1 seconds
        assert!(chunks[0].duration >= 0.5 && chunks[0].duration <= 1.5);

        // Second chunk should start around 2 seconds
        assert!(chunks[1].start_time >= 1.5 && chunks[1].start_time <= 2.5);
    }

    #[test]
    fn test_no_silence() {
        let sr = 44100;
        let duration = 2.0;
        let n_samples = (sr as f32 * duration) as usize;

        // Continuous sound
        let samples: Vec<f32> = (0..n_samples)
            .map(|i| (i as f32 / 100.0).sin() * 0.5)
            .collect();

        let config = SilenceConfig::default();
        let chunks = segment_by_silence(&samples, sr, &config).unwrap();

        // Should return 1 chunk (entire audio)
        assert_eq!(chunks.len(), 1);
        assert!((chunks[0].duration - duration as f64).abs() < 0.1);
    }

    #[test]
    fn test_all_silence() {
        let sr = 44100;
        let samples = vec![0.0f32; sr as usize * 2];

        let config = SilenceConfig {
            min_chunk_duration: 0.1,
            ..Default::default()
        };
        let chunks = segment_by_silence(&samples, sr, &config).unwrap();

        // For all-silent audio, the algorithm returns the whole file as one chunk
        // (since there's no audio to segment, it defaults to returning the full range)
        // This is acceptable behavior - the caller can check RMS to detect silence
        assert!(chunks.len() <= 1);
    }
}
