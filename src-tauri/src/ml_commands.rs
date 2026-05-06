//! ML features tab — feature toggles + on-demand model download manager.
//!
//! Two registries (compile-time hardcoded for v1):
//!
//! - **Models** — HF repo IDs the app knows how to download/load. Each
//!   carries a ``kind`` (embedding / transcription / stems / …) so the
//!   feature → model picker can offer compatible variants only.
//! - **Features** — user-facing capabilities (auto-naming, embedding
//!   similarity, stem separation). Each declares a ``kind`` it needs
//!   plus a default model. The user can swap to any compatible model
//!   in the registry via the dropdown.
//!
//! Persistence: ``~/.music-hub-data/ml-features-config.json`` (matching
//! the existing recorder-config JSON convention rather than introducing
//! a TOML dependency for this one file). Schema:
//!
//! ```json
//! {
//!   "features": {
//!     "embedding_similarity": { "enabled": false, "model_id": "laion/clap-htsat-unfused" }
//!   }
//! }
//! ```
//!
//! Model state (downloaded / loaded / downloading / error) lives in the
//! sidecar process — Rust is a thin proxy that forwards lifecycle calls
//! and combines the response with feature config.
//!
//! Reference counting: a model is loaded iff at least one enabled
//! feature references it. Toggling a feature on calls ``ml_load_model``
//! when the model is downloaded; off calls ``ml_unload_model`` only if
//! no other enabled feature still depends on the same model.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

// ============ Static registries ============

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub model_id: String,
    pub label: String,
    pub kind: String,
    pub size_estimate_mb: u32,
    /// ``hf`` (HuggingFace, default) or ``lib_managed:<lib>`` (the
    /// underlying ML library handles the download — e.g.
    /// ``lib_managed:demucs``). The frontend uses this to swap the
    /// "X MB on disk" hint for a library-managed disclosure.
    pub download_strategy: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeatureInfo {
    pub feature_id: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    pub default_model_id: String,
}

fn registered_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            model_id: "laion/clap-htsat-unfused".to_string(),
            label: "CLAP (HTSAT, unfused)".to_string(),
            kind: "embedding".to_string(),
            size_estimate_mb: 620,
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "laion/clap-htsat-fused".to_string(),
            label: "CLAP (HTSAT, fused)".to_string(),
            kind: "embedding".to_string(),
            size_estimate_mb: 1300,
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "openai/whisper-tiny".to_string(),
            label: "Whisper tiny".to_string(),
            kind: "transcription".to_string(),
            size_estimate_mb: 75,
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "openai/whisper-base".to_string(),
            label: "Whisper base".to_string(),
            kind: "transcription".to_string(),
            size_estimate_mb: 145,
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "facebook/htdemucs".to_string(),
            label: "Demucs (htdemucs)".to_string(),
            kind: "stems".to_string(),
            size_estimate_mb: 300,
            download_strategy: "lib_managed:demucs".to_string(),
        },
    ]
}

fn registered_features() -> Vec<FeatureInfo> {
    vec![
        FeatureInfo {
            feature_id: "embedding_similarity".to_string(),
            label: "Embedding similarity".to_string(),
            description: "CLAP embeddings for semantic search and similarity browse".to_string(),
            kind: "embedding".to_string(),
            default_model_id: "laion/clap-htsat-unfused".to_string(),
        },
        FeatureInfo {
            feature_id: "auto_naming".to_string(),
            label: "Auto-naming (vocal transcription)".to_string(),
            description: "Whisper transcribes vocal samples to derive filenames".to_string(),
            kind: "transcription".to_string(),
            default_model_id: "openai/whisper-tiny".to_string(),
        },
        FeatureInfo {
            feature_id: "stem_separation".to_string(),
            label: "Stem separation".to_string(),
            description: "Demucs splits clips into drums/bass/vocals/other".to_string(),
            kind: "stems".to_string(),
            default_model_id: "facebook/htdemucs".to_string(),
        },
        FeatureInfo {
            feature_id: "llm_naming_refinement".to_string(),
            label: "LLM naming refinement".to_string(),
            description: "Local LLM (via ollama) refines transcript-derived filenames".to_string(),
            kind: "llm".to_string(),
            default_model_id: "ollama:gemma3:1b".to_string(),
        },
    ]
}

