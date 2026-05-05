//! Similarity search using usearch ANN index.
//!
//! Provides fast approximate nearest neighbor search for audio embeddings.

use crate::db::Database;
use crate::embedding::{cosine_similarity, EMBEDDING_DIM};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use usearch::{Index, IndexOptions, MetricKind, ScalarKind};

/// Aspect weights for similarity search.
///
/// Allows users to emphasize different aspects of the audio:
/// - Timbre: MFCC-based timbral similarity
/// - Pitch: Frequency/pitch contour similarity
/// - Amplitude: RMS envelope similarity
/// - Spectrum: Spectral feature similarity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchAspects {
    /// Weight for timbre similarity (MFCCs). Range 0.0-1.0.
    pub timbre: f32,
    /// Weight for pitch/frequency contour. Range 0.0-1.0.
    pub pitch: f32,
    /// Weight for amplitude envelope. Range 0.0-1.0.
    pub amplitude: f32,
    /// Weight for spectral features. Range 0.0-1.0.
    pub spectrum: f32,
}

impl Default for SearchAspects {
    fn default() -> Self {
        Self {
            timbre: 1.0,
            pitch: 1.0,
            amplitude: 1.0,
            spectrum: 1.0,
        }
    }
}

impl SearchAspects {
    /// Create uniform weights.
    pub fn uniform() -> Self {
        Self::default()
    }

    /// Emphasize timbre (good for finding similar instruments).
    pub fn timbre_focused() -> Self {
        Self {
            timbre: 1.0,
            pitch: 0.3,
            amplitude: 0.3,
            spectrum: 0.5,
        }
    }

    /// Emphasize rhythm/envelope (good for finding similar grooves).
    pub fn rhythm_focused() -> Self {
        Self {
            timbre: 0.3,
            pitch: 0.3,
            amplitude: 1.0,
            spectrum: 0.5,
        }
    }

    /// Apply aspect weights to an embedding vector.
    ///
    /// This creates a weighted version of the embedding where different
    /// segments are scaled by their corresponding weights.
    pub fn apply_weights(&self, embedding: &[f32]) -> Vec<f32> {
        if embedding.len() != EMBEDDING_DIM {
            return embedding.to_vec();
        }

        let mut weighted = embedding.to_vec();

        // [0..26]: MFCCs (timbre)
        for i in 0..26 {
            weighted[i] *= self.timbre;
        }

        // [26..30]: Spectral features
        for i in 26..30 {
            weighted[i] *= self.spectrum;
        }

        // [30..38]: RMS envelope (amplitude)
        for i in 30..38 {
            weighted[i] *= self.amplitude;
        }

        // [38..46]: Pitch contour
        for i in 38..46 {
            weighted[i] *= self.pitch;
        }

        // [46..48]: Additional features (use spectrum weight)
        for i in 46..48.min(weighted.len()) {
            weighted[i] *= self.spectrum;
        }

        // Re-normalize
        let norm: f32 = weighted.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-6 {
            for x in &mut weighted {
                *x /= norm;
            }
        }

        weighted
    }
}

/// Result from similarity search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarityResult {
    /// Sample ID.
    pub sample_id: i64,
    /// Similarity score (0.0 to 1.0, higher is more similar).
    pub similarity: f32,
    /// Distance in embedding space.
    pub distance: f32,
}

/// Similarity search engine using usearch.
pub struct SimilaritySearch {
    /// The usearch index.
    index: Index,
    /// Map from index position to sample ID.
    position_to_id: HashMap<u64, i64>,
    /// Map from sample ID to index position.
    id_to_position: HashMap<i64, u64>,
    /// Next available position in the index.
    next_position: u64,
}

impl SimilaritySearch {
    /// Create a new similarity search engine.
    pub fn new() -> Result<Self> {
        let options = IndexOptions {
            dimensions: EMBEDDING_DIM,
            metric: MetricKind::Cos, // Cosine distance
            quantization: ScalarKind::F32,
            connectivity: 16,       // M parameter for HNSW
            expansion_add: 128,     // ef_construction
            expansion_search: 64,   // ef
            multi: false,
        };

        let index = Index::new(&options)
            .map_err(|e| Error::Index(format!("Failed to create index: {}", e)))?;

        Ok(Self {
            index,
            position_to_id: HashMap::new(),
            id_to_position: HashMap::new(),
            next_position: 0,
        })
    }

