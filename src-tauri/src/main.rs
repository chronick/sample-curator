#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[cfg(feature = "automation")]
mod automation;
mod analysis;
mod analysis_pipeline;
mod audio;
mod categorization;
mod db_commands;
mod duplicates;
mod foundation_models;
mod import_commands;
mod jobs;
mod ml_commands;
mod orphans;
mod projects;
mod recorder;
mod search;
mod sidecar;
mod split;
mod transforms;
mod watch;

use audio::AudioState;
use categorization::CategorizationState;
use db_commands::DbState;
use duplicates::DuplicateState;
use import_commands::ImportState;
use jobs::JobState;
use ml_commands::MlConfigState;
use projects::ProjectState;
use search::SearchState;
use recorder::{RecorderState, RecorderConfigState};
use sidecar::SidecarManager;
use watch::WatchState;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    sidecar: Mutex<Option<SidecarManager>>,
    audio: AudioState,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SidecarInfo {
    package_version: String,
    python_version: String,
    python_implementation: String,
    platform: String,
    executable: String,
    is_frozen: bool,
}

#[derive(serde::Serialize)]
struct AppVersions {
    app: &'static str,
    tauri: &'static str,
    os: String,
    /// `None` when the sidecar hasn't been started yet (lazy on first
    /// ML call). Settings → About surfaces that as "Not started."
    sidecar: Option<SidecarInfo>,
}

/// Return consolidated version info for the About panel.
///
/// Does NOT start the sidecar — only queries it if it's already
/// running. Avoids the cost of spawning + warming up just to show a
/// dialog.
#[tauri::command]
fn get_app_versions(state: State<'_, AppState>) -> AppVersions {
    let sidecar = (|| -> Option<SidecarInfo> {
        let mut guard = state.sidecar.lock().ok()?;
        let manager = guard.as_mut()?;
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "get_sidecar_info",
            "id": 1,
        })
        .to_string();
        let resp_str = manager.call_sync(&req).ok()?;
        let resp: serde_json::Value = serde_json::from_str(&resp_str).ok()?;
        let result = resp.get("result")?.clone();
        serde_json::from_value(result).ok()
    })();

    AppVersions {
        app: env!("CARGO_PKG_VERSION"),
        tauri: tauri::VERSION,
        os: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        sidecar,
    }
}

#[tauri::command]
fn sidecar_call(
    request: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut sidecar_guard = state.sidecar.lock().map_err(|e| e.to_string())?;

    // Initialize sidecar if not already running (graceful — app works without it)
    if sidecar_guard.is_none() {
        match SidecarManager::new() {
            Ok(manager) => {
                *sidecar_guard = Some(manager);
            }
            Err(e) => {
                eprintln!("Warning: Python sidecar failed to start: {}. ML features unavailable.", e);
                return Err(format!("Python sidecar not available: {}. DB operations use native commands (db_*) instead.", e));
            }
        }
    }

    let sidecar = sidecar_guard.as_mut().unwrap();

    // Use blocking call since we're in a sync function
    sidecar.call_sync(&request).map_err(|e| e.to_string())
}

// Audio playback commands
#[tauri::command]
fn audio_play(path: String, state: State<'_, AppState>) -> Result<f64, String> {
    state.audio.play(&path)
}

#[tauri::command]
fn audio_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.pause()
}

#[tauri::command]
fn audio_resume(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.resume()
}

#[tauri::command]
fn audio_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.stop()
}

#[tauri::command]
fn audio_set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    state.audio.set_volume(volume)
}

#[tauri::command]
fn audio_get_status(state: State<'_, AppState>) -> Result<(bool, bool, f64, f64), String> {
    let status = state.audio.get_status()?;
    Ok((status.is_playing, status.is_paused, status.duration, status.position))
}

// ============ Recorder Command Wrappers ============

#[tauri::command]
fn recorder_list_audio_devices() -> Result<Vec<recorder::audio_capture::AudioDevice>, String> {
    recorder::audio_capture::list_input_devices()
}

