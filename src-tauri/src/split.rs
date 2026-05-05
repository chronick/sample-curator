//! Multi-select split — turn long recordings into useful samples (vault-3fe9 / T3).
//!
//! Runs in a background thread spawned from the `split_samples` Tauri
//! command so the IPC call never blocks. Each source clip is loaded as
//! mono, run through one of the existing segmentation primitives in
//! `sample-analysis-core` (`segment_by_silence` / `segment_by_changepoint`),
//! and each non-empty chunk is written out as its own WAV alongside the
//! source. Sub-samples inherit:
//!
//! - `parent:<source_id>` — links back to the source for click-through
//!   from the detail panel (filtered from generic autocomplete via T2d)
//! - `session:<UUID>` — copied from the source's tags if present
//!   (correctly absent for un-armed manual recordings)
//! - `recorded` — same as fresh recordings
//!
//! Naming uses the local `heroku_style_stem` helper, not the sidecar.
//! Per-chunk sidecar calls would multiply the typical ~200 ms cost by
//! the chunk count and stall the thread; users can re-run analysis on
//! a chunk later if they want a CLAP-derived name.
//!
//! Progress is emitted as Tauri events (`split:progress`, `split:complete`,
//! `split:error`); callers don't need to poll. The frontend toasts a
//! "split done" indicator on completion.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use sample_analysis_core::audio::load_audio;
use sample_analysis_core::segmentation::{
    changepoint::{segment_by_changepoint, ChangePointConfig},
    silence::{segment_by_silence, SilenceConfig},
};
use sample_library_core::db::Database;

use crate::db_commands::{execute_delete_sample, DbState};
use crate::recorder::naming::heroku_style_stem;
use crate::transforms::ParentInheritance;

/// Modes available to v1 of the split flow.
///
/// `silence` and `changepoint` map directly to the existing primitives
/// in `sample-analysis-core`. The plan also called for `onsets` and a
/// `hybrid` mode that combines silence + onsets — both are filed as
/// follow-ups so v1 ships with the modes that have proven primitives.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitMode {
    Silence,
    Changepoint,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SplitParams {
    pub mode: SplitMode,
    /// Minimum chunk duration in seconds. Maps to
    /// `SilenceConfig.min_chunk_duration` and
    /// `ChangePointConfig.min_segment_duration` respectively.
    pub min_chunk_secs: f64,
    /// When true, the source clip is moved to Trash and its DB row
    /// removed after the chunks are inserted. Recoverable via the OS
    /// Trash since we use the `trash` crate (vault-1csc).
    pub delete_source: bool,
}

/// Returned immediately from `split_samples`; the frontend uses this
/// as the correlation key for `split:*` events.
#[derive(Debug, Clone, Serialize)]
pub struct SplitJobHandle {
    pub job_id: String,
    pub total_samples: usize,
}

#[derive(Debug, Clone, Serialize)]
struct SplitProgressEvent {
    job_id: String,
    sample_index: usize,
    total_samples: usize,
    /// Current sample's path so the UI can show "Splitting <name>".
    source_path: String,
    /// Cumulative number of sub-samples produced across the whole job.
    chunks_so_far: usize,
}

#[derive(Debug, Clone, Serialize)]
struct SplitCompleteEvent {
    job_id: String,
    total_samples: usize,
    chunks_created: usize,
    sources_deleted: usize,
}

#[derive(Debug, Clone, Serialize)]
struct SplitErrorEvent {
    job_id: String,
    sample_id: i64,
    /// Path of the source we failed on, for the toast text.
    source_path: String,
    message: String,
}

