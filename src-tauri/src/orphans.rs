//! Tauri command wrappers for orphaned-recording scanning and recovery.
//!
//! Core logic lives in `sample_library_core::orphans`; this module only wires
//! up the Tauri State and `trash` crate call.

use crate::db_commands::DbState;
use hound;
use sample_library_core::orphans::{scan_orphans, OrphanedRecording};
use std::path::{Path, PathBuf};
use tauri::State;

fn recordings_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".music-hub-data")
        .join("recordings")
}

/// Tauri command: scan the recordings directory and return orphaned WAVs.
#[tauri::command]
pub fn scan_orphaned_recordings(state: State<'_, DbState>) -> Result<Vec<OrphanedRecording>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    let dir = recordings_dir();
    scan_orphans(db, &dir).map_err(|e| e.to_string())
}

/// Tauri command: move a file to the system Trash (recoverable).
#[tauri::command]
pub fn delete_orphaned_recording(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// Tauri command: import an orphaned WAV directly into the library.
///
/// Reads WAV metadata, inserts into `samples` under the "Recordings" pack,
/// and tags it "recorded". Mirrors the fast path in `recorder_save_to_library`.
#[tauri::command]
pub fn import_orphaned_recording(path: String, state: State<'_, DbState>) -> Result<i64, String> {
    let wav_path = Path::new(&path);
    let reader =
        hound::WavReader::open(wav_path).map_err(|e| format!("Failed to read WAV: {}", e))?;
    let spec = reader.spec();
    let duration = reader.duration() as f64 / spec.sample_rate as f64;

    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let recordings_dir_str = recordings_dir().to_string_lossy().to_string();
    let pack_id = db
        .get_or_create_pack(&recordings_dir_str, "Recordings", Some("recorded"))
        .ok();

    let sample_id = db
        .insert_sample(
            &path,
            Some("recorded"),
            None,
            Some(duration),
            Some(spec.sample_rate as i32),
            Some(spec.channels as i32),
            pack_id,
        )
        .map_err(|e| e.to_string())?;

    let _ = db.add_tag_to_sample(sample_id, "recorded");

    Ok(sample_id)
}
