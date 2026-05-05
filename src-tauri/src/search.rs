//! Similarity and compatibility search commands.
//!
//! These commands use the Rust sample-library-core for fast search operations.

use sample_library_core::{
    compatibility::{CompatibilityCriteria, CompatibilityResult, CompatibilitySearch},
    db::Database,
    embedding::EmbeddingExtractor,
    search::{SearchAspects, SimilarityResult, SimilaritySearch},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// State for search operations.
pub struct SearchState {
    /// Database connection.
    db: Mutex<Option<Database>>,
    /// Similarity search index.
    similarity_search: Mutex<Option<SimilaritySearch>>,
    /// Compatibility search engine.
    compatibility_search: CompatibilitySearch,
    /// Embedding extractor.
    embedding_extractor: EmbeddingExtractor,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
            similarity_search: Mutex::new(None),
            compatibility_search: CompatibilitySearch::new(),
            embedding_extractor: EmbeddingExtractor::new(),
        }
    }

    /// Get or initialize the database.
    fn get_db(&self) -> Result<std::sync::MutexGuard<'_, Option<Database>>, String> {
        let mut guard = self.db.lock().map_err(|e| e.to_string())?;

        if guard.is_none() {
            let db_path = get_db_path()?;
            let db = Database::open(&db_path).map_err(|e| e.to_string())?;
            *guard = Some(db);
        }

        Ok(guard)
    }
}

impl Default for SearchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the database path.
fn get_db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let path = home.join(".music-hub-data").join("sample-library").join("library.db");

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Aspect weights for similarity search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchAspectsInput {
    pub timbre: Option<f32>,
    pub pitch: Option<f32>,
    pub amplitude: Option<f32>,
    pub spectrum: Option<f32>,
}

impl From<SearchAspectsInput> for SearchAspects {
    fn from(input: SearchAspectsInput) -> Self {
        SearchAspects {
            timbre: input.timbre.unwrap_or(1.0),
            pitch: input.pitch.unwrap_or(1.0),
            amplitude: input.amplitude.unwrap_or(1.0),
            spectrum: input.spectrum.unwrap_or(1.0),
        }
    }
}

/// Criteria for compatibility search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityCriteriaInput {
    pub check_key: Option<bool>,
    pub check_bpm: Option<bool>,
    pub check_frequency: Option<bool>,
    pub check_dynamics: Option<bool>,
    pub bpm_tolerance: Option<f64>,
}

impl From<CompatibilityCriteriaInput> for CompatibilityCriteria {
    fn from(input: CompatibilityCriteriaInput) -> Self {
        CompatibilityCriteria {
            check_key: input.check_key.unwrap_or(true),
            check_bpm: input.check_bpm.unwrap_or(true),
            check_frequency: input.check_frequency.unwrap_or(true),
            check_dynamics: input.check_dynamics.unwrap_or(true),
            bpm_tolerance: input.bpm_tolerance.unwrap_or(0.05),
        }
    }
}

/// Find samples similar to a given sample.
#[tauri::command]
pub fn find_similar(
    sample_id: i64,
    limit: Option<usize>,
    aspects: Option<SearchAspectsInput>,
    state: State<'_, SearchState>,
) -> Result<Vec<SimilarityResult>, String> {
    let limit = limit.unwrap_or(20);
    let aspects = aspects.map(SearchAspects::from);

    // Get database
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get or initialize similarity search index
    let mut search_guard = state.similarity_search.lock().map_err(|e| e.to_string())?;

    if search_guard.is_none() {
        let mut search = SimilaritySearch::new().map_err(|e| e.to_string())?;

        // Build index from database
        let count = search.build_from_database(db).map_err(|e| e.to_string())?;
        println!("Built similarity index with {} embeddings", count);

        *search_guard = Some(search);
    }

    let search = search_guard.as_ref().ok_or("Search not initialized")?;

    // Perform search
    search
        .find_similar(db, sample_id, limit, aspects.as_ref())
        .map_err(|e| e.to_string())
}

/// Find samples compatible with a given sample.
#[tauri::command]
pub fn find_compatible(
    sample_id: i64,
    limit: Option<usize>,
    criteria: Option<CompatibilityCriteriaInput>,
    state: State<'_, SearchState>,
) -> Result<Vec<CompatibilityResult>, String> {
    let limit = limit.unwrap_or(20);
    let criteria = criteria.map(CompatibilityCriteria::from).unwrap_or_default();

    // Get database
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Perform compatibility search
    state
        .compatibility_search
        .find_compatible(db, sample_id, &criteria, limit)
        .map_err(|e| e.to_string())
}

/// Generate embedding for a sample.
#[tauri::command]
pub fn generate_embedding(
    sample_id: i64,
    state: State<'_, SearchState>,
) -> Result<bool, String> {
    // Get database
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get sample
    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    // Extract embedding
    let embedding = state
        .embedding_extractor
        .extract_from_file(&sample.path)
        .map_err(|e| e.to_string())?;

    // Store embedding
    db.store_embedding(sample_id, &embedding, sample_library_core::embedding::EMBEDDING_VERSION)
        .map_err(|e| e.to_string())?;

    // Update similarity index if it exists
    let mut search_guard = state.similarity_search.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut search) = *search_guard {
        search.add(sample_id, &embedding).map_err(|e| e.to_string())?;
    }

    Ok(true)
}

