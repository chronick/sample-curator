#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod sidecar;

use sidecar::SidecarManager;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    sidecar: Mutex<Option<SidecarManager>>,
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

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![sidecar_call])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
