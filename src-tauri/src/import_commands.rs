//! Import pipeline commands.
//!
//! Handles scanning directories and importing audio files into the database
//! with optional analysis. Runs imports in a background thread.

use crate::analysis_pipeline::{analyze_sample, AnalysisPipeline};
use sample_analysis_core::audio::get_audio_info;
use sample_library_core::db::Database;
use sample_library_core::watcher::scan_directory;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

/// State for import operations.
pub struct ImportState {
    jobs: Mutex<HashMap<String, Arc<Mutex<ImportProgress>>>>,
    cancel_flags: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
}

impl ImportState {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            cancel_flags: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ImportState {
    fn default() -> Self {
        Self::new()
    }
}

/// Import options from the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportOptionsInput {
    pub recursive: Option<bool>,
    pub analyze: Option<bool>,
    pub detect_duplicates: Option<bool>,
}

/// Import progress state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
    pub errors: Vec<(String, String)>,
    pub duplicates_skipped: usize,
    pub imported_count: usize,
}

impl Default for ImportProgress {
    fn default() -> Self {
        Self {
            phase: "scanning".to_string(),
            current: 0,
            total: 0,
            current_file: String::new(),
            errors: Vec::new(),
            duplicates_skipped: 0,
            imported_count: 0,
        }
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

/// Detect pack from directory structure.
/// Uses the immediate parent directory name as the pack name.
fn detect_pack_name(file_path: &Path, import_root: &Path) -> Option<(String, String)> {
    let parent = file_path.parent()?;
    if parent == import_root {
        // File is directly in the import root — use root dir name
        let name = import_root.file_name()?.to_str()?.to_string();
        let path = import_root.to_str()?.to_string();
        return Some((path, name));
    }

    // Use the first directory level below import root
    let relative = file_path.strip_prefix(import_root).ok()?;
    let first_component = relative.components().next()?;
    let pack_dir = import_root.join(first_component.as_os_str());
    let name = first_component.as_os_str().to_str()?.to_string();
    let path = pack_dir.to_str()?.to_string();
    Some((path, name))
}

/// Start an import job. Returns a job ID for progress polling.
#[tauri::command]
pub fn import_start(
    path: String,
    options: ImportOptionsInput,
    state: State<'_, ImportState>,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let progress = Arc::new(Mutex::new(ImportProgress::default()));
    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Store progress and cancel flag
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(job_id.clone(), progress.clone());
    }
    {
        let mut flags = state.cancel_flags.lock().map_err(|e| e.to_string())?;
        flags.insert(job_id.clone(), cancel_flag.clone());
    }

    let recursive = options.recursive.unwrap_or(true);
    let analyze = options.analyze.unwrap_or(true);
    let detect_duplicates = options.detect_duplicates.unwrap_or(true);
    let import_path = PathBuf::from(&path);

    // Spawn import thread
    std::thread::spawn(move || {
        run_import(
            &import_path,
            recursive,
            analyze,
            detect_duplicates,
            progress,
            cancel_flag,
        );
    });

    Ok(job_id)
}

/// Get progress for an import job.
#[tauri::command]
pub fn import_progress(
    job_id: String,
    state: State<'_, ImportState>,
) -> Result<ImportProgress, String> {
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let progress = jobs
        .get(&job_id)
        .ok_or_else(|| format!("Job {} not found", job_id))?;

    let guard = progress.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// Cancel an import job.
#[tauri::command]
pub fn import_cancel(job_id: String, state: State<'_, ImportState>) -> Result<bool, String> {
    let flags = state.cancel_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.get(&job_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Run the import pipeline in a background thread.
fn run_import(
    import_path: &Path,
    recursive: bool,
    analyze: bool,
    detect_duplicates: bool,
    progress: Arc<Mutex<ImportProgress>>,
    cancel_flag: Arc<std::sync::atomic::AtomicBool>,
) {
    // Phase 1: Scan
    {
        let mut p = progress.lock().unwrap();
        p.phase = "scanning".to_string();
    }

    let files = scan_directory(import_path, recursive);
    let total = files.len();

    {
        let mut p = progress.lock().unwrap();
        p.total = total;
        p.phase = "importing".to_string();
    }

    // Open our own DB connection for this thread
    let db_path = match get_db_path() {
        Ok(p) => p,
        Err(e) => {
            let mut p = progress.lock().unwrap();
            p.phase = "error".to_string();
            p.errors.push(("database".to_string(), e));
            return;
        }
    };

    let db = match Database::open(&db_path) {
        Ok(db) => db,
        Err(e) => {
            let mut p = progress.lock().unwrap();
            p.phase = "error".to_string();
            p.errors.push(("database".to_string(), e.to_string()));
            return;
        }
    };

    // Phase 2: Import each file
    for (i, file_path) in files.iter().enumerate() {
        if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
            let mut p = progress.lock().unwrap();
            p.phase = "complete".to_string();
            return;
        }

        let file_str = file_path.to_string_lossy().to_string();

        {
            let mut p = progress.lock().unwrap();
            p.current = i + 1;
            p.current_file = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
        }

        // Check for duplicates by path
        if detect_duplicates {
            if let Ok(Some(_)) = db.get_sample_by_path(&file_str) {
                let mut p = progress.lock().unwrap();
                p.duplicates_skipped += 1;
                continue;
            }
        }

        // Get audio info
        let (duration, sample_rate, channels) = match get_audio_info(&file_str) {
            Ok(info) => (
                Some(info.duration_sec),
                Some(info.sample_rate as i32),
                Some(info.channels as i32),
            ),
            Err(_) => (None, None, None),
        };

        // Auto-detect pack
        let pack_id = match detect_pack_name(file_path, import_path) {
            Some((pack_path, pack_name)) => {
                db.get_or_create_pack(&pack_path, &pack_name, Some("imported"))
                    .ok()
            }
            None => None,
        };

        // Insert sample
        let sample_id = match db.insert_sample(
            &file_str,
            Some("imported"),
            None, // sample_type set during analysis
            duration,
            sample_rate,
            channels,
            pack_id,
        ) {
            Ok(id) => id,
            Err(e) => {
                let mut p = progress.lock().unwrap();
                p.errors.push((file_str, e.to_string()));
                continue;
            }
        };

        {
            let mut p = progress.lock().unwrap();
            p.imported_count += 1;
        }

        // Optional: run analysis
        if analyze {
            let mut p_guard = progress.lock().unwrap();
            p_guard.phase = "analyzing".to_string();
            drop(p_guard);

            run_analysis(&db, sample_id, &file_str, &progress);
        }
    }

    // Done
    {
        let mut p = progress.lock().unwrap();
        p.phase = "complete".to_string();
    }
}

/// Detect pack name (public for testing).
pub(crate) fn detect_pack_name_testable(file_path: &Path, import_root: &Path) -> Option<(String, String)> {
    detect_pack_name(file_path, import_root)
}

/// Run analysis on a single sample and update the database.
/// Delegates to the shared analysis pipeline dispatcher.
fn run_analysis(
    db: &Database,
    sample_id: i64,
    file_path: &str,
    progress: &Arc<Mutex<ImportProgress>>,
) {
    let result = analyze_sample(db, sample_id, file_path, AnalysisPipeline::Standard);
    if !result.errors.is_empty() {
        let mut p = progress.lock().unwrap();
        for err in result.errors {
            p.errors.push((file_path.to_string(), err));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // ============ detect_pack_name tests ============

    #[test]
    fn test_detect_pack_file_in_root() {
        let import_root = Path::new("/samples/MyPack");
        let file_path = Path::new("/samples/MyPack/kick.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (path, name) = result.unwrap();
        assert_eq!(name, "MyPack");
        assert_eq!(path, "/samples/MyPack");
    }

    #[test]
    fn test_detect_pack_file_in_subdir() {
        let import_root = Path::new("/samples");
        let file_path = Path::new("/samples/TechnoPack/kicks/kick01.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (path, name) = result.unwrap();
        assert_eq!(name, "TechnoPack");
        assert_eq!(path, "/samples/TechnoPack");
    }

    #[test]
    fn test_detect_pack_nested_subdir() {
        let import_root = Path::new("/samples");
        let file_path = Path::new("/samples/Vendor/Pack/Sub/deep.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (_, name) = result.unwrap();
        assert_eq!(name, "Vendor");
    }

    #[test]
    fn test_detect_pack_root_equals_file_parent() {
        let import_root = Path::new("/samples");
        let file_path = Path::new("/samples/kick.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (_, name) = result.unwrap();
        assert_eq!(name, "samples");
    }

    // ============ ImportProgress tests ============

    #[test]
    fn test_import_progress_default() {
        let progress = ImportProgress::default();
        assert_eq!(progress.phase, "scanning");
        assert_eq!(progress.current, 0);
        assert_eq!(progress.total, 0);
        assert_eq!(progress.current_file, "");
        assert!(progress.errors.is_empty());
        assert_eq!(progress.duplicates_skipped, 0);
        assert_eq!(progress.imported_count, 0);
    }

    #[test]
    fn test_import_progress_phase_transitions() {
        let mut progress = ImportProgress::default();
        assert_eq!(progress.phase, "scanning");

        progress.phase = "importing".to_string();
        assert_eq!(progress.phase, "importing");

        progress.phase = "analyzing".to_string();
        assert_eq!(progress.phase, "analyzing");

        progress.phase = "complete".to_string();
        assert_eq!(progress.phase, "complete");
    }

    #[test]
    fn test_import_progress_error_accumulation() {
        let mut progress = ImportProgress::default();
        assert!(progress.errors.is_empty());

        progress.errors.push(("file1.wav".to_string(), "corrupt".to_string()));
        progress.errors.push(("file2.wav".to_string(), "unsupported format".to_string()));

        assert_eq!(progress.errors.len(), 2);
        assert_eq!(progress.errors[0].0, "file1.wav");
        assert_eq!(progress.errors[1].1, "unsupported format");
    }

    #[test]
    fn test_import_progress_serialization() {
        let mut progress = ImportProgress::default();
        progress.phase = "importing".to_string();
        progress.current = 5;
        progress.total = 10;
        progress.current_file = "test.wav".to_string();
        progress.imported_count = 4;
        progress.duplicates_skipped = 1;

        let json = serde_json::to_string(&progress).unwrap();
        let deserialized: ImportProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.phase, "importing");
        assert_eq!(deserialized.current, 5);
        assert_eq!(deserialized.total, 10);
        assert_eq!(deserialized.imported_count, 4);
        assert_eq!(deserialized.duplicates_skipped, 1);
    }

    #[test]
    fn test_import_state_new() {
        let state = ImportState::new();
        let jobs = state.jobs.lock().unwrap();
        assert!(jobs.is_empty());
        let flags = state.cancel_flags.lock().unwrap();
        assert!(flags.is_empty());
    }

    #[test]
    fn test_import_state_default() {
        let state = ImportState::default();
        let jobs = state.jobs.lock().unwrap();
        assert!(jobs.is_empty());
    }

    #[test]
    fn test_import_options_input_deserialization() {
        let json = r#"{"recursive": true, "analyze": false}"#;
        let input: ImportOptionsInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.recursive, Some(true));
        assert_eq!(input.analyze, Some(false));
        assert_eq!(input.detect_duplicates, None);
    }

    #[test]
    fn test_import_options_defaults() {
        // Test the default unwrapping used in import_start
        let input = ImportOptionsInput {
            recursive: None,
            analyze: None,
            detect_duplicates: None,
        };
        let recursive = input.recursive.unwrap_or(true);
        let analyze = input.analyze.unwrap_or(true);
        let detect_dup = input.detect_duplicates.unwrap_or(true);
        assert!(recursive);
        assert!(analyze);
        assert!(detect_dup);
    }

    #[test]
    fn test_detect_pack_name_unicode() {
        let import_root = Path::new("/samples");
        let file_path = Path::new("/samples/Björk Samples/kick.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (_, name) = result.unwrap();
        assert_eq!(name, "Björk Samples");
    }

    #[test]
    fn test_detect_pack_name_spaces() {
        let import_root = Path::new("/my samples");
        let file_path = Path::new("/my samples/Cool Pack/sub/kick.wav");
        let result = detect_pack_name(file_path, import_root);
        assert!(result.is_some());
        let (_, name) = result.unwrap();
        assert_eq!(name, "Cool Pack");
    }
}