/// Helpers for the dynamic ``ollama:*`` model entries. Ollama's available
/// models live in the daemon, not in our static registry — we fetch them at
/// status time and merge them into the model list. Picking one in the
/// dropdown is the same as calling ``set_ollama_model`` on the bare name.
const OLLAMA_PREFIX: &str = "ollama:";

fn fetch_ollama_status(app_state: &State<'_, AppState>) -> Option<serde_json::Value> {
    rpc(app_state, "get_ollama_status", serde_json::json!({})).ok()
}

fn dynamic_llm_models(ollama: &serde_json::Value) -> Vec<ModelInfo> {
    let avail = ollama
        .get("available_models")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    avail
        .iter()
        .filter_map(|v| v.as_str())
        .map(|name| ModelInfo {
            model_id: format!("{OLLAMA_PREFIX}{name}"),
            label: name.to_string(),
            kind: "llm".to_string(),
            size_estimate_mb: 0,
            download_strategy: "lib_managed:ollama".to_string(),
        })
        .collect()
}

/// Translate ollama's snapshot to a model_state matching the shape that
/// ``ml_list_model_states`` returns for HF / lib_managed:demucs models.
///
/// Distinguishes daemon-unreachable from daemon-up-with-no-models-pulled.
/// Both leave ``available_models`` empty, but only the unreachable case
/// has a non-empty ``error`` on the snapshot. Daemon unreachable surfaces
/// as ``state = "error"`` with an actionable install message; no models
/// pulled surfaces as ``state = "not_downloaded"``.
fn ollama_model_state(model_id: &str, ollama: &serde_json::Value) -> serde_json::Value {
    let model_name = model_id
        .strip_prefix(OLLAMA_PREFIX)
        .unwrap_or(model_id);
    let avail_names: Vec<String> = ollama
        .get("available_models")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let state_str = ollama
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("not_loaded");
    let active_model = ollama.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let raw_error = ollama.get("error").and_then(|v| v.as_str());

    let downloaded = avail_names.iter().any(|n| n == model_name);
    let is_active = active_model == model_name;
    // OllamaStatus reports unreachable daemon by leaving available_models
    // empty AND setting error = "daemon unreachable" (or similar). When the
    // daemon is reachable but no models are pulled, available_models is
    // empty but error is None.
    let daemon_unreachable = avail_names.is_empty() && raw_error.is_some();

    let (state, error_msg) = if daemon_unreachable {
        (
            "error",
            Some(
                "ollama daemon unreachable — install via `brew install ollama` and run `ollama serve`"
                    .to_string(),
            ),
        )
    } else if !downloaded {
        ("not_downloaded", None)
    } else if is_active {
        match state_str {
            "loading" => ("loading", None),
            "loaded" => ("loaded", None),
            "errored" => ("error", raw_error.map(String::from)),
            _ => ("downloaded_not_loaded", None),
        }
    } else {
        ("downloaded_not_loaded", None)
    };

    serde_json::json!({
        "model_id": model_id,
        "state": state,
        "downloaded": downloaded,
        "loaded": is_active && state_str == "loaded" && !daemon_unreachable,
        "disk_bytes": 0,
        "error": error_msg,
    })
}

fn is_ollama_model(model_id: &str) -> bool {
    model_id.starts_with(OLLAMA_PREFIX)
}

// ============ Config persistence ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeatureState {
    pub enabled: bool,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MlConfig {
    #[serde(default)]
    pub features: HashMap<String, FeatureState>,
}

