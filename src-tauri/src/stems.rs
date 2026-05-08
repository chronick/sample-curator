//! Stem separation (vault-2nnt).
//!
//! The frontend calls [`separate_stems`] with a list of source sample
//! IDs. We spawn a background thread that, for each source, asks the
//! sidecar's `separate_stems` handler to run demucs in the runtime
//! worker. On success we insert the resulting per-stem WAVs as new
//! samples and apply tags:
//!
//! - `parent:<source_id>` on each stem (links back to the source clip)
//! - `stem:<role>` on each stem (drums | bass | other | vocals)
//! - `stems-done` on the source clip after all roles complete
//!
//! Idempotency: a source already tagged `stems-done` is skipped. Below
//! a configurable duration threshold (default 5s), the source is
//! skipped — short clips don't carry useful stems.
//!
//! Progress is emitted via the `stems_progress` Tauri event so the
//! frontend can render a per-clip status without polling.

use crate::db_commands::DbState;
use crate::ml_commands::rpc;
use crate::AppState;
use sample_library_core::db::Database;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// Below this duration, separation is a no-op. Matches the task spec.
const MIN_DURATION_SECS: f64 = 5.0;

/// Tag applied to source clips after all stems complete. Re-running a
/// source with this tag is a no-op (idempotent).
const STEMS_DONE_TAG: &str = "stems-done";

/// Roles produced by `facebook/htdemucs`. Other models would have
/// different sources; for v1 we hardcode the 4-stem variant.
const _EXPECTED_ROLES: &[&str] = &["drums", "bass", "other", "vocals"];

/// Per-source progress event sent over `stems_progress`.
#[derive(Debug, Clone, Serialize)]
struct ProgressEvent {
    sample_id: i64,
    status: &'static str,
    error: Option<String>,
    /// Populated on `completed`: each stem's role and inserted sample id.
    stems: Option<Vec<StemOutcome>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StemOutcome {
    role: String,
    path: String,
    sample_id: i64,
}

/// Multi-select entrypoint: process N source samples in a worker thread.
/// Returns immediately; consumers subscribe to `stems_progress`.
#[tauri::command]
pub fn separate_stems(
    sample_ids: Vec<i64>,
    app: AppHandle,
) -> Result<(), String> {
    if sample_ids.is_empty() {
        return Err("separate_stems called with empty sample_ids".to_string());
    }
    thread::spawn(move || {
        run_worker(sample_ids, app);
    });
    Ok(())
}

fn emit(app: &AppHandle, ev: ProgressEvent) {
    let _ = app.emit("stems_progress", ev);
}

/// Worker thread body. Holds its own DB + AppState handles instead of
/// the Tauri command's `State<'_, _>` (which can't cross threads).
fn run_worker(sample_ids: Vec<i64>, app: AppHandle) {
    let app_state: State<'_, AppState> = app.state();
    let db_state: State<'_, DbState> = app.state();

    for sample_id in sample_ids {
        emit(
            &app,
            ProgressEvent {
                sample_id,
                status: "started",
                error: None,
                stems: None,
            },
        );

        match process_one(sample_id, &app_state, &db_state) {
            Ok(Some(stems)) => emit(
                &app,
                ProgressEvent {
                    sample_id,
                    status: "completed",
                    error: None,
                    stems: Some(stems),
                },
            ),
            Ok(None) => emit(
                &app,
                ProgressEvent {
                    sample_id,
                    status: "skipped",
                    error: None,
                    stems: None,
                },
            ),
            Err(e) => emit(
                &app,
                ProgressEvent {
                    sample_id,
                    status: "failed",
                    error: Some(e),
                    stems: None,
                },
            ),
        }
    }

    let _ = app.emit("stems_progress_complete", ());
}

/// Returns Ok(Some(stems)) on success, Ok(None) when the clip was
/// skipped (already done / too short), Err on hard failure.
fn process_one(
    sample_id: i64,
    app_state: &State<'_, AppState>,
    db_state: &State<'_, DbState>,
) -> Result<Option<Vec<StemOutcome>>, String> {
    // Look up the source clip, check skip conditions.
    let (audio_path, source_pack_id) = {
        let guard = db_state.get_db()?;
        let db = guard.as_ref().ok_or("Database not initialized")?;

        let sample = db
            .get_sample(sample_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("sample {} not found", sample_id))?;

        if let Some(d) = sample.duration {
            if d < MIN_DURATION_SECS {
                return Ok(None);
            }
        }

        let tags = db
            .get_sample_tags(sample_id)
            .map_err(|e| e.to_string())?;
        if tags.iter().any(|t| t.name == STEMS_DONE_TAG) {
            return Ok(None);
        }

        (sample.path, sample.pack_id)
    };

    // Ask sidecar to do the heavy lifting. The sidecar delegates to the
    // runtime worker, which loads htdemucs and writes per-stem WAVs.
    let params = serde_json::json!({
        "audio_path": audio_path,
    });
    let result = rpc(app_state, "separate_stems", params)?;

    // Worker contract: {"stems": {role: path}} on success, or
    // {"stems": null, "error": "..."} on soft failure.
    if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    let stems_obj = result
        .get("stems")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "sidecar returned no stems".to_string())?;

    // Insert each stem as a new sample, tag with parent + role.
    let mut outcomes: Vec<StemOutcome> = Vec::with_capacity(stems_obj.len());
    {
        let guard = db_state.get_db()?;
        let db = guard.as_ref().ok_or("Database not initialized")?;

        for (role, path_val) in stems_obj.iter() {
            let stem_path = path_val
                .as_str()
                .ok_or_else(|| format!("stem '{}' has non-string path", role))?;
            let outcome = insert_stem_sample(db, stem_path, role, sample_id, source_pack_id)?;
            outcomes.push(outcome);
        }

        // Mark source done last so a partial failure doesn't poison
        // the idempotency check.
        db.add_tag_to_sample(sample_id, STEMS_DONE_TAG)
            .map_err(|e| e.to_string())?;
    }

    Ok(Some(outcomes))
}

fn insert_stem_sample(
    db: &Database,
    stem_path: &str,
    role: &str,
    source_sample_id: i64,
    source_pack_id: Option<i64>,
) -> Result<StemOutcome, String> {
    // Best-effort metadata read — match the recorder save path's pattern.
    let (duration, sample_rate, channels) = read_wav_metadata(Path::new(stem_path));

    let sample_id = db
        .insert_sample(
            stem_path,
            Some("stem"),
            None,
            duration,
            sample_rate,
            channels,
            source_pack_id,
        )
        .map_err(|e| format!("insert_sample({}): {}", stem_path, e))?;

    db.add_tag_to_sample(sample_id, &format!("parent:{}", source_sample_id))
        .map_err(|e| e.to_string())?;
    db.add_tag_to_sample(sample_id, &format!("stem:{}", role))
        .map_err(|e| e.to_string())?;

    Ok(StemOutcome {
        role: role.to_string(),
        path: stem_path.to_string(),
        sample_id,
    })
}

fn read_wav_metadata(path: &Path) -> (Option<f64>, Option<i32>, Option<i32>) {
    match hound::WavReader::open(path) {
        Ok(reader) => {
            let spec = reader.spec();
            let duration = reader.duration() as f64 / spec.sample_rate as f64;
            (
                Some(duration),
                Some(spec.sample_rate as i32),
                Some(spec.channels as i32),
            )
        }
        Err(_) => (None, None, None),
    }
}