#[tauri::command]
fn recorder_select_device(
    device_id: String,
    state: State<'_, RecorderState>,
    config_state: State<'_, RecorderConfigState>,
) -> Result<(), String> {
    // Pass the user's preferred sample rate from config. If the device
    // supports it, the input stream opens at that rate — matching the system
    // output device's rate avoids glitchy resampling during playback.
    let preferred = config_state.get().ok().map(|c| c.sample_rate);
    recorder::audio_capture::select_device(&device_id, &state, preferred)
}

#[tauri::command]
fn recorder_start_recording(
    config: recorder::audio_capture::RecordingConfig,
    state: State<'_, RecorderState>,
) -> Result<(), String> {
    recorder::audio_capture::start_recording(config, &state)
}

#[tauri::command]
fn recorder_stop_recording(
    state: State<'_, RecorderState>,
) -> Result<recorder::audio_capture::RecordingInfo, String> {
    recorder::audio_capture::stop_recording(&state)
}

#[tauri::command]
fn recorder_get_recording_status(state: State<'_, RecorderState>) -> Result<recorder::audio_capture::RecordingStatus, String> {
    let is_recording = state.is_recording.load(std::sync::atomic::Ordering::Relaxed);
    let is_monitoring = state.is_monitoring.load(std::sync::atomic::Ordering::Relaxed);

    let elapsed_secs = if is_recording {
        state
            .recording_start
            .lock()
            .map_err(|e| e.to_string())?
            .map(|s| s.elapsed().as_secs_f64())
            .unwrap_or(0.0)
    } else {
        0.0
    };

    let current_file = state
        .current_file
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    Ok(recorder::audio_capture::RecordingStatus {
        is_recording,
        is_monitoring,
        elapsed_secs,
        current_file,
    })
}

#[tauri::command]
fn recorder_get_audio_levels(state: State<'_, RecorderState>) -> Result<recorder::metering::LevelData, String> {
    let levels = state.smoothed_levels.lock().map_err(|e| e.to_string())?;
    Ok(levels.clone())
}

#[tauri::command]
fn recorder_get_waveform_data(
    num_samples: Option<usize>,
    state: State<'_, RecorderState>,
) -> Result<Vec<f32>, String> {
    Ok(recorder::audio_capture::get_waveform_snapshot(&state, num_samples.unwrap_or(1024)))
}

#[tauri::command]
fn recorder_get_spectrum_data(
    num_bins: Option<usize>,
    state: State<'_, RecorderState>,
) -> Result<Vec<f32>, String> {
    Ok(recorder::audio_capture::get_spectrum_snapshot(&state, num_bins.unwrap_or(128)))
}

#[tauri::command]
fn recorder_get_recording_waveform(
    num_bars: Option<usize>,
    state: State<'_, RecorderState>,
) -> Result<recorder::visualization::RecordingWaveformData, String> {
    Ok(recorder::audio_capture::get_recording_waveform(&state, num_bars.unwrap_or(800)))
}

#[tauri::command]
fn recorder_get_recordings_dir() -> Result<String, String> {
    let dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".music-hub-data")
        .join("recordings");
    Ok(dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct AppDataPaths {
    library_data_dir: String,
    recordings_dir: String,
    config_path: String,
    models_dir: String,
}

#[tauri::command]
fn get_app_data_paths() -> AppDataPaths {
    let home = dirs::home_dir().unwrap_or_default();
    let base = home.join(".music-hub-data");
    AppDataPaths {
        library_data_dir: base.to_string_lossy().to_string(),
        recordings_dir: base.join("recordings").to_string_lossy().to_string(),
        config_path: base.join("config.toml").to_string_lossy().to_string(),
        models_dir: base.join("models").to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if path.ends_with('/') || p.extension().is_none() {
            std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        }
    }
    let target = if p.is_file() { p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone()) } else { p.clone() };
    std::process::Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Failed to reveal path: {}", e))?;
    Ok(())
}

#[tauri::command]
fn recorder_open_recordings_dir(config_state: State<'_, RecorderConfigState>) -> Result<(), String> {
    let config = config_state.get()?;
    let dir = if config.output_dir.is_empty() {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".music-hub-data")
            .join("recordings")
            .to_string_lossy()
            .to_string()
    } else {
        config.output_dir
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open directory: {}", e))?;
    Ok(())
}

#[tauri::command]
fn recorder_get_config(state: State<'_, RecorderConfigState>) -> Result<recorder::config::RecorderConfig, String> {
    state.get()
}

