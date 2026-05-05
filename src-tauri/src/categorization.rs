//! Smart categorization commands.
//!
//! Derives acoustic property tags from sample features.

use sample_library_core::{
    categorization::{categorize_sample, suggest_sample_type, AcousticTags},
    db::Database,
};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// State for categorization operations.
pub struct CategorizationState {
    db: Mutex<Option<Database>>,
}

impl CategorizationState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
        }
    }

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

impl Default for CategorizationState {
    fn default() -> Self {
        Self::new()
    }
}

fn get_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Could not find home directory")?;
    let path = home.join(".music-hub-data").join("sample-library").join("library.db");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Get acoustic tags for a sample.
#[tauri::command]
pub fn get_acoustic_tags(
    sample_id: i64,
    state: State<'_, CategorizationState>,
) -> Result<AcousticTags, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    Ok(categorize_sample(&sample))
}

/// Suggest a sample type based on acoustic properties.
#[tauri::command]
pub fn suggest_type(
    sample_id: i64,
    state: State<'_, CategorizationState>,
) -> Result<Option<String>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    Ok(suggest_sample_type(&sample))
}

/// Get acoustic tags for multiple samples.
#[tauri::command]
pub fn batch_get_acoustic_tags(
    sample_ids: Vec<i64>,
    state: State<'_, CategorizationState>,
) -> Result<Vec<(i64, AcousticTags)>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let samples = db.get_samples_by_ids(&sample_ids).map_err(|e| e.to_string())?;

    let results: Vec<(i64, AcousticTags)> = samples
        .iter()
        .map(|s| (s.id, categorize_sample(s)))
        .collect();

    Ok(results)
}
