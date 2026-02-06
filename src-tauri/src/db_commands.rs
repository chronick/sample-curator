//! Core CRUD Tauri commands for database operations.
//!
//! Replaces the Python sidecar's DB handlers with native Rust commands
//! that operate directly on sample-library-core's Database.

use sample_library_core::db::{Database, Pack, Sample};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// State for database operations.
pub struct DbState {
    db: Mutex<Option<Database>>,
}

impl DbState {
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

impl Default for DbState {
    fn default() -> Self {
        Self::new()
    }
}

fn get_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Could not find home directory")?;
    let path = home
        .join(".music-hub-data")
        .join("sample-library")
        .join("library.db");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

// ============ Input/Output Types ============

/// Search filters input from the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct SearchFiltersInput {
    pub query: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pack_id: Option<i64>,
    pub min_score: Option<f64>,
    pub max_score: Option<f64>,
    pub sample_type: Option<String>,
    pub min_bpm: Option<f64>,
    pub max_bpm: Option<f64>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Enriched sample response with tags and pack name.
#[derive(Debug, Clone, Serialize)]
pub struct SampleResponse {
    #[serde(flatten)]
    pub sample: Sample,
    pub tags: Vec<String>,
    pub pack_name: Option<String>,
}

/// Search result with total count.
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub samples: Vec<SampleResponse>,
    pub total: i64,
}

/// Partial updates for a sample.
#[derive(Debug, Clone, Deserialize)]
pub struct SampleUpdates {
    pub sample_type: Option<String>,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub quality_score: Option<f64>,
    pub applicability_score: Option<f64>,
    pub description: Option<String>,
}

/// Allowlist of sortable column names to prevent SQL injection.
const SORT_ALLOWLIST: &[&str] = &[
    "path",
    "sample_type",
    "bpm",
    "key",
    "duration",
    "quality_score",
    "applicability_score",
    "created_at",
    "updated_at",
    "rms_db",
    "spectral_centroid",
    "spectral_flatness",
    "crest_factor",
    "dynamic_range",
];

// ============ Helper Functions ============

/// Build a SampleResponse from a Sample by fetching tags and pack name.
fn enrich_sample(db: &Database, sample: Sample) -> Result<SampleResponse, String> {
    let tags = db
        .get_sample_tags(sample.id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| t.name)
        .collect();

    let pack_name = if let Some(pack_id) = sample.pack_id {
        db.get_pack(pack_id)
            .map_err(|e| e.to_string())?
            .map(|p| p.name)
    } else {
        None
    };

    Ok(SampleResponse {
        sample,
        tags,
        pack_name,
    })
}

// ============ Tauri Commands ============

/// Validate a sort field against the allowlist.
pub(crate) fn validate_sort_field(field: &str) -> bool {
    SORT_ALLOWLIST.contains(&field)
}