/// Generate embeddings for samples that don't have them.
#[tauri::command]
pub fn generate_missing_embeddings(
    batch_size: Option<i64>,
    state: State<'_, SearchState>,
) -> Result<usize, String> {
    let batch_size = batch_size.unwrap_or(100);

    // Get database
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Process samples without embeddings
    let count = state
        .embedding_extractor
        .process_pending(db, batch_size)
        .map_err(|e| e.to_string())?;

    // Rebuild index if we added embeddings
    if count > 0 {
        let mut search_guard = state.similarity_search.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut search) = *search_guard {
            search.build_from_database(db).map_err(|e| e.to_string())?;
        }
    }

    Ok(count)
}

/// Get search index statistics.
#[tauri::command]
pub fn get_search_stats(state: State<'_, SearchState>) -> Result<SearchStats, String> {
    // Get database
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let total_samples = db.count_samples().map_err(|e| e.to_string())?;
    let total_embeddings = db.count_embeddings().map_err(|e| e.to_string())?;

    let search_guard = state.similarity_search.lock().map_err(|e| e.to_string())?;
    let index_size = search_guard.as_ref().map(|s| s.len()).unwrap_or(0);

    Ok(SearchStats {
        total_samples,
        total_embeddings,
        index_size,
        index_loaded: search_guard.is_some(),
    })
}

/// Search statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchStats {
    pub total_samples: i64,
    pub total_embeddings: i64,
    pub index_size: usize,
    pub index_loaded: bool,
}

// Add dirs dependency for home_dir
// Note: This is a workaround - in production, you'd use tauri's path API
mod dirs {
    pub fn home_dir() -> Option<std::path::PathBuf> {
        std::env::var_os("HOME").map(std::path::PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_aspects_from_full() {
        let input = SearchAspectsInput {
            timbre: Some(0.5),
            pitch: Some(0.8),
            amplitude: Some(0.3),
            spectrum: Some(0.9),
        };
        let aspects: SearchAspects = input.into();
        assert_eq!(aspects.timbre, 0.5);
        assert_eq!(aspects.pitch, 0.8);
        assert_eq!(aspects.amplitude, 0.3);
        assert_eq!(aspects.spectrum, 0.9);
    }

    #[test]
    fn test_search_aspects_from_defaults() {
        let input = SearchAspectsInput {
            timbre: None,
            pitch: None,
            amplitude: None,
            spectrum: None,
        };
        let aspects: SearchAspects = input.into();
        assert_eq!(aspects.timbre, 1.0);
        assert_eq!(aspects.pitch, 1.0);
        assert_eq!(aspects.amplitude, 1.0);
        assert_eq!(aspects.spectrum, 1.0);
    }

    #[test]
    fn test_search_aspects_from_partial() {
        let input = SearchAspectsInput {
            timbre: Some(0.5),
            pitch: None,
            amplitude: Some(0.3),
            spectrum: None,
        };
        let aspects: SearchAspects = input.into();
        assert_eq!(aspects.timbre, 0.5);
        assert_eq!(aspects.pitch, 1.0);
        assert_eq!(aspects.amplitude, 0.3);
        assert_eq!(aspects.spectrum, 1.0);
    }

    #[test]
    fn test_compatibility_criteria_from_full() {
        let input = CompatibilityCriteriaInput {
            check_key: Some(false),
            check_bpm: Some(false),
            check_frequency: Some(false),
            check_dynamics: Some(false),
            bpm_tolerance: Some(0.1),
        };
        let criteria: CompatibilityCriteria = input.into();
        assert!(!criteria.check_key);
        assert!(!criteria.check_bpm);
        assert!(!criteria.check_frequency);
        assert!(!criteria.check_dynamics);
        assert_eq!(criteria.bpm_tolerance, 0.1);
    }

    #[test]
    fn test_compatibility_criteria_from_defaults() {
        let input = CompatibilityCriteriaInput {
            check_key: None,
            check_bpm: None,
            check_frequency: None,
            check_dynamics: None,
            bpm_tolerance: None,
        };
        let criteria: CompatibilityCriteria = input.into();
        assert!(criteria.check_key);
        assert!(criteria.check_bpm);
        assert!(criteria.check_frequency);
        assert!(criteria.check_dynamics);
        assert_eq!(criteria.bpm_tolerance, 0.05);
    }

    #[test]
    fn test_search_aspects_input_serialization() {
        let input = SearchAspectsInput {
            timbre: Some(0.5),
            pitch: None,
            amplitude: Some(1.0),
            spectrum: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let deserialized: SearchAspectsInput = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.timbre, Some(0.5));
        assert_eq!(deserialized.pitch, None);
    }

    #[test]
    fn test_compatibility_criteria_input_serialization() {
        let input = CompatibilityCriteriaInput {
            check_key: Some(true),
            check_bpm: Some(false),
            check_frequency: None,
            check_dynamics: None,
            bpm_tolerance: Some(0.1),
        };
        let json = serde_json::to_string(&input).unwrap();
        let deserialized: CompatibilityCriteriaInput = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.check_key, Some(true));
        assert_eq!(deserialized.check_bpm, Some(false));
        assert_eq!(deserialized.bpm_tolerance, Some(0.1));
    }

    #[test]
    fn test_search_stats_serialization() {
        let stats = SearchStats {
            total_samples: 1000,
            total_embeddings: 800,
            index_size: 500,
            index_loaded: true,
        };
        let json = serde_json::to_string(&stats).unwrap();
        let deserialized: SearchStats = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.total_samples, 1000);
        assert_eq!(deserialized.total_embeddings, 800);
        assert_eq!(deserialized.index_size, 500);
        assert!(deserialized.index_loaded);
    }
}
