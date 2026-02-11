//! Embedding extraction from audio features.
//!
//! Creates a ~45-50 dimensional embedding vector from:
//! - MFCCs (mean and std): 26 dimensions
//! - Spectral features: 4 dimensions
//! - RMS envelope: 8 dimensions (approximated from quality metrics)
//! - Pitch contour: 8 dimensions (approximated from key detection)

use crate::db::{Database, Sample};
use crate::error::Result;
use sample_analysis_core::{
    analyze_spectral,
    analyzers::{quality::{analyze_quality, QualityConfig}, spectral::SpectralConfig},
    load_audio,
    mel::mfcc,
};
use serde::{Deserialize, Serialize};

/// Current embedding version. Increment when the embedding format changes.
pub const EMBEDDING_VERSION: i32 = 1;

/// Embedding dimension count.
pub const EMBEDDING_DIM: usize = 48;

/// Embedding vector with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Embedding {
    /// The embedding vector (normalized).
    pub vector: Vec<f32>,
    /// Sample ID this embedding belongs to.
    pub sample_id: i64,
    /// Version of the embedding algorithm.
    pub version: i32,
}

/// Configuration for embedding extraction.
#[derive(Debug, Clone)]
pub struct EmbeddingConfig {
    /// Number of MFCCs to compute.
    pub n_mfcc: usize,
    /// Number of mel bands.
    pub n_mels: usize,
    /// FFT size.
    pub n_fft: usize,
    /// Hop length.
    pub hop_length: usize,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            n_mfcc: 13,
            n_mels: 128,
            n_fft: 2048,
            hop_length: 512,
        }
    }
}

/// Extractor for audio embeddings.
pub struct EmbeddingExtractor {
    config: EmbeddingConfig,
}

impl EmbeddingExtractor {
    /// Create a new extractor with default config.
    pub fn new() -> Self {
        Self {
            config: EmbeddingConfig::default(),
        }
    }

    /// Create a new extractor with custom config.
    pub fn with_config(config: EmbeddingConfig) -> Self {
        Self { config }
    }

    /// Extract embedding from an audio file.
    ///
    /// The embedding vector has the following structure:
    /// - [0..13]:  MFCC means (timbre)
    /// - [13..26]: MFCC standard deviations (timbre variation)
    /// - [26..30]: Spectral features (centroid, rolloff, bandwidth, flatness)
    /// - [30..38]: RMS envelope approximation (8 bins)
    /// - [38..46]: Pitch/frequency contour approximation (8 bins)
    /// - [46..48]: Zero-crossing rate, quality score
    pub fn extract_from_file(&self, path: &str) -> Result<Vec<f32>> {
        // Load audio (mono)
        let (samples, sample_rate) = load_audio(path, None, true)?;

        self.extract_from_samples(&samples, sample_rate)
    }

