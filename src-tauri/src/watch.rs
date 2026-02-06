//! Watch directory management commands.
//!
//! Manages watched directories that auto-import new audio files.

use sample_analysis_core::audio::get_audio_info;
use sample_library_core::db::Database;
use sample_library_core::watcher::{FolderWatcher, WatchConfig, WatchEvent};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

/// State for watch operations.
pub struct WatchState {
    watcher: Mutex<Option<FolderWatcher>>,
    db: Mutex<Option<Database>>,
    watched_dirs: Mutex<Vec<String>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            db: Mutex::new(None),
            watched_dirs: Mutex::new(Vec::new()),
        }
    }

    /// Get or initialize the database.
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

impl Default for WatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the database path.
fn get_db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let path = home
        .join(".music-hub-data")
        .join("sample-library")
        .join("library.db");

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Auto-detect pack name from a file's parent directory.
fn detect_pack_from_dir(file_path: &Path) -> Option<(String, String)> {
    let parent = file_path.parent()?;
    let name = parent.file_name()?.to_str()?.to_string();
    let path = parent.to_str()?.to_string();
    Some((path, name))
}

/// Add a directory to the watch list.
#[tauri::command]
pub fn watch_add_directory(
    path: String,
    state: State<'_, WatchState>,
) -> Result<Vec<String>, String> {
    let mut dirs = state.watched_dirs.lock().map_err(|e| e.to_string())?;

    if !dirs.contains(&path) {
        // Verify directory exists
        let dir_path = PathBuf::from(&path);
        if !dir_path.is_dir() {
            return Err(format!("Directory does not exist: {}", path));
        }
        dirs.push(path);
    }

    Ok(dirs.clone())
}

/// Remove a directory from the watch list.
#[tauri::command]
pub fn watch_remove_directory(
    path: String,
    state: State<'_, WatchState>,
) -> Result<Vec<String>, String> {
    let mut dirs = state.watched_dirs.lock().map_err(|e| e.to_string())?;
    dirs.retain(|d| d != &path);
    Ok(dirs.clone())
}

/// List all watched directories.
#[tauri::command]
pub fn watch_list_directories(state: State<'_, WatchState>) -> Result<Vec<String>, String> {
    let dirs = state.watched_dirs.lock().map_err(|e| e.to_string())?;
    Ok(dirs.clone())
}

/// Start watching configured directories.
///
/// Creates a FolderWatcher and spawns a background thread that listens for
/// file creation events and auto-imports new audio files into the database.
#[tauri::command]
pub fn watch_start(state: State<'_, WatchState>) -> Result<String, String> {
    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    if watcher_guard.is_some() {
        return Err("Watcher is already running".to_string());
    }

    let dirs = state.watched_dirs.lock().map_err(|e| e.to_string())?;

    if dirs.is_empty() {
        return Err("No directories to watch. Add directories first.".to_string());
    }

    let directories: Vec<PathBuf> = dirs.iter().map(PathBuf::from).collect();
    let dir_count = directories.len();

    let config = WatchConfig {
        directories,
        recursive: true,
        debounce_duration: Duration::from_millis(500),
        exclude_patterns: vec![
            ".*".to_string(),
            "_*".to_string(),
            "*.tmp".to_string(),
            "*.bak".to_string(),
        ],
    };

    let mut watcher = FolderWatcher::new(config);
    let event_rx = watcher.start().map_err(|e| e.to_string())?;

    // Get the DB path for the background thread
    let db_path = get_db_path()?;

    // Spawn background thread to process watch events
    std::thread::spawn(move || {
        // Open a separate DB connection for the watcher thread
        let db = match Database::open(&db_path) {
            Ok(db) => db,
            Err(e) => {
                eprintln!("Watch thread: failed to open database: {}", e);
                return;
            }
        };

        loop {
            match event_rx.recv() {
                Ok(event) => match event {
                    WatchEvent::FileCreated(path) => {
                        handle_file_created(&db, &path);
                    }
                    WatchEvent::FileModified(_) => {
                        // Ignore modifications for now
                    }
                    WatchEvent::FileDeleted(_) => {
                        // Ignore deletions for now
                    }
                    WatchEvent::Error(e) => {
                        eprintln!("Watch event error: {}", e);
                    }
                },
                Err(_) => {
                    // Channel closed, watcher was dropped
                    break;
                }
            }
        }
    });

    *watcher_guard = Some(watcher);

    Ok(format!("Watching {} directories", dir_count))
}

/// Stop watching directories.
#[tauri::command]
pub fn watch_stop(state: State<'_, WatchState>) -> Result<String, String> {
    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    match watcher_guard.take() {
        Some(mut watcher) => {
            watcher.stop();
            Ok("Watcher stopped".to_string())
        }
        None => Err("Watcher is not running".to_string()),
    }
}

/// Handle a newly created audio file by importing it into the database.
fn handle_file_created(db: &Database, path: &Path) {
    let file_str = path.to_string_lossy().to_string();

    // Skip if already in database
    if let Ok(Some(_)) = db.get_sample_by_path(&file_str) {
        return;
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

    // Auto-detect pack from parent directory name
    let pack_id = match detect_pack_from_dir(path) {
        Some((pack_path, pack_name)) => db
            .get_or_create_pack(&pack_path, &pack_name, Some("watched"))
            .ok(),
        None => None,
    };

    // Insert sample into database
    match db.insert_sample(
        &file_str,
        Some("watched"),
        None, // sample_type determined later by analysis
        duration,
        sample_rate,
        channels,
        pack_id,
    ) {
        Ok(id) => {
            println!("Watch: imported sample {} from {}", id, file_str);
        }
        Err(e) => {
            eprintln!("Watch: failed to import {}: {}", file_str, e);
        }
    }
}

// Home directory helper (same pattern as search.rs)
mod dirs {
    pub fn home_dir() -> Option<std::path::PathBuf> {
        std::env::var_os("HOME").map(std::path::PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_detect_pack_from_dir() {
        let file_path = Path::new("/music/samples/TechnoPack/kick.wav");
        let result = detect_pack_from_dir(file_path);
        assert!(result.is_some());
        let (path, name) = result.unwrap();
        assert_eq!(name, "TechnoPack");
        assert_eq!(path, "/music/samples/TechnoPack");
    }

    #[test]
    fn test_detect_pack_from_dir_root() {
        let file_path = Path::new("/kick.wav");
        let result = detect_pack_from_dir(file_path);
        // Root "/" has no file_name, so should return None
        assert!(result.is_none());
    }

    #[test]
    fn test_watch_state_default() {
        let state = WatchState::new();
        let dirs = state.watched_dirs.lock().unwrap();
        assert!(dirs.is_empty());
        let watcher = state.watcher.lock().unwrap();
        assert!(watcher.is_none());
    }

    #[test]
    fn test_get_db_path() {
        let result = get_db_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.to_string_lossy().contains(".music-hub-data"));
        assert!(path.to_string_lossy().contains("library.db"));
    }
}