/// Execute a search query against the database (testable without Tauri State).
pub(crate) fn execute_search(
    db: &Database,
    filters: &SearchFiltersInput,
) -> Result<SearchResult, String> {
    let conn = db.connection();

    // Build dynamic SQL
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    // Text query (path LIKE)
    if let Some(ref query) = filters.query {
        if !query.is_empty() {
            conditions.push(format!("s.path LIKE ?{}", param_idx));
            params.push(Box::new(format!("%{}%", query)));
            param_idx += 1;
        }
    }

    // Sample type
    if let Some(ref sample_type) = filters.sample_type {
        if !sample_type.is_empty() {
            conditions.push(format!("s.sample_type = ?{}", param_idx));
            params.push(Box::new(sample_type.clone()));
            param_idx += 1;
        }
    }

    // BPM range
    if let Some(min_bpm) = filters.min_bpm {
        conditions.push(format!("s.bpm >= ?{}", param_idx));
        params.push(Box::new(min_bpm));
        param_idx += 1;
    }
    if let Some(max_bpm) = filters.max_bpm {
        conditions.push(format!("s.bpm <= ?{}", param_idx));
        params.push(Box::new(max_bpm));
        param_idx += 1;
    }

    // Score range (applicability_score)
    if let Some(min_score) = filters.min_score {
        conditions.push(format!("s.applicability_score >= ?{}", param_idx));
        params.push(Box::new(min_score));
        param_idx += 1;
    }
    if let Some(max_score) = filters.max_score {
        conditions.push(format!("s.applicability_score <= ?{}", param_idx));
        params.push(Box::new(max_score));
        param_idx += 1;
    }

    // Pack filter
    if let Some(pack_id) = filters.pack_id {
        conditions.push(format!("s.pack_id = ?{}", param_idx));
        params.push(Box::new(pack_id));
        param_idx += 1;
    }

    // Tag filtering: for each tag, require sample to have it
    if let Some(ref tags) = filters.tags {
        for tag_name in tags {
            if !tag_name.is_empty() {
                conditions.push(format!(
                    "s.id IN (SELECT st.sample_id FROM sample_tag st JOIN tags t ON st.tag_id = t.id WHERE t.name = ?{})",
                    param_idx
                ));
                params.push(Box::new(tag_name.clone()));
                param_idx += 1;
            }
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    // Count total
    let count_sql = format!("SELECT COUNT(*) FROM samples s{}", where_clause);
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn
        .query_row(&count_sql, rusqlite::params_from_iter(&param_refs), |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    // Sort
    let sort_field = filters
        .sort_field
        .as_deref()
        .filter(|f| SORT_ALLOWLIST.contains(f))
        .unwrap_or("applicability_score");

    let sort_dir = match filters.sort_direction.as_deref() {
        Some("asc") | Some("ASC") => "ASC",
        _ => "DESC",
    };

    let order_clause = format!(" ORDER BY s.{} {} NULLS LAST", sort_field, sort_dir);

    // Pagination
    let limit = filters.limit.unwrap_or(100);
    let offset = filters.offset.unwrap_or(0);
    let pagination = format!(" LIMIT {} OFFSET {}", limit, offset);

    // Full query
    let select_sql = format!(
        "SELECT s.* FROM samples s{}{}{}",
        where_clause, order_clause, pagination
    );

    let mut stmt = conn.prepare(&select_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(&param_refs), |row| {
            Sample::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    let mut samples = Vec::new();
    for row_result in rows {
        let sample = row_result.map_err(|e| e.to_string())?;
        let enriched = enrich_sample(db, sample)?;
        samples.push(enriched);
    }

    Ok(SearchResult { samples, total })
}

/// Search samples with rich filtering.
#[tauri::command]
pub fn db_search(
    filters: SearchFiltersInput,
    state: State<'_, DbState>,
) -> Result<SearchResult, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_search(db, &filters)
}

/// Get a single sample by ID.
#[tauri::command]
pub fn db_get_sample(id: i64, state: State<'_, DbState>) -> Result<SampleResponse, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let sample = db
        .get_sample(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", id))?;

    enrich_sample(db, sample)
}

/// Execute a sample update (testable without Tauri State).
pub(crate) fn execute_update_sample(
    db: &Database,
    id: i64,
    updates: &SampleUpdates,
) -> Result<SampleResponse, String> {
    let conn = db.connection();

    // Build dynamic UPDATE
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref sample_type) = updates.sample_type {
        set_clauses.push(format!("sample_type = ?{}", param_idx));
        params.push(Box::new(sample_type.clone()));
        param_idx += 1;
    }
    if let Some(bpm) = updates.bpm {
        set_clauses.push(format!("bpm = ?{}", param_idx));
        params.push(Box::new(bpm));
        param_idx += 1;
    }
    if let Some(ref key) = updates.key {
        set_clauses.push(format!("key = ?{}", param_idx));
        params.push(Box::new(key.clone()));
        param_idx += 1;
    }
    if let Some(quality_score) = updates.quality_score {
        set_clauses.push(format!("quality_score = ?{}", param_idx));
        params.push(Box::new(quality_score));
        param_idx += 1;
    }
    if let Some(applicability_score) = updates.applicability_score {
        set_clauses.push(format!("applicability_score = ?{}", param_idx));
        params.push(Box::new(applicability_score));
        param_idx += 1;
    }

    if set_clauses.is_empty() {
        // Nothing to update, just return the current sample
        let sample = db
            .get_sample(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Sample {} not found", id))?;
        return enrich_sample(db, sample);
    }

    set_clauses.push("updated_at = CURRENT_TIMESTAMP".to_string());

    let sql = format!(
        "UPDATE samples SET {} WHERE id = ?{}",
        set_clauses.join(", "),
        param_idx
    );
    params.push(Box::new(id));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, rusqlite::params_from_iter(&param_refs))
        .map_err(|e| e.to_string())?;

    // Return updated sample
    let sample = db
        .get_sample(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found after update", id))?;

    enrich_sample(db, sample)
}

/// Update a sample's metadata.
#[tauri::command]
pub fn db_update_sample(
    id: i64,
    updates: SampleUpdates,
    state: State<'_, DbState>,
) -> Result<SampleResponse, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_update_sample(db, id, &updates)
}

/// Execute a sample delete (testable without Tauri State).
pub(crate) fn execute_delete_sample(db: &Database, id: i64) -> Result<bool, String> {
    let rows = db
        .connection()
        .execute("DELETE FROM samples WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(rows > 0)
}

/// Delete a sample by ID.
#[tauri::command]
pub fn db_delete_sample(id: i64, state: State<'_, DbState>) -> Result<bool, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_delete_sample(db, id)
}

/// List all packs.
#[tauri::command]
pub fn db_list_packs(state: State<'_, DbState>) -> Result<Vec<Pack>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_packs().map_err(|e| e.to_string())
}

/// List all tag names.
#[tauri::command]
pub fn db_list_tags(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let tags = db.get_tags().map_err(|e| e.to_string())?;
    Ok(tags.into_iter().map(|t| t.name).collect())
}

/// Add tags to a sample.
#[tauri::command]
pub fn db_add_tags(
    sample_id: i64,
    tags: Vec<String>,
    state: State<'_, DbState>,
) -> Result<SampleResponse, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    for tag_name in &tags {
        db.add_tag_to_sample(sample_id, tag_name)
            .map_err(|e| e.to_string())?;
    }

    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    enrich_sample(db, sample)
}

/// Remove tags from a sample.
#[tauri::command]
pub fn db_remove_tags(
    sample_id: i64,
    tags: Vec<String>,
    state: State<'_, DbState>,
) -> Result<SampleResponse, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    for tag_name in &tags {
        db.remove_tag_from_sample(sample_id, tag_name)
            .map_err(|e| e.to_string())?;
    }

    let sample = db
        .get_sample(sample_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Sample {} not found", sample_id))?;

    enrich_sample(db, sample)
}

/// Execute batch update (testable without Tauri State).
pub(crate) fn execute_batch_update(
    db: &Database,
    ids: &[i64],
    updates: &SampleUpdates,
) -> Result<usize, String> {
    let conn = db.connection();

    let mut count = 0;

    // Build SET clauses once
    let mut set_parts: Vec<String> = Vec::new();
    let mut param_idx = 1;

    if updates.sample_type.is_some() {
        set_parts.push(format!("sample_type = ?{}", param_idx));
        param_idx += 1;
    }
    if updates.bpm.is_some() {
        set_parts.push(format!("bpm = ?{}", param_idx));
        param_idx += 1;
    }
    if updates.key.is_some() {
        set_parts.push(format!("key = ?{}", param_idx));
        param_idx += 1;
    }
    if updates.quality_score.is_some() {
        set_parts.push(format!("quality_score = ?{}", param_idx));
        param_idx += 1;
    }
    if updates.applicability_score.is_some() {
        set_parts.push(format!("applicability_score = ?{}", param_idx));
        param_idx += 1;
    }

    if set_parts.is_empty() {
        return Ok(0);
    }

    set_parts.push("updated_at = CURRENT_TIMESTAMP".to_string());

    let sql = format!(
        "UPDATE samples SET {} WHERE id = ?{}",
        set_parts.join(", "),
        param_idx
    );

    for id in ids {
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(ref sample_type) = updates.sample_type {
            params.push(Box::new(sample_type.clone()));
        }
        if let Some(bpm) = updates.bpm {
            params.push(Box::new(bpm));
        }
        if let Some(ref key) = updates.key {
            params.push(Box::new(key.clone()));
        }
        if let Some(quality_score) = updates.quality_score {
            params.push(Box::new(quality_score));
        }
        if let Some(applicability_score) = updates.applicability_score {
            params.push(Box::new(applicability_score));
        }
        params.push(Box::new(*id));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let rows = conn
            .execute(&sql, rusqlite::params_from_iter(&param_refs))
            .map_err(|e| e.to_string())?;
        if rows > 0 {
            count += 1;
        }
    }

    Ok(count)
}

/// Batch update samples.
#[tauri::command]
pub fn db_batch_update(
    ids: Vec<i64>,
    updates: SampleUpdates,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_batch_update(db, &ids, &updates)
}

/// Execute batch delete (testable without Tauri State).
pub(crate) fn execute_batch_delete(db: &Database, ids: &[i64]) -> Result<usize, String> {
    let conn = db.connection();

    let mut count = 0;
    for id in ids {
        let rows = conn
            .execute("DELETE FROM samples WHERE id = ?1", [*id])
            .map_err(|e| e.to_string())?;
        if rows > 0 {
            count += 1;
        }
    }

    Ok(count)
}

/// Batch delete samples.
#[tauri::command]
pub fn db_batch_delete(ids: Vec<i64>, state: State<'_, DbState>) -> Result<usize, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_batch_delete(db, &ids)
}

/// Batch add tags to samples.
#[tauri::command]
pub fn db_batch_add_tags(
    ids: Vec<i64>,
    tags: Vec<String>,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let mut count = 0;
    for id in &ids {
        for tag_name in &tags {
            db.add_tag_to_sample(*id, tag_name)
                .map_err(|e| e.to_string())?;
        }
        count += 1;
    }

    Ok(count)
}

/// Execute type counts query (testable without Tauri State).
pub(crate) fn execute_type_counts(db: &Database) -> Result<Vec<(String, i64)>, String> {
    let conn = db.connection();

    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(sample_type, 'unknown'), COUNT(*) FROM samples GROUP BY sample_type ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let sample_type: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((sample_type, count))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// Get sample counts by type (for PackTree).
#[tauri::command]
pub fn db_get_type_counts(state: State<'_, DbState>) -> Result<Vec<(String, i64)>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    execute_type_counts(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sample_library_core::db::Database;

    /// Helper: create in-memory DB and insert a sample, returning (db, sample_id).
    fn setup_db_with_sample() -> (Database, i64) {
        let db = Database::open_in_memory().expect("open in-memory db");
        let id = db
            .insert_sample("/samples/kick01.wav", Some("imported"), Some("kick"), Some(0.5), Some(44100), Some(2), None)
            .expect("insert sample");
        (db, id)
    }

    /// Helper: insert N samples with varying types and BPMs.
    fn setup_db_with_samples(n: usize) -> (Database, Vec<i64>) {
        let db = Database::open_in_memory().expect("open in-memory db");
        let types = ["kick", "snare", "hihat", "bass", "synth"];
        let mut ids = Vec::new();
        for i in 0..n {
            let path = format!("/samples/sample_{:03}.wav", i);
            let sample_type = types[i % types.len()];
            let bpm = 100.0 + (i as f64) * 10.0;
            let id = db
                .insert_sample(&path, Some("imported"), Some(sample_type), Some(0.5), Some(44100), Some(2), None)
                .expect("insert sample");
            // Set BPM and applicability_score via raw SQL
            db.connection()
                .execute(
                    "UPDATE samples SET bpm = ?1, applicability_score = ?2 WHERE id = ?3",
                    rusqlite::params![bpm, (i as f64) * 10.0, id],
                )
                .expect("set bpm/score");
            ids.push(id);
        }
        (db, ids)
    }

    // ============ enrich_sample tests ============

    #[test]
    fn test_enrich_sample_with_tags() {
        let (db, id) = setup_db_with_sample();
        db.add_tag_to_sample(id, "dark").unwrap();
        db.add_tag_to_sample(id, "heavy").unwrap();

        let sample = db.get_sample(id).unwrap().unwrap();
        let enriched = enrich_sample(&db, sample).unwrap();

        assert!(enriched.tags.contains(&"dark".to_string()));
        assert!(enriched.tags.contains(&"heavy".to_string()));
        assert_eq!(enriched.tags.len(), 2);
    }

    #[test]
    fn test_enrich_sample_with_pack() {
        let db = Database::open_in_memory().expect("open in-memory db");
        let pack_id = db.get_or_create_pack("/packs/techno", "Techno Pack", Some("imported")).unwrap();
        let id = db
            .insert_sample("/samples/kick01.wav", Some("imported"), Some("kick"), Some(0.5), Some(44100), Some(2), Some(pack_id))
            .expect("insert sample");

        let sample = db.get_sample(id).unwrap().unwrap();
        let enriched = enrich_sample(&db, sample).unwrap();

        assert_eq!(enriched.pack_name, Some("Techno Pack".to_string()));
    }

    #[test]
    fn test_enrich_sample_no_pack() {
        let (db, id) = setup_db_with_sample();
        let sample = db.get_sample(id).unwrap().unwrap();
        let enriched = enrich_sample(&db, sample).unwrap();

        assert_eq!(enriched.pack_name, None);
    }

    // ============ Sort allowlist tests ============

    #[test]
    fn test_sort_allowlist_accepts_valid() {
        assert!(validate_sort_field("bpm"));
        assert!(validate_sort_field("path"));
        assert!(validate_sort_field("quality_score"));
        assert!(validate_sort_field("spectral_centroid"));
    }

    #[test]
    fn test_sort_allowlist_rejects_invalid() {
        assert!(!validate_sort_field("DROP TABLE"));
        assert!(!validate_sort_field("unknown_field"));
        assert!(!validate_sort_field(""));
        assert!(!validate_sort_field("id"));
    }

    // ============ Search tests ============

    #[test]
    fn test_search_no_filters() {
        let (db, ids) = setup_db_with_samples(5);
        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: None, min_score: None,
            max_score: None, sample_type: None, min_bpm: None, max_bpm: None,
            sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        assert_eq!(result.total, 5);
        assert_eq!(result.samples.len(), 5);
    }

    #[test]
    fn test_search_text_query() {
        let (db, _) = setup_db_with_samples(5);
        let filters = SearchFiltersInput {
            query: Some("sample_001".to_string()), tags: None, pack_id: None,
            min_score: None, max_score: None, sample_type: None, min_bpm: None,
            max_bpm: None, sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        assert_eq!(result.total, 1);
        assert!(result.samples[0].sample.path.contains("sample_001"));
    }

    #[test]
    fn test_search_by_type() {
        let (db, _) = setup_db_with_samples(10);
        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: None, min_score: None,
            max_score: None, sample_type: Some("kick".to_string()), min_bpm: None,
            max_bpm: None, sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        // 10 samples with types cycling through 5 types = 2 kicks
        assert_eq!(result.total, 2);
        for s in &result.samples {
            assert_eq!(s.sample.sample_type.as_deref(), Some("kick"));
        }
    }

    #[test]
    fn test_search_by_bpm_range() {
        let (db, _) = setup_db_with_samples(10);
        // BPMs are 100, 110, 120, ..., 190
        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: None, min_score: None,
            max_score: None, sample_type: None, min_bpm: Some(120.0),
            max_bpm: Some(150.0), sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        // 120, 130, 140, 150 = 4 samples
        assert_eq!(result.total, 4);
    }

    #[test]
    fn test_search_by_score_range() {
        let (db, _) = setup_db_with_samples(10);
        // Scores are 0, 10, 20, ..., 90
        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: None, min_score: Some(50.0),
            max_score: Some(80.0), sample_type: None, min_bpm: None,
            max_bpm: None, sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        // 50, 60, 70, 80 = 4 samples
        assert_eq!(result.total, 4);
    }

    #[test]
    fn test_search_by_pack() {
        let db = Database::open_in_memory().expect("open in-memory db");
        let pack_id = db.get_or_create_pack("/packs/techno", "Techno", Some("imported")).unwrap();
        db.insert_sample("/s/a.wav", Some("imported"), Some("kick"), Some(0.5), Some(44100), Some(2), Some(pack_id)).unwrap();
        db.insert_sample("/s/b.wav", Some("imported"), Some("snare"), Some(0.5), Some(44100), Some(2), None).unwrap();

        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: Some(pack_id), min_score: None,
            max_score: None, sample_type: None, min_bpm: None, max_bpm: None,
            sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        assert_eq!(result.total, 1);
    }

    #[test]
    fn test_search_by_tags() {
        let (db, id) = setup_db_with_sample();
        db.add_tag_to_sample(id, "dark").unwrap();
        // Insert a second sample without the tag
        db.insert_sample("/samples/kick02.wav", Some("imported"), Some("kick"), Some(0.5), Some(44100), Some(2), None).unwrap();

        let filters = SearchFiltersInput {
            query: None, tags: Some(vec!["dark".to_string()]), pack_id: None,
            min_score: None, max_score: None, sample_type: None, min_bpm: None,
            max_bpm: None, sort_field: None, sort_direction: None, limit: None, offset: None,
        };
        let result = execute_search(&db, &filters).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.samples[0].sample.id, id);
    }

    #[test]
    fn test_search_sort_and_pagination() {
        let (db, _) = setup_db_with_samples(10);
        let filters = SearchFiltersInput {
            query: None, tags: None, pack_id: None, min_score: None,
            max_score: None, sample_type: None, min_bpm: None, max_bpm: None,
            sort_field: Some("bpm".to_string()), sort_direction: Some("asc".to_string()),
            limit: Some(3), offset: Some(2),
        };
        let result = execute_search(&db, &filters).unwrap();
        assert_eq!(result.total, 10);
        assert_eq!(result.samples.len(), 3);
        // BPM ascending: 100, 110, 120, 130, ... offset 2 = 120
        assert_eq!(result.samples[0].sample.bpm, Some(120.0));
    }

    // ============ Update tests ============

    #[test]
    fn test_update_sample_fields() {
        let (db, id) = setup_db_with_sample();
        let updates = SampleUpdates {
            sample_type: None,
            bpm: Some(128.0),
            key: Some("Am".to_string()),
            quality_score: Some(85.0),
            applicability_score: Some(90.0),
            description: None,
        };
        let result = execute_update_sample(&db, id, &updates).unwrap();
        assert_eq!(result.sample.bpm, Some(128.0));
        assert_eq!(result.sample.key, Some("Am".to_string()));
        assert_eq!(result.sample.quality_score, Some(85.0));
        assert_eq!(result.sample.applicability_score, Some(90.0));
    }

    #[test]
    fn test_update_sample_empty() {
        let (db, id) = setup_db_with_sample();
        let updates = SampleUpdates {
            sample_type: None, bpm: None, key: None,
            quality_score: None, applicability_score: None, description: None,
        };
        let result = execute_update_sample(&db, id, &updates).unwrap();
        assert_eq!(result.sample.id, id);
    }

    // ============ Delete tests ============

    #[test]
    fn test_delete_sample() {
        let (db, id) = setup_db_with_sample();
        assert!(execute_delete_sample(&db, id).unwrap());
        assert!(!execute_delete_sample(&db, id).unwrap()); // already deleted
    }

    // ============ Batch tests ============

    #[test]
    fn test_batch_update() {
        let (db, ids) = setup_db_with_samples(5);
        let updates = SampleUpdates {
            sample_type: None, bpm: Some(140.0), key: None,
            quality_score: None, applicability_score: None, description: None,
        };
        let count = execute_batch_update(&db, &ids[0..3], &updates).unwrap();
        assert_eq!(count, 3);

        let s = db.get_sample(ids[0]).unwrap().unwrap();
        assert_eq!(s.bpm, Some(140.0));

        // Unmodified sample retains original BPM
        let s4 = db.get_sample(ids[4]).unwrap().unwrap();
        assert_eq!(s4.bpm, Some(140.0)); // was 100 + 4*10 = 140 by setup, coincidence
        let s3 = db.get_sample(ids[3]).unwrap().unwrap();
        assert_eq!(s3.bpm, Some(130.0)); // was 100 + 3*10 = 130, NOT modified
    }

    #[test]
    fn test_batch_delete() {
        let (db, ids) = setup_db_with_samples(5);
        let count = execute_batch_delete(&db, &ids[0..2]).unwrap();
        assert_eq!(count, 2);
        assert!(db.get_sample(ids[0]).unwrap().is_none());
        assert!(db.get_sample(ids[1]).unwrap().is_none());
        assert!(db.get_sample(ids[2]).unwrap().is_some());
    }

    // ============ Type counts tests ============

    #[test]
    fn test_type_counts() {
        let (db, _) = setup_db_with_samples(10);
        let counts = execute_type_counts(&db).unwrap();
        // 10 samples, 5 types cycling = 2 each
        assert!(!counts.is_empty());
        let total: i64 = counts.iter().map(|(_, c)| c).sum();
        assert_eq!(total, 10);
    }

    // ============ Tag operation tests ============

    #[test]
    fn test_add_and_remove_tags() {
        let (db, id) = setup_db_with_sample();
        db.add_tag_to_sample(id, "dark").unwrap();
        db.add_tag_to_sample(id, "heavy").unwrap();

        let tags: Vec<String> = db.get_sample_tags(id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tags.len(), 2);

        db.remove_tag_from_sample(id, "dark").unwrap();
        let tags: Vec<String> = db.get_sample_tags(id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tags.len(), 1);
        assert!(tags.contains(&"heavy".to_string()));
    }

    #[test]
    fn test_batch_add_tags() {
        let (db, ids) = setup_db_with_samples(3);
        for id in &ids {
            db.add_tag_to_sample(*id, "live-ready").unwrap();
        }
        for id in &ids {
            let tags: Vec<String> = db.get_sample_tags(*id).unwrap().into_iter().map(|t| t.name).collect();
            assert!(tags.contains(&"live-ready".to_string()));
        }
    }
}