impl MlConfig {
    fn ensure_defaults(&mut self) {
        for f in registered_features() {
            self.features
                .entry(f.feature_id.clone())
                .or_insert(FeatureState {
                    enabled: false,
                    model_id: f.default_model_id.clone(),
                });
        }
    }
}

pub struct MlConfigState {
    inner: Mutex<MlConfig>,
    path: PathBuf,
    /// Set after the first ``ml_get_status`` call kicks off auto-loads
    /// for enabled-but-not-loaded models. Idempotent across the app
    /// lifetime — subsequent toggles drive load/unload directly.
    autoload_done: AtomicBool,
}

impl MlConfigState {
    pub fn new() -> Self {
        let path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".music-hub-data")
            .join("ml-features-config.json");

        let mut config = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<MlConfig>(&s).ok())
                .unwrap_or_default()
        } else {
            MlConfig::default()
        };
        config.ensure_defaults();

        Self {
            inner: Mutex::new(config),
            path,
            autoload_done: AtomicBool::new(false),
        }
    }

    fn save(&self, config: &MlConfig) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn snapshot(&self) -> Result<MlConfig, String> {
        let g = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(g.clone())
    }

    fn update<F: FnOnce(&mut MlConfig)>(&self, f: F) -> Result<MlConfig, String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        f(&mut g);
        self.save(&g)?;
        Ok(g.clone())
    }
}

// ============ Sidecar proxy ============

fn rpc(state: &State<'_, AppState>, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        match crate::sidecar::SidecarManager::new() {
            Ok(m) => *guard = Some(m),
            Err(e) => return Err(format!("Sidecar unavailable: {e}")),
        }
    }
    let manager = guard.as_mut().unwrap();
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    })
    .to_string();
    let resp_str = manager.call_sync(&req).map_err(|e| e.to_string())?;
    let resp: serde_json::Value = serde_json::from_str(&resp_str).map_err(|e| e.to_string())?;
    if let Some(err) = resp.get("error") {
        return Err(format!("Sidecar error: {err}"));
    }
    resp.get("result")
        .cloned()
        .ok_or_else(|| "Missing result".to_string())
}