#[tauri::command]
pub fn split_samples(
    sample_ids: Vec<i64>,
    params: SplitParams,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<SplitJobHandle, String> {
    if sample_ids.is_empty() {
        return Err("No samples selected".to_string());
    }
    if params.min_chunk_secs <= 0.0 {
        return Err("min_chunk_secs must be positive".to_string());
    }
    // Confirm the DB is initialized before we spawn the worker so the
    // user gets a clean error rather than a delayed event.
    {
        let guard = state.get_db()?;
        guard.as_ref().ok_or("Database not initialized")?;
    }

    let job_id = Uuid::new_v4().to_string();
    let handle = SplitJobHandle {
        job_id: job_id.clone(),
        total_samples: sample_ids.len(),
    };

    // Open a fresh DB connection on the worker thread so the IPC pool
    // stays free. Mirrors the analysis-spawn pattern in
    // `recorder_save_to_library`.
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let db_path = dirs::home_dir()
            .unwrap_or_default()
            .join(".music-hub-data")
            .join("sample-library")
            .join("library.db");
        let db = match Database::open(&db_path) {
            Ok(d) => d,
            Err(e) => {
                let _ = app_clone.emit(
                    "split:error",
                    &SplitErrorEvent {
                        job_id: job_id.clone(),
                        sample_id: 0,
                        source_path: String::new(),
                        message: format!("Failed to open DB: {}", e),
                    },
                );
                return;
            }
        };
        run_split_job(&app_clone, &job_id, sample_ids, params, &db);
    });

    Ok(handle)
}

fn run_split_job(
    app: &AppHandle,
    job_id: &str,
    sample_ids: Vec<i64>,
    params: SplitParams,
    db: &Database,
) {
    let total = sample_ids.len();
    let mut chunks_total = 0usize;
    let mut sources_deleted = 0usize;

    for (idx, sample_id) in sample_ids.iter().enumerate() {
        let sample = match db.get_sample(*sample_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                let _ = app.emit(
                    "split:error",
                    &SplitErrorEvent {
                        job_id: job_id.to_string(),
                        sample_id: *sample_id,
                        source_path: String::new(),
                        message: "Sample not found in DB".to_string(),
                    },
                );
                continue;
            }
            Err(e) => {
                let _ = app.emit(
                    "split:error",
                    &SplitErrorEvent {
                        job_id: job_id.to_string(),
                        sample_id: *sample_id,
                        source_path: String::new(),
                        message: format!("DB read failed: {}", e),
                    },
                );
                continue;
            }
        };

        let _ = app.emit(
            "split:progress",
            &SplitProgressEvent {
                job_id: job_id.to_string(),
                sample_index: idx,
                total_samples: total,
                source_path: sample.path.clone(),
                chunks_so_far: chunks_total,
            },
        );

        match split_one_sample(db, &sample, &params) {
            Ok(chunks_made) => {
                chunks_total += chunks_made;
                if params.delete_source && chunks_made > 0 {
                    if let Err(e) = trash_source(db, &sample.path, sample.id) {
                        eprintln!("[split] failed to trash source {}: {}", sample.path, e);
                    } else {
                        sources_deleted += 1;
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "split:error",
                    &SplitErrorEvent {
                        job_id: job_id.to_string(),
                        sample_id: sample.id,
                        source_path: sample.path.clone(),
                        message: e,
                    },
                );
            }
        }
    }

    let _ = app.emit(
        "split:complete",
        &SplitCompleteEvent {
            job_id: job_id.to_string(),
            total_samples: total,
            chunks_created: chunks_total,
            sources_deleted,
        },
    );
}

