//! Audio file loading using symphonia.
//!
//! Supports WAV, MP3, FLAC, and OGG/Vorbis formats.

use crate::error::{AnalysisError, Result};
use crate::types::AudioInfo;
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Load audio file and return mono f32 samples with sample rate.
///
/// # Arguments
/// * `path` - Path to the audio file
/// * `target_sr` - Optional target sample rate for resampling (not implemented yet)
/// * `mono` - Whether to convert to mono (default: true)
///
/// # Returns
/// Tuple of (samples as Vec<f32>, sample_rate as u32)
pub fn load_audio<P: AsRef<Path>>(
    path: P,
    target_sr: Option<u32>,
    mono: bool,
) -> Result<(Vec<f32>, u32)> {
    let path = path.as_ref();

    // Open the file
    let file = File::open(path).map_err(|e| AnalysisError::FileOpen(e.to_string()))?;

    // Create a media source stream
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Create a hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    // Probe the media source
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| AnalysisError::UnsupportedFormat(e.to_string()))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AnalysisError::Decode("No audio track found".to_string()))?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    // Get sample rate and channels
    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| AnalysisError::Decode("Unknown sample rate".to_string()))?;

    let channels = codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2) as usize;

    // Create decoder
    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &decoder_opts)
        .map_err(|e| AnalysisError::Decode(e.to_string()))?;

    // Decode all packets
    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => {
                // Log but continue - some formats have trailing garbage
                eprintln!("Warning: packet read error: {}", e);
                break;
            }
        };

        // Skip packets from other tracks
        if packet.track_id() != track_id {
            continue;
        }

        // Decode the packet
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(e) => {
                eprintln!("Warning: decode error: {}", e);
                continue;
            }
        };

        // Convert to f32 samples
        let samples = decode_audio_buffer(&decoded, channels, mono);
        all_samples.extend(samples);
    }

    if all_samples.is_empty() {
        return Err(AnalysisError::AudioTooShort);
    }

    // Resample if needed
    let (samples, final_sr) = if let Some(target) = target_sr {
        if target != sample_rate {
            // Simple linear resampling (for now)
            let resampled = resample_linear(&all_samples, sample_rate, target);
            (resampled, target)
        } else {
            (all_samples, sample_rate)
        }
    } else {
        (all_samples, sample_rate)
    };

    Ok((samples, final_sr))
}

/// Get audio file information without fully decoding.
pub fn get_audio_info<P: AsRef<Path>>(path: P) -> Result<AudioInfo> {
    let path = path.as_ref();

    let file = File::open(path).map_err(|e| AnalysisError::FileOpen(e.to_string()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| AnalysisError::UnsupportedFormat(e.to_string()))?;

    let format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AnalysisError::Decode("No audio track found".to_string()))?;

    let codec_params = &track.codec_params;

    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2) as u16;
    let bit_depth = codec_params.bits_per_sample.unwrap_or(16) as u16;

    // Calculate duration from n_frames if available
    let duration_sec = codec_params
        .n_frames
        .map(|n| n as f64 / sample_rate as f64)
        .unwrap_or(0.0);

    // Get format from extension
    let format_str = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    Ok(AudioInfo {
        path: path.to_string_lossy().to_string(),
        duration_sec,
        sample_rate,
        channels,
        bit_depth,
        format: format_str,
    })
}