fn fetch_model_states(
    app_state: &State<'_, AppState>,
    model_ids: &[String],
) -> Result<HashMap<String, serde_json::Value>, String> {
    let params = serde_json::json!({ "model_ids": model_ids });
    let result = rpc(app_state, "ml_list_model_states", params)?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

/// Compose status from all sources: HF / lib_managed:demucs models from the
/// sidecar's tracker, plus dynamic ``ollama:*`` models derived from
/// ``get_ollama_status``. Single entry point for every Tauri command that
/// returns ``MlStatus`` — keeps the merging logic in one place.
///
/// The LLM dropdown always contains at least the persisted + default
/// ``ollama:*`` model, even when the daemon is unreachable. This keeps
/// the UI populated so the user can see which model is configured and
/// surfaces a clear error state ("Daemon unreachable") instead of an
/// empty dropdown.
fn fetch_full_status(
    config: &MlConfig,
    app_state: &State<'_, AppState>,
) -> MlStatus {
    let static_ids: Vec<String> = registered_models()
        .into_iter()
        .map(|m| m.model_id)
        .collect();
    let mut states = fetch_model_states(app_state, &static_ids).unwrap_or_default();

    let ollama_opt = fetch_ollama_status(app_state);
    let mut extras: Vec<ModelInfo> = match &ollama_opt {
        Some(o) => dynamic_llm_models(o),
        None => vec![],
    };

    // Stamp state for everything we've already collected.
    if let Some(ollama) = &ollama_opt {
        for m in &extras {
            states.insert(m.model_id.clone(), ollama_model_state(&m.model_id, ollama));
        }
    }

    // Always include the persisted + default LLM model in the dropdown, even
    // if the daemon is down or the model isn't pulled. The user needs to see
    // *something* — empty dropdown reads as "broken UI", not "fix your env".
    let llm_default = registered_features()
        .into_iter()
        .find(|f| f.feature_id == "llm_naming_refinement")
        .map(|f| f.default_model_id);
    let llm_persisted = config
        .features
        .get("llm_naming_refinement")
        .map(|f| f.model_id.clone());
    for candidate in [llm_persisted, llm_default].into_iter().flatten() {
        if !candidate.starts_with(OLLAMA_PREFIX) {
            continue;
        }
        if extras.iter().any(|m| m.model_id == candidate) {
            continue;
        }
        let bare = candidate.strip_prefix(OLLAMA_PREFIX).unwrap_or(&candidate);
        extras.push(ModelInfo {
            model_id: candidate.clone(),
            label: bare.to_string(),
            kind: "llm".to_string(),
            size_estimate_mb: 0,
            download_strategy: "lib_managed:ollama".to_string(),
        });
        let synthetic_state = match &ollama_opt {
            Some(o) => ollama_model_state(&candidate, o),
            None => serde_json::json!({
                "model_id": candidate,
                "state": "error",
                "downloaded": false,
                "loaded": false,
                "disk_bytes": 0,
                "error": "ollama daemon unreachable — install via `brew install ollama` and run `ollama serve`",
            }),
        };
        states.insert(candidate, synthetic_state);
    }

    build_status(config, &states, extras)
}

// ============ Public response shapes ============

#[derive(Debug, Serialize)]
pub struct MlStatus {
    pub features: Vec<MlFeatureView>,
    pub models: Vec<MlModelView>,
}

#[derive(Debug, Serialize)]
pub struct MlFeatureView {
    #[serde(flatten)]
    pub info: FeatureInfo,
    pub enabled: bool,
    pub model_id: String,
}

#[derive(Debug, Serialize)]
pub struct MlModelView {
    #[serde(flatten)]
    pub info: ModelInfo,
    pub state: String,
    pub downloaded: bool,
    pub loaded: bool,
    pub disk_bytes: u64,
    pub error: Option<String>,
}

fn build_status(
    config: &MlConfig,
    sidecar_states: &HashMap<String, serde_json::Value>,
    extra_models: Vec<ModelInfo>,
) -> MlStatus {
    let features: Vec<MlFeatureView> = registered_features()
        .into_iter()
        .map(|info| {
            let state = config
                .features
                .get(&info.feature_id)
                .cloned()
                .unwrap_or_else(|| FeatureState {
                    enabled: false,
                    model_id: info.default_model_id.clone(),
                });
            MlFeatureView {
                info,
                enabled: state.enabled,
                model_id: state.model_id,
            }
        })
        .collect();

    let mut all_models = registered_models();
    all_models.extend(extra_models);

    let models: Vec<MlModelView> = all_models
        .into_iter()
        .map(|info| {
            let s = sidecar_states.get(&info.model_id);
            let state = s
                .and_then(|v| v.get("state"))
                .and_then(|v| v.as_str())
                .unwrap_or("not_downloaded")
                .to_string();
            let downloaded = s
                .and_then(|v| v.get("downloaded"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let loaded = s
                .and_then(|v| v.get("loaded"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let disk_bytes = s
                .and_then(|v| v.get("disk_bytes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let error = s
                .and_then(|v| v.get("error"))
                .and_then(|v| v.as_str())
                .map(String::from);
            MlModelView {
                info,
                state,
                downloaded,
                loaded,
                disk_bytes,
                error,
            }
        })
        .collect();

    MlStatus { features, models }
}

// ============ Tauri commands ============

#[tauri::command]
pub fn ml_get_status(
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let config = cfg.snapshot()?;
    let snapshot = fetch_full_status(&config, &app_state);

    // First call after app start: kick off background loads for any enabled
    // feature whose model is downloaded but not yet loaded. Subsequent calls
    // are pure reads. Load is async (returns immediately) so this doesn't
    // block the status RPC. Ollama warmup is handled by the sidecar's own
    // startup thread, so we only auto-load HF / lib_managed:demucs.
    if !cfg.autoload_done.swap(true, Ordering::SeqCst) {
        let mut already_kicked: std::collections::HashSet<String> = Default::default();
        for feat in &snapshot.features {
            if !feat.enabled {
                continue;
            }
            if is_ollama_model(&feat.model_id) {
                continue;
            }
            if !already_kicked.insert(feat.model_id.clone()) {
                continue;
            }
            if let Some(m) = snapshot.models.iter().find(|m| m.info.model_id == feat.model_id) {
                if m.state == "downloaded_not_loaded" {
                    let _ = rpc(
                        &app_state,
                        "ml_load_model",
                        serde_json::json!({ "model_id": feat.model_id.clone() }),
                    );
                }
            }
        }
        // Re-fetch so the response reflects any "loading" we just kicked off.
        return Ok(fetch_full_status(&config, &app_state));
    }

    Ok(snapshot)
}

/// Trigger a load for ``model_id``. Dispatches to ``set_ollama_model`` for
/// ``ollama:*`` IDs (warms the daemon) or ``ml_load_model`` for HF /
/// lib_managed models. Best-effort — errors are reflected in subsequent
/// status fetches, not surfaced to the caller.
fn dispatch_load(app_state: &State<'_, AppState>, model_id: &str) {
    if is_ollama_model(model_id) {
        let bare = model_id.strip_prefix(OLLAMA_PREFIX).unwrap_or(model_id);
        let _ = rpc(
            app_state,
            "set_ollama_model",
            serde_json::json!({ "model": bare }),
        );
    } else {
        let _ = rpc(
            app_state,
            "ml_load_model",
            serde_json::json!({ "model_id": model_id }),
        );
    }
}

/// Trigger an unload for ``model_id``. Ollama models are managed externally
/// (the daemon keeps them in memory); we treat unload as a no-op there.
fn dispatch_unload(app_state: &State<'_, AppState>, model_id: &str) {
    if is_ollama_model(model_id) {
        return;
    }
    let _ = rpc(
        app_state,
        "ml_unload_model",
        serde_json::json!({ "model_id": model_id }),
    );
}

#[tauri::command]
pub fn ml_set_feature_enabled(
    feature_id: String,
    enabled: bool,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let info = registered_features()
        .into_iter()
        .find(|f| f.feature_id == feature_id)
        .ok_or_else(|| format!("Unknown feature: {feature_id}"))?;

    let prev = cfg.snapshot()?;
    let prev_model = prev
        .features
        .get(&feature_id)
        .map(|f| f.model_id.clone())
        .unwrap_or_else(|| info.default_model_id.clone());

    let updated = cfg.update(|c| {
        let entry = c
            .features
            .entry(feature_id.clone())
            .or_insert(FeatureState {
                enabled: false,
                model_id: info.default_model_id.clone(),
            });
        entry.enabled = enabled;
    })?;

    if enabled {
        dispatch_load(&app_state, &prev_model);
    } else {
        // Unload only if no other enabled feature depends on this model.
        let still_referenced = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id && fs.enabled && fs.model_id == prev_model
        });
        if !still_referenced {
            dispatch_unload(&app_state, &prev_model);
        }
    }

    Ok(fetch_full_status(&updated, &app_state))
}

#[tauri::command]
pub fn ml_set_feature_model(
    feature_id: String,
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let info = registered_features()
        .into_iter()
        .find(|f| f.feature_id == feature_id)
        .ok_or_else(|| format!("Unknown feature: {feature_id}"))?;

    // Compatibility check. Static models live in registered_models();
    // ollama models are dynamic (kind always "llm"), so for ``ollama:*``
    // IDs we trust the kind and skip the static lookup.
    if !is_ollama_model(&model_id) {
        let target_model = registered_models()
            .into_iter()
            .find(|m| m.model_id == model_id)
            .ok_or_else(|| format!("Unknown model: {model_id}"))?;
        if target_model.kind != info.kind {
            return Err(format!(
                "Model {} (kind={}) is not compatible with feature {} (kind={})",
                model_id, target_model.kind, feature_id, info.kind
            ));
        }
    } else if info.kind != "llm" {
        return Err(format!(
            "Ollama model {} can only be assigned to llm-kind features",
            model_id
        ));
    }

    let prev = cfg.snapshot()?;
    let prev_state = prev
        .features
        .get(&feature_id)
        .cloned()
        .unwrap_or(FeatureState {
            enabled: false,
            model_id: info.default_model_id.clone(),
        });

    let updated = cfg.update(|c| {
        let entry = c.features.entry(feature_id.clone()).or_default();
        entry.model_id = model_id.clone();
    })?;

    if prev_state.enabled && prev_state.model_id != model_id {
        // Switch: unload previous (if no other feature uses it), load new.
        let prev_still = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id && fs.enabled && fs.model_id == prev_state.model_id
        });
        if !prev_still {
            dispatch_unload(&app_state, &prev_state.model_id);
        }
        dispatch_load(&app_state, &model_id);
    }

    Ok(fetch_full_status(&updated, &app_state))
}

#[tauri::command]
pub fn ml_download_model(
    model_id: String,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if is_ollama_model(&model_id) {
        let bare = model_id.strip_prefix(OLLAMA_PREFIX).unwrap_or(&model_id);
        return Err(format!(
            "Ollama models are managed by the daemon. Pull from a terminal: `ollama pull {bare}`"
        ));
    }
    rpc(
        &app_state,
        "ml_download_model",
        serde_json::json!({ "model_id": model_id }),
    )
}

#[tauri::command]
pub fn ml_cancel_download(
    model_id: String,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    rpc(
        &app_state,
        "ml_cancel_download",
        serde_json::json!({ "model_id": model_id }),
    )
}

#[tauri::command]
pub fn ml_remove_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // Refuse if any enabled feature depends on this model.
    let config = cfg.snapshot()?;
    let referenced = config
        .features
        .iter()
        .any(|(_, fs)| fs.enabled && fs.model_id == model_id);
    if referenced {
        return Err(format!(
            "Model {model_id} is in use by an enabled feature. Disable the feature or pick a different model first."
        ));
    }
    if is_ollama_model(&model_id) {
        let bare = model_id.strip_prefix(OLLAMA_PREFIX).unwrap_or(&model_id);
        return Err(format!(
            "Ollama models are managed by the daemon. Remove from a terminal: `ollama rm {bare}`"
        ));
    }
    rpc(
        &app_state,
        "ml_remove_model",
        serde_json::json!({ "model_id": model_id }),
    )
}

#[tauri::command]
pub fn ml_load_model(
    model_id: String,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if is_ollama_model(&model_id) {
        let bare = model_id.strip_prefix(OLLAMA_PREFIX).unwrap_or(&model_id);
        return rpc(
            &app_state,
            "set_ollama_model",
            serde_json::json!({ "model": bare }),
        );
    }
    rpc(
        &app_state,
        "ml_load_model",
        serde_json::json!({ "model_id": model_id }),
    )
}

#[tauri::command]
pub fn ml_unload_model(
    model_id: String,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if is_ollama_model(&model_id) {
        // Ollama keeps loaded models warm in the daemon; we don't manage that
        // memory. Treat unload as a no-op so toggle-off is consistent.
        return Ok(serde_json::json!({ "noop": true }));
    }
    rpc(
        &app_state,
        "ml_unload_model",
        serde_json::json!({ "model_id": model_id }),
    )
}

/// Reload a model: unload + load. Useful for recovering from transient
/// errors or after the user has updated weights manually. Doesn't touch
/// the persisted ``enabled`` state. For ollama models, this re-runs warmup
/// via ``set_ollama_model``.
#[tauri::command]
pub fn ml_reload_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    dispatch_unload(&app_state, &model_id);
    dispatch_load(&app_state, &model_id);
    let config = cfg.snapshot()?;
    Ok(fetch_full_status(&config, &app_state))
}