#[tauri::command]
fn recorder_set_config(config: recorder::config::RecorderConfig, state: State<'_, RecorderConfigState>) -> Result<(), String> {
    state.set(config)
}

// Arm-cycle session lifecycle. The frontend's arm toggle drives backend
// session state via `recorder_set_armed`; downstream session_* commands
// read/mutate that ephemeral context.

#[tauri::command]
fn recorder_set_armed(
    armed: bool,
    state: State<'_, RecorderState>,
) -> Result<Option<recorder::audio_capture::CurrentSessionContext>, String> {
    if armed {
        let session = state.arm_session()?;
        Ok(Some(session))
    } else {
        state.disarm_session()?;
        Ok(None)
    }
}

#[tauri::command]
fn session_current(
    state: State<'_, RecorderState>,
) -> Result<Option<recorder::audio_capture::CurrentSessionContext>, String> {
    state.session_snapshot()
}

#[tauri::command]
fn session_set_stem_separation(
    enabled: bool,
    state: State<'_, RecorderState>,
) -> Result<(), String> {
    state.set_stem_separation(enabled)
}

#[derive(serde::Serialize)]
struct RecorderSaveResult {
    sample_id: i64,
    /// The ORIGINAL path the frontend sent — used to match the entry in the
    /// Recent list so it can be swapped for `renamed_path`.
    original_path: String,
    /// Canonical path after auto-naming (WAV was physically renamed on disk).
    /// Equal to `original_path` if naming/rename failed.
    path: String,
    analyzed: bool,
    pack_name: Option<String>,
    /// ML-derived tags (CLAP categories or heuristic tag). May be empty.
    naming_tags: Vec<String>,
    /// How the name was produced: `"clap"`, `"transcription"`, `"llm"`,
    /// `"heuristic"`, `"heroku"` (Python heroku fallback), or
    /// `"heroku-fallback"` (Rust-side fallback when the sidecar itself was
    /// unreachable).
    naming_method: String,
    /// Alternative stem when A/B test mode is on and both naming paths
    /// produced usable names (e.g. mechanical transcript vs LLM refinement).
    /// None when A/B is off, when the paths agreed, or when only one path ran.
    #[serde(skip_serializing_if = "Option::is_none")]
    naming_alternative: Option<String>,
    /// Method that produced the alternative — always the "other" method vs
    /// `naming_method`. None when `naming_alternative` is None.
    #[serde(skip_serializing_if = "Option::is_none")]
    naming_alternative_method: Option<String>,
}

