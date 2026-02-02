//! Duplicate management commands.
//!
//! Provides UI for viewing and resolving duplicate samples.

use sample_library_core::db::{Database, Sample};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// State for duplicate management.
pub struct DuplicateState {
    db: Mutex<Option<Database>>,
}

impl DuplicateState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
        }
    }

    fn get_db(&self) -> Result<std::sync::MutexGuard<Option<Database>>, String> {
        let mut guard = self.db.lock().map_err(|e| e.to_string())?;

        if guard.is_none() {
            let db_path = get_db_path()?;
            let db = Database::open(&db_path).map_err(|e| e.to_string())?;
            *guard = Some(db);
        }

        Ok(guard)
    }
}

impl Default for DuplicateState {
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

/// A group of duplicate samples.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub fingerprint_hash: String,
    pub samples: Vec<DuplicateSample>,
    pub total_size_bytes: u64,
    pub potential_savings_bytes: u64,
}

/// A sample in a duplicate group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateSample {
    pub id: i64,
    pub path: String,
    pub size_bytes: u64,
    pub quality_score: Option<f64>,
    pub created_at: Option<String>,
}

/// Get all duplicate groups.
#[tauri::command]
pub fn get_duplicate_groups(
    state: State<'_, DuplicateState>,
) -> Result<Vec<DuplicateGroup>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let groups = db.get_duplicate_groups().map_err(|e| e.to_string())?;

    let result: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter_map(|samples| {
            if samples.len() < 2 {
                return None;
            }

            let fingerprint_hash = samples[0].fingerprint_hash.clone()?;

            let dup_samples: Vec<DuplicateSample> = samples
                .iter()
                .map(|s| {
                    let size_bytes = std::fs::metadata(&s.path)
                        .map(|m| m.len())
                        .unwrap_or(0);

                    DuplicateSample {
                        id: s.id,
                        path: s.path.clone(),
                        size_bytes,
                        quality_score: s.quality_score,
                        created_at: s.created_at.clone(),
                    }
                })
                .collect();

            let total_size: u64 = dup_samples.iter().map(|s| s.size_bytes).sum();
            let max_size = dup_samples.iter().map(|s| s.size_bytes).max().unwrap_or(0);
            let savings = total_size.saturating_sub(max_size);

            Some(DuplicateGroup {
                fingerprint_hash,
                samples: dup_samples,
                total_size_bytes: total_size,
                potential_savings_bytes: savings,
            })
        })
        .collect();

    Ok(result)
}

/// Get duplicate statistics.
#[tauri::command]
pub fn get_duplicate_stats(
    state: State<'_, DuplicateState>,
) -> Result<DuplicateStats, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let groups = db.get_duplicate_groups().map_err(|e| e.to_string())?;

    let total_groups = groups.len();
    let total_duplicates: usize = groups.iter().map(|g| g.len().saturating_sub(1)).sum();

    let mut total_wasted_bytes: u64 = 0;
    for group in &groups {
        let sizes: Vec<u64> = group
            .iter()
            .filter_map(|s| std::fs::metadata(&s.path).ok().map(|m| m.len()))
            .collect();
        let max_size = sizes.iter().max().copied().unwrap_or(0);
        let total_size: u64 = sizes.iter().sum();
        total_wasted_bytes += total_size.saturating_sub(max_size);
    }

    Ok(DuplicateStats {
        total_groups: total_groups as i64,
        total_duplicates: total_duplicates as i64,
        potential_savings_bytes: total_wasted_bytes,
    })
}

/// Duplicate statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateStats {
    pub total_groups: i64,
    pub total_duplicates: i64,
    pub potential_savings_bytes: u64,
}

/// Delete a sample (used for resolving duplicates).
#[tauri::command]
pub fn delete_duplicate(
    sample_id: i64,
    delete_file: bool,
    state: State<'_, DuplicateState>,
) -> Result<bool, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get sample path before deleting
    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    // Delete from database
    db.connection()
        .execute("DELETE FROM samples WHERE id = ?1", [sample_id])
        .map_err(|e| e.to_string())?;

    // Optionally delete file
    if delete_file {
        if let Err(e) = std::fs::remove_file(&sample.path) {
            // Log but don't fail - the DB entry is already deleted
            eprintln!("Failed to delete file {}: {}", sample.path, e);
        }
    }

    Ok(true)
}

/// Keep one sample from a group and delete the rest.
#[tauri::command]
pub fn resolve_duplicate_group(
    keep_sample_id: i64,
    delete_sample_ids: Vec<i64>,
    delete_files: bool,
    state: State<'_, DuplicateState>,
) -> Result<usize, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let mut deleted = 0;

    for sample_id in delete_sample_ids {
        if sample_id == keep_sample_id {
            continue; // Don't delete the one we're keeping
        }

        // Get sample path
        if let Ok(Some(sample)) = db.get_sample(sample_id) {
            // Delete from database
            if db
                .connection()
                .execute("DELETE FROM samples WHERE id = ?1", [sample_id])
                .is_ok()
            {
                deleted += 1;

                // Optionally delete file
                if delete_files {
                    let _ = std::fs::remove_file(&sample.path);
                }
            }
        }
    }

    Ok(deleted)
}