    /// Create and load from a persisted index file.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path_str = path.as_ref().to_string_lossy().to_string();

        let options = IndexOptions {
            dimensions: EMBEDDING_DIM,
            metric: MetricKind::Cos,
            quantization: ScalarKind::F32,
            connectivity: 16,
            expansion_add: 128,
            expansion_search: 64,
            multi: false,
        };

        let index = Index::new(&options)
            .map_err(|e| Error::Index(format!("Failed to create index: {}", e)))?;

        // Try to load existing index
        if path.as_ref().exists() {
            index
                .load(&path_str)
                .map_err(|e| Error::Index(format!("Failed to load index: {}", e)))?;
        }

        Ok(Self {
            index,
            position_to_id: HashMap::new(),
            id_to_position: HashMap::new(),
            next_position: 0,
        })
    }

    /// Save the index to disk.
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let path_str = path.as_ref().to_string_lossy().to_string();
        self.index
            .save(&path_str)
            .map_err(|e| Error::Index(format!("Failed to save index: {}", e)))?;
        Ok(())
    }

    /// Add an embedding to the index.
    pub fn add(&mut self, sample_id: i64, embedding: &[f32]) -> Result<()> {
        if embedding.len() != EMBEDDING_DIM {
            return Err(Error::Index(format!(
                "Invalid embedding dimension: {} (expected {})",
                embedding.len(),
                EMBEDDING_DIM
            )));
        }

        // Check if sample already in index
        if let Some(&position) = self.id_to_position.get(&sample_id) {
            // Remove old entry
            self.index.remove(position).ok();
            self.position_to_id.remove(&position);
        }

        // Ensure capacity (usearch requires reservation before adding)
        let current_capacity = self.index.capacity();
        let current_size = self.index.size();
        if current_size >= current_capacity {
            // Reserve more space - grow by 100 or double, whichever is larger
            let new_capacity = (current_capacity * 2).max(current_capacity + 100).max(100);
            self.index
                .reserve(new_capacity)
                .map_err(|e| Error::Index(format!("Failed to reserve index capacity: {}", e)))?;
        }

        let position = self.next_position;
        self.next_position += 1;

        self.index
            .add(position, embedding)
            .map_err(|e| Error::Index(format!("Failed to add to index: {}", e)))?;

        self.position_to_id.insert(position, sample_id);
        self.id_to_position.insert(sample_id, position);

        Ok(())
    }

    /// Remove a sample from the index.
    pub fn remove(&mut self, sample_id: i64) -> Result<()> {
        if let Some(&position) = self.id_to_position.get(&sample_id) {
            self.index
                .remove(position)
                .map_err(|e| Error::Index(format!("Failed to remove from index: {}", e)))?;
            self.position_to_id.remove(&position);
            self.id_to_position.remove(&sample_id);
        }
        Ok(())
    }

    /// Search for similar samples.
    ///
    /// # Arguments
    /// * `embedding` - The query embedding
    /// * `k` - Number of results to return
    /// * `aspects` - Optional aspect weights
    ///
    /// # Returns
    /// Vector of similarity results, sorted by similarity (highest first).
    pub fn search(
        &self,
        embedding: &[f32],
        k: usize,
        aspects: Option<&SearchAspects>,
    ) -> Result<Vec<SimilarityResult>> {
        if embedding.len() != EMBEDDING_DIM {
            return Err(Error::Index(format!(
                "Invalid embedding dimension: {} (expected {})",
                embedding.len(),
                EMBEDDING_DIM
            )));
        }

        // Apply aspect weights if provided
        let query = match aspects {
            Some(a) => a.apply_weights(embedding),
            None => embedding.to_vec(),
        };

        let matches = self
            .index
            .search(&query, k)
            .map_err(|e| Error::Index(format!("Search failed: {}", e)))?;

        let mut results = Vec::with_capacity(matches.keys.len());

        for (key, distance) in matches.keys.iter().zip(matches.distances.iter()) {
            if let Some(&sample_id) = self.position_to_id.get(key) {
                // Convert cosine distance to similarity (1 - distance for cosine)
                let similarity = 1.0 - distance;
                results.push(SimilarityResult {
                    sample_id,
                    similarity,
                    distance: *distance,
                });
            }
        }

        // Sort by similarity (highest first)
        results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

        Ok(results)
    }

    /// Find samples similar to a given sample ID.
    pub fn find_similar(
        &self,
        db: &Database,
        sample_id: i64,
        k: usize,
        aspects: Option<&SearchAspects>,
    ) -> Result<Vec<SimilarityResult>> {
        let embedding = db
            .get_embedding(sample_id)?
            .ok_or(Error::EmbeddingNotFound(sample_id))?;

        let mut results = self.search(&embedding, k + 1, aspects)?;

        // Remove the query sample from results
        results.retain(|r| r.sample_id != sample_id);

        // Trim to k results
        results.truncate(k);

        Ok(results)
    }

    /// Build index from database.
    pub fn build_from_database(&mut self, db: &Database) -> Result<usize> {
        let embeddings = db.get_all_embeddings()?;
        let count = embeddings.len();

        if count == 0 {
            return Ok(0);
        }

        // Reserve capacity for all embeddings (usearch requires this)
        self.index
            .reserve(count)
            .map_err(|e| Error::Index(format!("Failed to reserve index capacity: {}", e)))?;

        for (sample_id, embedding) in embeddings {
            self.add(sample_id, &embedding)?;
        }

        Ok(count)
    }

    /// Get the number of samples in the index.
    pub fn len(&self) -> usize {
        self.position_to_id.len()
    }

    /// Check if the index is empty.
    pub fn is_empty(&self) -> bool {
        self.position_to_id.is_empty()
    }
}

