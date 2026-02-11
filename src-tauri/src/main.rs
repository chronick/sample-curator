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
mod import_commands;
mod jobs;
mod projects;
mod recorder;
mod search;
mod sidecar;
mod watch;

use audio::AudioState;
use categorization::CategorizationState;
use db_commands::DbState;
use duplicates::DuplicateState;
use import_commands::ImportState;
use jobs::JobState;
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
fn recorder_select_device(device_id: String, state: State<'_, RecorderState>) -> Result<(), String> {
    recorder::audio_capture::select_device(&device_id, &state)
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

#[derive(serde::Serialize)]
struct RecorderSaveResult {
    sample_id: i64,
    path: String,
    analyzed: bool,
    pack_name: Option<String>,
}

#[tauri::command]
fn recorder_save_to_library(
    path: String,
    tags: Vec<String>,
    state: State<'_, DbState>,
) -> Result<RecorderSaveResult, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get audio file info for duration/channels
    let reader = hound::WavReader::open(&path).map_err(|e| format!("Failed to read WAV: {}", e))?;
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
            &path,
            Some("recorded"),
            None,
            Some(duration),
            Some(spec.sample_rate as i32),
            Some(spec.channels as i32),
            pack_id,
        )
        .map_err(|e| e.to_string())?;

    // Add tags
    for tag in &tags {
        db.add_tag_to_sample(sample_id, tag)
            .map_err(|e| e.to_string())?;
    }

    // Always add "recorded" tag
    let _ = db.add_tag_to_sample(sample_id, "recorded");

    // Select pipeline based on tags and run analysis
    let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();
    let pipeline = analysis_pipeline::pipeline_for_tags(&tag_refs);
    let analysis_result = analysis_pipeline::analyze_sample(db, sample_id, &path, pipeline);

    let pack_name = pack_id.and_then(|pid| {
        db.get_pack(pid).ok().flatten().map(|p| p.name)
    });

    Ok(RecorderSaveResult {
        sample_id,
        path,
        analyzed: analysis_result.analyzed,
        pack_name,
    })
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init());

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
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
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
            recorder_get_config,
            recorder_set_config,
            recorder_save_to_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