/// Process one source clip end-to-end. Returns the number of chunks
/// that were inserted into the DB (0 means segmentation produced
/// nothing usable — the source clip is left alone in that case even
/// when `delete_source` is true, so the user doesn't lose audio).
fn split_one_sample(
    db: &Database,
    source: &sample_library_core::db::Sample,
    params: &SplitParams,
) -> Result<usize, String> {
    // Mono mixdown for segmentation. Chunk WAVs are written from this
    // mono buffer for v1 — keeps the writer simple and is consistent
    // with what the segmentation primitives operate on. Original
    // multi-channel content is preserved on the source clip; the
    // user can opt out of `delete_source` if they need to keep stereo
    // and re-render chunks manually.
    let (mono_samples, sample_rate) = load_audio(&source.path, None, true)
        .map_err(|e| format!("Failed to load WAV: {}", e))?;
    if mono_samples.is_empty() {
        return Ok(0);
    }

    let chunks = match params.mode {
        SplitMode::Silence => {
            let cfg = SilenceConfig {
                min_chunk_duration: params.min_chunk_secs,
                ..Default::default()
            };
            segment_by_silence(&mono_samples, sample_rate, &cfg)
                .map_err(|e| format!("silence segmentation failed: {}", e))?
        }
        SplitMode::Changepoint => {
            let cfg = ChangePointConfig {
                min_segment_duration: params.min_chunk_secs,
                ..Default::default()
            };
            segment_by_changepoint(&mono_samples, sample_rate, &cfg)
                .map_err(|e| format!("changepoint segmentation failed: {}", e))?
        }
    };

    if chunks.is_empty() {
        return Ok(0);
    }

    // Snapshot inheritance-relevant tags from the parent before the
    // per-chunk loop. Manual recordings that predate T2b won't carry a
    // session:* — `apply` is a no-op for that piece, which is correct.
    let inheritance = ParentInheritance::snapshot(db, source.id)?;

    let parent_path = PathBuf::from(&source.path);
    let parent_dir = parent_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let parent_stem = parent_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("split");

    let mut written = 0usize;
    for (idx, chunk) in chunks.iter().enumerate() {
        // Deterministic, sortable, sidecar-free chunk name.
        let stem_seed = format!("{}-chunk-{}", parent_stem, idx);
        let chunk_stem = format!(
            "{}_{:03}",
            heroku_style_stem(&stem_seed),
            idx + 1
        );
        let chunk_path = parent_dir.join(format!("{}.wav", chunk_stem));

        if let Err(e) = write_chunk_wav(
            &chunk_path,
            &mono_samples[chunk.start_sample.min(mono_samples.len())
                ..chunk.end_sample.min(mono_samples.len())],
            sample_rate,
        ) {
            eprintln!("[split] failed to write chunk {}: {}", chunk_path.display(), e);
            continue;
        }

        let chunk_path_str = chunk_path.to_string_lossy().to_string();
        let chunk_duration = chunk.duration;
        let new_id = match db.insert_sample(
            &chunk_path_str,
            Some("recorded"),
            None,
            Some(chunk_duration),
            Some(sample_rate as i32),
            Some(1), // mono — see comment in load_audio call
            source.pack_id,
        ) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("[split] failed to insert chunk row {}: {}", chunk_path_str, e);
                let _ = std::fs::remove_file(&chunk_path);
                continue;
            }
        };

        // parent:<id> + inherited session:* + transform-specific tags.
        // `recorded` here flags the chunk as the same kind of content
        // as the source (the canonical split target is a recording).
        // Splitting an imported sample would still tag chunks with
        // `recorded`, which is wrong for that case but consistent with
        // the v1 spec; revisit once we have non-recording sources.
        inheritance.apply(db, new_id, &["recorded"]);

        written += 1;
    }

    Ok(written)
}

fn write_chunk_wav(path: &PathBuf, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("create writer: {}", e))?;
    for &s in samples {
        writer
            .write_sample(s)
            .map_err(|e| format!("write sample: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("finalize: {}", e))?;
    Ok(())
}

/// Move the source WAV to the OS Trash and remove its DB row. Reuses
/// the same delete path as `db_delete_sample` so the row goes through
/// the same SQL (with FK cascades for tags/embeddings/etc).
fn trash_source(db: &Database, path: &str, id: i64) -> Result<(), String> {
    trash::delete(path).map_err(|e| format!("trash: {}", e))?;
    execute_delete_sample(db, id).map(|_| ())
}
