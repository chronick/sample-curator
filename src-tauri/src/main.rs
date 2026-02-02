#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod analysis;
mod audio;
mod categorization;
mod duplicates;
mod jobs;
mod projects;
mod search;
mod sidecar;

use audio::AudioState;
use categorization::CategorizationState;
use duplicates::DuplicateState;
use jobs::JobState;
use projects::ProjectState;
use search::SearchState;
use sidecar::SidecarManager;
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

    // Initialize sidecar if not already running
    if sidecar_guard.is_none() {
        let manager = SidecarManager::new().map_err(|e| e.to_string())?;
        *sidecar_guard = Some(manager);
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

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
            audio: AudioState::new(),
        })
        .manage(SearchState::new())
        .manage(ProjectState::new())
        .manage(CategorizationState::new())
        .manage(DuplicateState::new())
        .manage(JobState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            audio_play,
            audio_pause,
            audio_resume,
            audio_stop,
            audio_set_volume,
            audio_get_status,
            // Native analysis commands (bypass sidecar for hot paths)
            analysis::native_spectrogram,
            analysis::native_waveform,
            analysis::native_quality,
            analysis::native_audio_info,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
