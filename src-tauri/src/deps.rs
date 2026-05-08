//! Runtime ML deps install / uninstall (vault-347l Phase 2).
//!
//! The bundled sidecar (PyInstaller) can't pip-install heavy ML libs
//! at runtime, so we delegate model loading to a *worker subprocess*
//! that runs from a separate uv-managed venv at
//! `~/.music-hub-data/python/runtime/`. This module owns the lifecycle
//! of that venv:
//!
//! - `deps_install(extras)` — union the requested extras with anything
//!   already installed, then run `uv sync --extra X --extra Y` against
//!   the runtime pyproject. Streams stdout/stderr to the frontend via
//!   `deps_install_progress` Tauri events. Emits a final
//!   `deps_install_complete` event with success / error.
//! - `deps_uninstall(extras)` — remove from the active set; if the set
//!   becomes empty, blow away the venv entirely.
//!
//! State file `~/.music-hub-data/python/runtime/state.json` tracks
//! which extras the user opted into. Survives .app reinstalls; the venv
//! itself is a cache that can be rebuilt from the state file.
//!
//! Worker spawn (slice 3+) reads from
//! `~/.music-hub-data/python/runtime/.venv/bin/python`.

use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// ============ Paths ============

/// `~/.music-hub-data/python/runtime/`
pub fn runtime_dir() -> PathBuf {
    music_hub_data_dir().join("python").join("runtime")
}

fn music_hub_data_dir() -> PathBuf {
    dirs::home_dir()
        .expect("home dir resolvable")
        .join(".music-hub-data")
}

fn state_file() -> PathBuf {
    runtime_dir().join("state.json")
}

// Used by slice 3 (worker spawn). Kept here so the venv-layout
// invariant lives next to runtime_dir().
#[allow(dead_code)]
fn venv_python() -> PathBuf {
    runtime_dir().join(".venv").join("bin").join("python")
}

/// Resolve the bundled `uv` binary (preferred) or fall back to the
/// system `uv` for dev convenience. Errors only when neither exists.
fn resolve_uv_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(rd) = app.path().resource_dir() {
        let bundled = rd.join("uv");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg("uv").output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            return Ok(PathBuf::from(s));
        }
    }
    Err("uv binary not found (no bundled uv in resource dir, no system uv on PATH)".to_string())
}

fn resolve_runtime_pyproject_template(app: &AppHandle) -> Result<PathBuf, String> {
    let rd = app.path().resource_dir().map_err(|e| e.to_string())?;
    let p = rd.join("runtime-pyproject.toml");
    if p.exists() {
        Ok(p)
    } else {
        Err(format!(
            "runtime-pyproject.toml not found at {} — run `npm run resources:fetch`",
            p.display()
        ))
    }
}

// ============ State file ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeState {
    /// Extras the user has opted into (e.g. ``["embedding", "stems"]``).
    /// Mirrors the `--extra` flags passed to `uv sync` on last install.
    pub extras: Vec<String>,
}