/// Save a finalized recording to the library, applying any session_tag
/// the frontend captured at stop_recording time.
///
/// `session_tag` is a snapshot of `RecorderState.current_session.session_tag`
/// taken at stop time and threaded back through the frontend. Reading the
/// live `current_session` here would be unsafe — the user may have disarmed
/// during the async writer-finalize → save_to_library window. `None` for
/// manual (un-armed) recordings.
#[tauri::command]
fn recorder_save_to_library(
    path: String,
    tags: Vec<String>,
    session_tag: Option<String>,
    state: State<'_, DbState>,
    recorder_state: State<'_, RecorderState>,
    app_state: State<'_, AppState>,
    config_state: State<'_, RecorderConfigState>,
) -> Result<RecorderSaveResult, String> {
    // Wait for writer thread to finish flushing the WAV before reading it
    recorder::audio_capture::wait_for_writer(&recorder_state, 30_000)?;

    // Remember the input path so the frontend can swap the Recent list entry.
    let original_path = path.clone();

    // Auto-name the recording *before* we insert it into the library so the
    // DB path matches what's on disk. Runs the Python sidecar's
    // `name_recording` handler (CLAP / transcription / LLM / heuristic / heroku),
    // and falls back to a Rust-side heroku generator if the sidecar is unreachable.
    //
    // When the user has A/B test mode on, the sidecar runs both the mechanical
    // transcript path and the LLM-refinement path for vocal clips and returns
    // both so the UI can surface them for side-by-side comparison.
    let ab_test = config_state
        .get()
        .map(|c| c.llm_ab_test)
        .unwrap_or(false);
    let named = auto_name_recording(&path, &app_state, ab_test);
    let final_path = named.new_path.clone();
    let extra_tags = named.tags.clone();
    let naming_method = named.method.clone();
    let naming_alternative = named.alternative.clone();
    let naming_alternative_method = named.alternative_method.clone();

    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get audio file info for duration/channels
    let reader = hound::WavReader::open(&final_path)
        .map_err(|e| format!("Failed to read WAV: {}", e))?;
    let spec = reader.spec();
    let duration = reader.duration() as f64 / spec.sample_rate as f64;

    // Get or create a "Recordings" pack
    let recordings_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".music-hub-data")
        .join("recordings");
    let recordings_dir_str = recordings_dir.to_string_lossy().to_string();
    let pack_id = db
        .get_or_create_pack(&recordings_dir_str, "Recordings", Some("recorded"))
        .ok();

    // Insert sample into library (with pack)
    let sample_id = db
        .insert_sample(
            &final_path,
            Some("recorded"),
            None,
            Some(duration),
            Some(spec.sample_rate as i32),
            Some(spec.channels as i32),
            pack_id,
        )
        .map_err(|e| e.to_string())?;

    // Add caller-supplied tags + ML-derived tags (from CLAP/heuristic).
    for tag in tags.iter().chain(extra_tags.iter()) {
        db.add_tag_to_sample(sample_id, tag)
            .map_err(|e| e.to_string())?;
    }

    // Always add "recorded" tag
    let _ = db.add_tag_to_sample(sample_id, "recorded");

    // Apply the snapshotted session_tag, if this clip was captured during
    // an armed cycle. Lazy tag-row creation lives in `add_tag_to_sample`
    // (no parallel helper). 0-clip arm cycles never reach this code, so
    // the `tags` table stays clean of stray `session:*` rows.
    if let Some(ref tag) = session_tag {
        db.add_tag_to_sample(sample_id, tag)
            .map_err(|e| e.to_string())?;
    }

    let pack_name = pack_id.and_then(|pid| {
        db.get_pack(pid).ok().flatten().map(|p| p.name)
    });

    // Release DB lock before spawning background analysis
    drop(db_guard);

    // Spawn analysis on a completely separate thread (off the Tauri thread pool).
    // Opens its own DB connection so the IPC pool stays free for UI commands.
    let analysis_path = final_path.clone();
    let mut analysis_tags = tags;
    analysis_tags.extend(extra_tags.iter().cloned());
    std::thread::spawn(move || {
        let db_path = dirs::home_dir()
            .unwrap_or_default()
            .join(".music-hub-data")
            .join("sample-library")
            .join("library.db");
        let db = match sample_library_core::db::Database::open(&db_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Background analysis: failed to open DB: {}", e);
                return;
            }
        };
        let tag_refs: Vec<&str> = analysis_tags.iter().map(|s| s.as_str()).collect();
        let pipeline = analysis_pipeline::pipeline_for_tags(&tag_refs);
        let result = analysis_pipeline::analyze_sample(&db, sample_id, &analysis_path, pipeline);
        if !result.errors.is_empty() {
            eprintln!("Background analysis errors: {:?}", result.errors);
        }
    });

    Ok(RecorderSaveResult {
        sample_id,
        original_path,
        path: final_path,
        analyzed: false, // analysis runs async in background
        pack_name,
        naming_tags: extra_tags,
        naming_method,
        naming_alternative,
        naming_alternative_method,
    })
}