    /// Extract embedding from audio samples.
    pub fn extract_from_samples(&self, samples: &[f32], sample_rate: u32) -> Result<Vec<f32>> {
        let mut embedding = Vec::with_capacity(EMBEDDING_DIM);

        // 1. Compute MFCCs [26 dimensions: 13 mean + 13 std]
        let mfccs = mfcc(
            samples,
            sample_rate,
            self.config.n_mfcc,
            self.config.n_mels,
            self.config.n_fft,
            self.config.hop_length,
        )?;

        // Compute mean and std for each MFCC coefficient
        for mfcc_row in &mfccs {
            let mean = mfcc_row.iter().sum::<f32>() / mfcc_row.len() as f32;
            embedding.push(mean);
        }

        for mfcc_row in &mfccs {
            let mean = mfcc_row.iter().sum::<f32>() / mfcc_row.len() as f32;
            let variance = mfcc_row.iter().map(|x| (x - mean).powi(2)).sum::<f32>()
                / mfcc_row.len() as f32;
            embedding.push(variance.sqrt());
        }

        // 2. Compute spectral features [4 dimensions]
        let spectral_config = SpectralConfig {
            n_fft: self.config.n_fft,
            hop_length: self.config.hop_length,
            n_mfcc: self.config.n_mfcc,
            roll_percent: 0.85,
        };
        let spectral = analyze_spectral(samples, sample_rate, &spectral_config)?;

        // Normalize spectral features to reasonable ranges
        embedding.push((spectral.spectral_centroid / 10000.0).clamp(0.0, 1.0) as f32);
        embedding.push((spectral.spectral_rolloff / 20000.0).clamp(0.0, 1.0) as f32);
        embedding.push((spectral.spectral_bandwidth / 5000.0).clamp(0.0, 1.0) as f32);
        embedding.push(spectral.spectral_flatness.clamp(0.0, 1.0) as f32);

        // 3. RMS envelope approximation [8 dimensions]
        // Divide signal into 8 segments and compute RMS for each
        let segment_len = samples.len() / 8;
        for i in 0..8 {
            let start = i * segment_len;
            let end = ((i + 1) * segment_len).min(samples.len());
            let segment = &samples[start..end];

            if segment.is_empty() {
                embedding.push(0.0);
            } else {
                let rms = (segment.iter().map(|x| x * x).sum::<f32>() / segment.len() as f32).sqrt();
                // Normalize RMS (typical range 0.0 to 0.5 for normalized audio)
                embedding.push((rms * 2.0).clamp(0.0, 1.0));
            }
        }

        // 4. Pitch/frequency contour approximation [8 dimensions]
        // Use spectral centroid per segment as a proxy for pitch contour
        for i in 0..8 {
            let start = i * segment_len;
            let end = ((i + 1) * segment_len).min(samples.len());
            let segment = &samples[start..end];

            if segment.len() < self.config.n_fft {
                embedding.push(0.5); // Default mid-range value
            } else {
                // Compute simple spectral centroid for this segment
                let seg_spectral = analyze_spectral(segment, sample_rate, &spectral_config);
                let centroid = seg_spectral
                    .map(|s| s.spectral_centroid)
                    .unwrap_or(2000.0);
                embedding.push((centroid / 10000.0).clamp(0.0, 1.0) as f32);
            }
        }

        // 5. Additional features [2 dimensions]
        embedding.push(spectral.zero_crossing_rate.clamp(0.0, 1.0) as f32);

        // Quality-based feature (crest factor as a proxy for "punch")
        let quality = analyze_quality(samples, sample_rate, &QualityConfig::default())?;
        let crest_normalized = ((quality.crest_factor + 20.0) / 40.0).clamp(0.0, 1.0) as f32;
        embedding.push(crest_normalized);

        // Ensure we have exactly EMBEDDING_DIM dimensions
        while embedding.len() < EMBEDDING_DIM {
            embedding.push(0.0);
        }
        embedding.truncate(EMBEDDING_DIM);

        // L2 normalize the embedding
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-6 {
            for x in &mut embedding {
                *x /= norm;
            }
        }

        Ok(embedding)
    }

    /// Extract embedding from a sample record (using stored features if available).
    ///
    /// If the sample has pre-computed spectral features, this can be faster
    /// than re-analyzing the audio file.
    pub fn extract_from_sample(&self, sample: &Sample) -> Result<Vec<f32>> {
        // For now, always load the file. In the future, we could use
        // stored features for a faster approximation.
        self.extract_from_file(&sample.path)
    }

    /// Extract and store embeddings for samples that don't have them.
    pub fn process_pending(&self, db: &Database, batch_size: i64) -> Result<usize> {
        let samples = db.get_samples_without_embeddings(batch_size)?;
        let mut count = 0;

        for sample in samples {
            match self.extract_from_file(&sample.path) {
                Ok(embedding) => {
                    db.store_embedding(sample.id, &embedding, EMBEDDING_VERSION)?;
                    count += 1;
                }
                Err(e) => {
                    log::warn!("Failed to extract embedding for sample {}: {}", sample.id, e);
                }
            }
        }

        Ok(count)
    }
}

impl Default for EmbeddingExtractor {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute cosine similarity between two embeddings.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a < 1e-6 || norm_b < 1e-6 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

/// Compute Euclidean distance between two embeddings.
pub fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return f32::MAX;
    }

    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        let c = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&a, &c) - 0.0).abs() < 0.001);

        let d = vec![-1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &d) - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_euclidean_distance() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![3.0, 4.0, 0.0];
        assert!((euclidean_distance(&a, &b) - 5.0).abs() < 0.001);
    }
}
