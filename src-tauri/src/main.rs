#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod audio;
mod sidecar;

use audio::AudioState;
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
fn audio_get_status(state: State<'_, AppState>) -> Result<(bool, bool, f64), String> {
    let status = state.audio.get_status()?;
    Ok((status.is_playing, status.is_paused, status.duration))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
            audio: AudioState::new(),
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            audio_play,
            audio_pause,
            audio_resume,
            audio_stop,
            audio_set_volume,
            audio_get_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