/// Try to run the sidecar's ``name_recording`` handler and rename the WAV
/// in place. On any failure (sidecar missing, spawn error, bad response)
/// falls back to the Rust-side heroku-style generator. Always returns a
/// usable path — either the renamed one or the original unchanged.
///
/// When `ab_test` is true, asks the sidecar to run both the mechanical-
/// transcript and LLM-refinement naming paths and return whichever was NOT
/// picked as primary in `alternative`/`alternative_method`. Used by the UI
/// to surface both names side-by-side for A/B comparison.
fn auto_name_recording(
    path: &str,
    app_state: &AppState,
    ab_test: bool,
) -> recorder::naming::AutoNameResult {
    use recorder::naming;

    // Build + send the sidecar request. If any step fails, bail to fallback.
    let request = naming::build_sidecar_request(1, path, None, None, ab_test);
    let sidecar_response = {
        let mut guard = match app_state.sidecar.lock() {
            Ok(g) => g,
            Err(_) => return naming::fallback_rename(path),
        };
        if guard.is_none() {
            match SidecarManager::new() {
                Ok(m) => *guard = Some(m),
                Err(e) => {
                    eprintln!("Auto-name: sidecar spawn failed ({}); using fallback", e);
                    return naming::fallback_rename(path);
                }
            }
        }
        guard.as_mut().unwrap().call_sync(&request)
    };
    let response = match sidecar_response {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Auto-name: sidecar call failed ({}); using fallback", e);
            return naming::fallback_rename(path);
        }
    };

    let fields = match naming::parse_sidecar_response(&response) {
        Some(v) => v,
        None => {
            eprintln!(
                "Auto-name: sidecar response unparseable ({}); using fallback",
                response.chars().take(200).collect::<String>()
            );
            return naming::fallback_rename(path);
        }
    };

    // Apple Foundation Models post-hoc refinement (vault-3ume slice 3).
    // When the user has the LLM feature on with the foundation backend,
    // the sidecar transcribed but didn't refine — it left the transcript
    // in `transcript_for_external_refine`. Run it through the Swift
    // bridge here and override the stem if FM produced something usable.
    let (final_stem, final_method, final_alt, final_alt_method) =
        if let Some(transcript) = fields.transcript_for_external_refine.as_deref() {
            let prompt = format_fm_prompt(transcript);
            match foundation_models::refine(&prompt) {
                Some(raw) => {
                    let sanitized = naming::sanitize_stem(&raw);
                    if sanitized.is_empty() || sanitized == "recording" {
                        // FM returned junk — keep mechanical stem.
                        (
                            fields.stem.clone(),
                            fields.method.clone(),
                            fields.alternative.clone(),
                            fields.alternative_method.clone(),
                        )
                    } else {
                        // Promote the FM output to primary; demote the
                        // mechanical stem to alt for A/B inspection.
                        (
                            sanitized,
                            "llm".to_string(),
                            Some(fields.stem.clone()),
                            Some("transcription".to_string()),
                        )
                    }
                }
                None => (
                    fields.stem.clone(),
                    fields.method.clone(),
                    fields.alternative.clone(),
                    fields.alternative_method.clone(),
                ),
            }
        } else {
            (
                fields.stem.clone(),
                fields.method.clone(),
                fields.alternative.clone(),
                fields.alternative_method.clone(),
            )
        };

    let safe_stem = naming::sanitize_stem(&final_stem);
    let new_path = naming::rename_with_stem(path, &safe_stem);
    let sanitized_alt = final_alt
        .as_deref()
        .map(naming::sanitize_stem)
        .filter(|s| !s.is_empty());
    naming::AutoNameResult {
        new_path,
        stem: safe_stem,
        tags: fields.tags,
        method: final_method,
        alternative: sanitized_alt,
        alternative_method: final_alt_method,
    }
}

