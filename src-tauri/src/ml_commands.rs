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
    ]
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

    let models: Vec<MlModelView> = registered_models()
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
    let model_ids: Vec<String> = registered_models()
        .into_iter()
        .map(|m| m.model_id)
        .collect();
    let states = fetch_model_states(&app_state, &model_ids).unwrap_or_default();

    // First call after app start: kick off background loads for any enabled
    // feature whose model is downloaded but not yet loaded. Subsequent calls
    // are pure reads. Sidecar load_model is async (returns immediately) so
    // this doesn't block the status RPC.
    if !cfg.autoload_done.swap(true, Ordering::SeqCst) {
        let mut already_kicked: std::collections::HashSet<String> = Default::default();
        let snapshot = build_status(&config, &states);
        for feat in &snapshot.features {
            if !feat.enabled {
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
        // Re-fetch states so the response reflects any "loading" we just kicked off.
        let states2 = fetch_model_states(&app_state, &model_ids).unwrap_or_default();
        return Ok(build_status(&config, &states2));
    }

    Ok(build_status(&config, &states))
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
        // Try to load the model. Best-effort: if download missing or lib
        // missing, sidecar surfaces the error in subsequent get_status.
        let _ = rpc(
            &app_state,
            "ml_load_model",
            serde_json::json!({ "model_id": prev_model.clone() }),
        );
    } else {
        // Unload only if no other enabled feature depends on this model.
        let still_referenced = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id && fs.enabled && fs.model_id == prev_model
        });
        if !still_referenced {
            let _ = rpc(
                &app_state,
                "ml_unload_model",
                serde_json::json!({ "model_id": prev_model.clone() }),
            );
        }
    }

    let model_ids: Vec<String> = registered_models()
        .into_iter()
        .map(|m| m.model_id)
        .collect();
    let states = fetch_model_states(&app_state, &model_ids).unwrap_or_default();
    Ok(build_status(&updated, &states))
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
            let _ = rpc(
                &app_state,
                "ml_unload_model",
                serde_json::json!({ "model_id": prev_state.model_id }),
            );
        }
        let _ = rpc(
            &app_state,
            "ml_load_model",
            serde_json::json!({ "model_id": model_id.clone() }),
        );
    }

    let model_ids: Vec<String> = registered_models()
        .into_iter()
        .map(|m| m.model_id)
        .collect();
    let states = fetch_model_states(&app_state, &model_ids).unwrap_or_default();
    Ok(build_status(&updated, &states))
}

#[tauri::command]
pub fn ml_download_model(
    model_id: String,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
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
    rpc(
        &app_state,
        "ml_unload_model",
        serde_json::json!({ "model_id": model_id }),
    )
}