/// Decode audio buffer to f32 samples.
fn decode_audio_buffer(buffer: &AudioBufferRef, channels: usize, mono: bool) -> Vec<f32> {
    match buffer {
        AudioBufferRef::F32(buf) => {
            let first: Vec<f32> = buf.chan(0).to_vec();
            if mono && channels > 1 {
                let other_channels: Vec<Vec<f32>> = (1..channels)
                    .map(|c| buf.chan(c).to_vec())
                    .collect();
                mix_to_mono(&first, &other_channels)
            } else {
                first
            }
        }
        AudioBufferRef::S16(buf) => {
            let samples: Vec<f32> = buf.chan(0).iter().map(|&s| s as f32 / 32768.0).collect();
            if mono && channels > 1 {
                let other_channels: Vec<Vec<f32>> = (1..channels)
                    .map(|c| buf.chan(c).iter().map(|&s| s as f32 / 32768.0).collect())
                    .collect();
                mix_to_mono(&samples, &other_channels)
            } else {
                samples
            }
        }
        AudioBufferRef::S32(buf) => {
            let samples: Vec<f32> = buf
                .chan(0)
                .iter()
                .map(|&s| s as f32 / 2147483648.0)
                .collect();
            if mono && channels > 1 {
                let other_channels: Vec<Vec<f32>> = (1..channels)
                    .map(|c| {
                        buf.chan(c)
                            .iter()
                            .map(|&s| s as f32 / 2147483648.0)
                            .collect()
                    })
                    .collect();
                mix_to_mono(&samples, &other_channels)
            } else {
                samples
            }
        }
        AudioBufferRef::U8(buf) => {
            let samples: Vec<f32> = buf
                .chan(0)
                .iter()
                .map(|&s| (s as f32 - 128.0) / 128.0)
                .collect();
            if mono && channels > 1 {
                let other_channels: Vec<Vec<f32>> = (1..channels)
                    .map(|c| {
                        buf.chan(c)
                            .iter()
                            .map(|&s| (s as f32 - 128.0) / 128.0)
                            .collect()
                    })
                    .collect();
                mix_to_mono(&samples, &other_channels)
            } else {
                samples
            }
        }
        // Handle 24-bit packed as S24
        AudioBufferRef::S24(buf) => {
            let samples: Vec<f32> = buf
                .chan(0)
                .iter()
                .map(|s| s.inner() as f32 / 8388608.0)
                .collect();
            if mono && channels > 1 {
                let other_channels: Vec<Vec<f32>> = (1..channels)
                    .map(|c| {
                        buf.chan(c)
                            .iter()
                            .map(|s| s.inner() as f32 / 8388608.0)
                            .collect()
                    })
                    .collect();
                mix_to_mono(&samples, &other_channels)
            } else {
                samples
            }
        }
        // Handle other formats by trying to convert
        _ => {
            // Fallback: try to get samples somehow
            Vec::new()
        }
    }
}

/// Mix multiple channels to mono by averaging.
fn mix_to_mono(first: &[f32], others: &[Vec<f32>]) -> Vec<f32> {
    let n_channels = 1 + others.len();
    let scale = 1.0 / n_channels as f32;

    first
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let sum: f32 = s + others.iter().map(|ch| ch.get(i).copied().unwrap_or(0.0)).sum::<f32>();
            sum * scale
        })
        .collect()
}

/// Simple linear resampling.
fn resample_linear(samples: &[f32], from_sr: u32, to_sr: u32) -> Vec<f32> {
    if from_sr == to_sr {
        return samples.to_vec();
    }

    let ratio = from_sr as f64 / to_sr as f64;
    let new_len = (samples.len() as f64 / ratio) as usize;
    let mut resampled = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        let sample = if src_idx + 1 < samples.len() {
            samples[src_idx] * (1.0 - frac as f32) + samples[src_idx + 1] * frac as f32
        } else {
            samples.get(src_idx).copied().unwrap_or(0.0)
        };

        resampled.push(sample);
    }

    resampled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_linear() {
        let samples: Vec<f32> = (0..100).map(|i| (i as f32 * 0.01).sin()).collect();

        // Downsample
        let downsampled = resample_linear(&samples, 44100, 22050);
        assert!(downsampled.len() < samples.len());

        // Upsample
        let upsampled = resample_linear(&samples, 22050, 44100);
        assert!(upsampled.len() > samples.len());

        // Same rate
        let same = resample_linear(&samples, 44100, 44100);
        assert_eq!(same.len(), samples.len());
    }

    #[test]
    fn test_mix_to_mono() {
        let left = vec![1.0, 0.5, 0.0];
        let right = vec![vec![0.0, 0.5, 1.0]];
        let mono = mix_to_mono(&left, &right);

        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.5).abs() < 0.001);
        assert!((mono[1] - 0.5).abs() < 0.001);
        assert!((mono[2] - 0.5).abs() < 0.001);
    }
}