/// Mirror of the prompt template used by the ollama / hf backends in the
/// sidecar. Kept in sync manually — small enough that drift is easy to
/// catch in review.
fn format_fm_prompt(transcript: &str) -> String {
    format!(
        "You are naming a short vocal audio sample for a music producer's sample library.\n\n\
         Transcript: \"{}\"\n\n\
         Produce a memorable 2-4 word filename stem. Rules:\n\
         - Lowercase only, words joined by hyphens (e.g. 'eternal-wave-chant')\n\
         - Use evocative content words (nouns, strong verbs); skip filler\n\
         - Max 40 characters total\n\
         - Return ONLY the stem — no quotes, no explanation, no trailing punctuation\n\n\
         Stem:",
        transcript.trim()
    )
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(feature = "automation")]
    let builder = builder.setup(|app| {
        automation::start(app.handle().clone());
        Ok(())
    });

    builder
        .manage(AppState {
            sidecar: Mutex::new(None),
            audio: AudioState::new(),
        })
        .manage(DbState::new())
        .manage(ImportState::new())
        .manage(WatchState::new())
        .manage(SearchState::new())
        .manage(ProjectState::new())
        .manage(CategorizationState::new())
        .manage(DuplicateState::new())
        .manage(JobState::new())
        .manage(RecorderState::new())
        .manage(RecorderConfigState::new())
        .manage(MlConfigState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            get_app_versions,
            audio_play,
            audio_pause,
            audio_resume,
            audio_stop,
            audio_set_volume,
            audio_get_status,
            // Database CRUD commands (replaces sidecar for DB ops)
            db_commands::db_search,
            db_commands::db_get_sample,
            db_commands::db_update_sample,
            db_commands::db_delete_sample,
            db_commands::db_list_packs,
            db_commands::db_list_tags,
            db_commands::db_list_user_tags,
            db_commands::db_add_tags,
            db_commands::db_remove_tags,
            db_commands::db_batch_update,
            db_commands::db_batch_delete,
            db_commands::db_batch_add_tags,
            db_commands::db_get_type_counts,
            db_commands::db_list_filter_presets,
            db_commands::db_create_filter_preset,
            db_commands::db_update_filter_preset,
            db_commands::db_delete_filter_preset,
            db_commands::db_migrate_types_to_tags,
            db_commands::session_list,
            db_commands::session_get,
            db_commands::list_directory,
            db_commands::get_browse_roots,
            // Import pipeline
            import_commands::import_start,
            import_commands::import_progress,
            import_commands::import_cancel,
            // Watch directory management
            watch::watch_add_directory,
            watch::watch_remove_directory,
            watch::watch_list_directories,
            watch::watch_start,
            watch::watch_stop,
            // Native analysis commands (bypass sidecar for hot paths)
            analysis::native_spectrogram,
            analysis::native_waveform,
            analysis::native_quality,
            analysis::native_audio_info,
            analysis::native_frequency_waveform,
            // Similarity and compatibility search
            search::find_similar,
            search::find_compatible,
            search::generate_embedding,
            search::generate_missing_embeddings,
            search::get_search_stats,
            // Project management
            projects::create_project,
            projects::list_projects,
            projects::get_project,
            projects::update_project,
            projects::delete_project,
            projects::get_project_samples,
            projects::add_sample_to_project,
            projects::remove_sample_from_project,
            projects::update_project_sample,
            projects::export_project_command,
            // Categorization
            categorization::get_acoustic_tags,
            categorization::suggest_type,
            categorization::batch_get_acoustic_tags,
            // Duplicates
            duplicates::get_duplicate_groups,
            duplicates::get_duplicate_stats,
            duplicates::delete_duplicate,
            duplicates::resolve_duplicate_group,
            // Background jobs
            jobs::get_job_stats,
            jobs::queue_missing_embeddings,
            jobs::queue_sample_job,
            jobs::start_job_worker,
            jobs::stop_job_worker,
            jobs::reset_stuck_jobs,
            jobs::cleanup_old_jobs,
            jobs::list_jobs,
            // Recorder commands
            recorder_list_audio_devices,
            recorder_select_device,
            recorder_start_recording,
            recorder_stop_recording,
            recorder_get_recording_status,
            recorder_get_audio_levels,
            recorder_get_waveform_data,
            recorder_get_spectrum_data,
            recorder_get_recording_waveform,
            recorder_get_recordings_dir,
            recorder_open_recordings_dir,
            get_app_data_paths,
            reveal_path,
            recorder_get_config,
            recorder_set_config,
            recorder_set_armed,
            session_current,
            session_set_stem_separation,
            recorder_save_to_library,
            // Multi-select split — turn long recordings into useful samples (vault-3fe9)
            split::split_samples,
            // Orphan recording recovery
            orphans::scan_orphaned_recordings,
            orphans::delete_orphaned_recording,
            orphans::import_orphaned_recording,
            // ML features tab — feature toggles + on-demand model manager (vault-knuo)
            ml_commands::ml_get_status,
            ml_commands::ml_set_feature_enabled,
            ml_commands::ml_set_feature_backend,
            ml_commands::ml_set_feature_model,
            ml_commands::ml_download_model,
            ml_commands::ml_cancel_download,
            ml_commands::ml_remove_model,
            ml_commands::ml_load_model,
            ml_commands::ml_unload_model,
            ml_commands::ml_reload_model,
            // Apple Foundation Models bridge (vault-3ume)
            foundation_models::llm_foundation_refine,
            foundation_models::llm_foundation_availability,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