impl Default for SimilaritySearch {
    fn default() -> Self {
        Self::new().expect("Failed to create default SimilaritySearch")
    }
}

/// Brute-force similarity search (for small collections or verification).
///
/// This is slower than the ANN index but guaranteed to be exact.
pub fn brute_force_search(
    query: &[f32],
    embeddings: &[(i64, Vec<f32>)],
    k: usize,
    aspects: Option<&SearchAspects>,
) -> Vec<SimilarityResult> {
    let query_weighted = match aspects {
        Some(a) => a.apply_weights(query),
        None => query.to_vec(),
    };

    let mut results: Vec<SimilarityResult> = embeddings
        .iter()
        .map(|(sample_id, emb)| {
            let emb_weighted = match aspects {
                Some(a) => a.apply_weights(emb),
                None => emb.clone(),
            };
            let similarity = cosine_similarity(&query_weighted, &emb_weighted);
            SimilarityResult {
                sample_id: *sample_id,
                similarity,
                distance: 1.0 - similarity,
            }
        })
        .collect();

    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(k);

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aspect_weights() {
        let aspects = SearchAspects::timbre_focused();
        let embedding: Vec<f32> = (0..EMBEDDING_DIM).map(|i| i as f32 / EMBEDDING_DIM as f32).collect();

        let weighted = aspects.apply_weights(&embedding);
        assert_eq!(weighted.len(), EMBEDDING_DIM);

        // Verify the vector is normalized
        let norm: f32 = weighted.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_brute_force_search() {
        let query = vec![1.0f32; EMBEDDING_DIM];
        let embeddings = vec![
            (1, vec![1.0f32; EMBEDDING_DIM]),  // Identical
            (2, vec![0.5f32; EMBEDDING_DIM]),  // Similar
            (3, vec![-1.0f32; EMBEDDING_DIM]), // Opposite
        ];

        let results = brute_force_search(&query, &embeddings, 3, None);

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].sample_id, 1); // Most similar
        assert_eq!(results[2].sample_id, 3); // Least similar
    }
}