fn read_state() -> RuntimeState {
    let path = state_file();
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return RuntimeState::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_state(state: &RuntimeState) -> Result<(), String> {
    std::fs::create_dir_all(runtime_dir())
        .map_err(|e| format!("create runtime dir: {e}"))?;
    let s = serde_json::to_string_pretty(state)
        .map_err(|e| format!("serialize state: {e}"))?;
    std::fs::write(state_file(), s).map_err(|e| format!("write state: {e}"))?;
    Ok(())
}

// ============ Public read API ============

/// Whether the runtime venv has been created (i.e. has a Python at the
/// expected path). Used by the worker spawn (slice 3) to decide
/// whether to fall back to the frozen sidecar's interpreter.
#[allow(dead_code)] // consumed by slice 3 (ml_worker spawn)
pub fn runtime_venv_ready() -> bool {
    venv_python().exists()
}

/// Return the path to the runtime venv's Python, if the venv exists.
#[allow(dead_code)] // consumed by slice 3 (ml_worker spawn)
pub fn runtime_python_path() -> Option<PathBuf> {
    let p = venv_python();
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Extras currently installed via the runtime venv (per state.json).
/// Used by `ml_commands::deps_get_status` to extend the sidecar's
/// (frozen-interpreter) view with the runtime venv's extras.
pub fn runtime_installed_extras() -> Vec<String> {
    read_state().extras
}

// ============ Install / uninstall ============

/// Module-level mutex serializing uv operations. Two parallel
/// `uv sync` runs against the same venv would corrupt it; the
/// frontend already disables the install button on click, but this
/// is the load-bearing guard.
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub fn deps_install(extras: Vec<String>, app: AppHandle) -> Result<(), String> {
    if extras.is_empty() {
        return Err("deps_install called with empty extras list".to_string());
    }

    let uv = resolve_uv_binary(&app)?;
    let template = resolve_runtime_pyproject_template(&app)?;

    // Compute target extras = currently installed ∪ requested.
    // uv sync is declarative — it removes anything not listed, so the
    // union ensures we don't accidentally tear down an extra the user
    // installed earlier.
    let current = runtime_installed_extras();
    let mut target_set: HashSet<String> = current.into_iter().collect();
    for e in &extras {
        target_set.insert(e.clone());
    }
    let mut target: Vec<String> = target_set.into_iter().collect();
    target.sort();

    std::fs::create_dir_all(runtime_dir())
        .map_err(|e| format!("create runtime dir: {e}"))?;
    std::fs::copy(&template, runtime_dir().join("pyproject.toml"))
        .map_err(|e| format!("copy runtime-pyproject.toml: {e}"))?;

    let app_for_thread = app.clone();
    let target_for_thread = target.clone();
    std::thread::spawn(move || {
        run_uv_sync_and_emit(&app_for_thread, &uv, &target_for_thread);
    });
    Ok(())
}

#[tauri::command]
pub fn deps_uninstall(extras: Vec<String>, app: AppHandle) -> Result<(), String> {
    let current = runtime_installed_extras();
    let to_remove: HashSet<String> = extras.iter().cloned().collect();
    let target: Vec<String> = current
        .into_iter()
        .filter(|e| !to_remove.contains(e))
        .collect();

    if target.is_empty() {
        // Tear down the whole venv — cheap, and getting back to "clean" is
        // a useful escape hatch.
        let _ = std::fs::remove_dir_all(runtime_dir().join(".venv"));
        write_state(&RuntimeState::default())?;
        let _ = app.emit(
            "deps_install_complete",
            serde_json::json!({ "success": true, "phase": "uninstall_all" }),
        );
        return Ok(());
    }

    // Otherwise re-sync without the removed extras.
    let uv = resolve_uv_binary(&app)?;
    let template = resolve_runtime_pyproject_template(&app)?;
    std::fs::create_dir_all(runtime_dir())
        .map_err(|e| format!("create runtime dir: {e}"))?;
    std::fs::copy(&template, runtime_dir().join("pyproject.toml"))
        .map_err(|e| format!("copy runtime-pyproject.toml: {e}"))?;

    let app_for_thread = app.clone();
    let target_for_thread = target.clone();
    std::thread::spawn(move || {
        run_uv_sync_and_emit(&app_for_thread, &uv, &target_for_thread);
    });
    Ok(())
}

fn run_uv_sync_and_emit(app: &AppHandle, uv: &Path, extras: &[String]) {
    let _guard = match INSTALL_LOCK.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };

    let mut args: Vec<String> = vec![
        "sync".to_string(),
        "--no-progress".to_string(), // we render our own progress UI
        "--python".to_string(),
        "3.11".to_string(), // pin matches sidecar/pyproject.toml's requires-python
    ];
    for e in extras {
        args.push("--extra".to_string());
        args.push(e.clone());
    }

    let _ = app.emit(
        "deps_install_progress",
        serde_json::json!({
            "kind": "info",
            "line": format!("Running uv {}", args.join(" ")),
        }),
    );

    let mut child = match std::process::Command::new(uv)
        .args(&args)
        .current_dir(runtime_dir())
        // Force copy semantics so we don't surface "different filesystems"
        // hardlink errors when the cache + runtime live on the same disk
        // but uv decides to clone via a method that isn't supported.
        .env("UV_LINK_MODE", "copy")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                "deps_install_complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("spawn uv failed: {e}"),
                }),
            );
            return;
        }
    };

    let stdout_handle = child.stdout.take().map(|s| {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(s).lines().map_while(Result::ok) {
                let _ = app_clone.emit(
                    "deps_install_progress",
                    serde_json::json!({ "kind": "stdout", "line": line }),
                );
            }
        })
    });
    let stderr_handle = child.stderr.take().map(|s| {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(s).lines().map_while(Result::ok) {
                let _ = app_clone.emit(
                    "deps_install_progress",
                    serde_json::json!({ "kind": "stderr", "line": line }),
                );
            }
        })
    });

    let status = child.wait();
    if let Some(h) = stdout_handle {
        let _ = h.join();
    }
    if let Some(h) = stderr_handle {
        let _ = h.join();
    }

    match status {
        Ok(s) if s.success() => {
            // Persist the new extras set.
            let _ = write_state(&RuntimeState {
                extras: extras.to_vec(),
            });
            let _ = app.emit(
                "deps_install_complete",
                serde_json::json!({ "success": true, "extras": extras }),
            );
        }
        Ok(s) => {
            let _ = app.emit(
                "deps_install_complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("uv sync exited with code {}", s.code().unwrap_or(-1)),
                }),
            );
        }
        Err(e) => {
            let _ = app.emit(
                "deps_install_complete",
                serde_json::json!({
                    "success": false,
                    "error": format!("uv sync wait failed: {e}"),
                }),
            );
        }
    }
}
