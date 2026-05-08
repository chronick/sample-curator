//! ML features tab — feature toggles + on-demand model download manager.
//!
//! Three layers (compile-time hardcoded for v1):
//!
//! - **Backends** — execution backends that own their own model lists.
//!   Today: ``foundation`` (Apple Foundation Models, OS-provided),
//!   ``ollama`` (local daemon), ``hf`` (HuggingFace, in-sidecar). Each
//!   declares its own availability + an ``unavailable_reason`` when the
//!   user's environment doesn't satisfy it.
//! - **Models** — owned by a backend. ``hf`` models are static (CLAP,
//!   Whisper, Demucs, Qwen). ``ollama`` models are dynamic (discovered
//!   from ``ollama list``). ``foundation`` exposes a single synthetic
//!   ``system-default`` entry.
//! - **Features** — user-facing capabilities. Each declares a ``kind``
//!   it needs and a list of ``backends`` it can use. Single-backend
//!   features (CLAP/Whisper/Demucs) declare ``["hf"]`` and the UI
//!   hides the backend selector. Multi-backend features (LLM naming
//!   refinement) declare all three; the UI shows a backend dropdown
//!   plus a backend-scoped model dropdown.
//!
//! Persistence: ``~/.music-hub-data/ml-features-config.json``. Schema:
//!
//! ```json
//! {
//!   "features": {
//!     "embedding_similarity": {
//!       "enabled": false,
//!       "backend": "hf",
//!       "model_id": "laion/clap-htsat-unfused"
//!     },
//!     "llm_naming_refinement": {
//!       "enabled": true,
//!       "backend": "ollama",
//!       "model_id": "gemma3:1b"
//!     }
//!   }
//! }
//! ```
//!
//! Migration: pre-backend configs (``model_id: "ollama:gemma3:1b"``)
//! are silently rewritten in ``ensure_defaults`` to the new
//! ``(backend, model_id)`` pair.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

// ============ Backend identifiers ============

pub const BACKEND_FOUNDATION: &str = "foundation";
pub const BACKEND_OLLAMA: &str = "ollama";
pub const BACKEND_HF: &str = "hf";

// ============ Static registries ============

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub model_id: String,
    pub label: String,
    pub kind: String,
    pub size_estimate_mb: u32,
    /// Backend that owns this model — one of ``foundation`` / ``ollama`` / ``hf``.
    pub backend: String,
    /// ``hf`` (default), ``lib_managed:<lib>`` (the underlying ML library
    /// handles the download — e.g. ``lib_managed:demucs``), ``lib_managed:ollama``
    /// (daemon-managed), or ``system`` (OS-provided, no download needed).
    pub download_strategy: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeatureInfo {
    pub feature_id: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    /// Backends this feature can run on, in preferred order. Single-backend
    /// features have a single entry; the UI hides the backend selector for them.
    pub backends: Vec<String>,
    pub default_backend: String,
    pub default_model_id: String,
    /// Sidecar extras that must be installed for the feature itself to
    /// function regardless of backend (vault-347l). Per-backend extras
    /// are declared on ``BackendInfo``; the UI greys the toggle when any
    /// of (feature.required_extras ∪ active_backend.required_extras)
    /// reports ``installed: false``.
    #[serde(default)]
    pub required_extras: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    pub backend_id: String,
    pub label: String,
    /// User-facing one-liner, e.g. "Local daemon · fast quantized inference".
    pub description: String,
    /// Sidecar extras the backend depends on (vault-347l). Empty for
    /// the Foundation Models backend (Swift, no Python deps).
    #[serde(default)]
    pub required_extras: Vec<String>,
}

fn registered_backends() -> Vec<BackendInfo> {
    vec![
        BackendInfo {
            backend_id: BACKEND_FOUNDATION.to_string(),
            label: "Apple Foundation Models".to_string(),
            description: "Built into macOS — zero install, zero download.".to_string(),
            required_extras: vec![],
        },
        BackendInfo {
            backend_id: BACKEND_OLLAMA.to_string(),
            label: "Ollama".to_string(),
            description: "Local daemon — fast quantized inference. Requires `brew install ollama`.".to_string(),
            required_extras: vec!["llm_ollama".to_string()],
        },
        BackendInfo {
            backend_id: BACKEND_HF.to_string(),
            label: "HuggingFace Transformers".to_string(),
            description: "In-app inference — bigger first download, runs everywhere.".to_string(),
            required_extras: vec!["llm_hf".to_string()],
        },
    ]
}

fn registered_models() -> Vec<ModelInfo> {
    vec![
        // ---- HF backend (static) ----
        ModelInfo {
            model_id: "laion/clap-htsat-unfused".to_string(),
            label: "CLAP (HTSAT, unfused)".to_string(),
            kind: "embedding".to_string(),
            size_estimate_mb: 620,
            backend: BACKEND_HF.to_string(),
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "laion/clap-htsat-fused".to_string(),
            label: "CLAP (HTSAT, fused)".to_string(),
            kind: "embedding".to_string(),
            size_estimate_mb: 1300,
            backend: BACKEND_HF.to_string(),
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "openai/whisper-tiny".to_string(),
            label: "Whisper tiny".to_string(),
            kind: "transcription".to_string(),
            size_estimate_mb: 75,
            backend: BACKEND_HF.to_string(),
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "openai/whisper-base".to_string(),
            label: "Whisper base".to_string(),
            kind: "transcription".to_string(),
            size_estimate_mb: 145,
            backend: BACKEND_HF.to_string(),
            download_strategy: "hf".to_string(),
        },
        ModelInfo {
            model_id: "facebook/htdemucs".to_string(),
            label: "Demucs (htdemucs)".to_string(),
            kind: "stems".to_string(),
            size_estimate_mb: 300,
            backend: BACKEND_HF.to_string(),
            download_strategy: "lib_managed:demucs".to_string(),
        },
        ModelInfo {
            model_id: "Qwen/Qwen2.5-0.5B-Instruct".to_string(),
            label: "Qwen 2.5 0.5B Instruct".to_string(),
            kind: "llm".to_string(),
            size_estimate_mb: 1000,
            backend: BACKEND_HF.to_string(),
            download_strategy: "hf".to_string(),
        },
        // ---- Foundation backend (synthetic) ----
        ModelInfo {
            model_id: "apple/foundation-models".to_string(),
            label: "System default".to_string(),
            kind: "llm".to_string(),
            size_estimate_mb: 0,
            backend: BACKEND_FOUNDATION.to_string(),
            download_strategy: "system".to_string(),
        },
        // Note: Ollama models are dynamic — discovered from `ollama list` and
        // synthesized at status-fetch time. Not registered here.
    ]
}

fn registered_features() -> Vec<FeatureInfo> {
    vec![
        FeatureInfo {
            feature_id: "embedding_similarity".to_string(),
            label: "Embedding similarity".to_string(),
            description: "CLAP embeddings for semantic search and similarity browse".to_string(),
            kind: "embedding".to_string(),
            backends: vec![BACKEND_HF.to_string()],
            default_backend: BACKEND_HF.to_string(),
            default_model_id: "laion/clap-htsat-unfused".to_string(),
            required_extras: vec!["embedding".to_string()],
        },
        FeatureInfo {
            feature_id: "auto_naming".to_string(),
            label: "Auto-naming (vocal transcription)".to_string(),
            description: "Whisper transcribes vocal samples to derive filenames".to_string(),
            kind: "transcription".to_string(),
            backends: vec![BACKEND_HF.to_string()],
            default_backend: BACKEND_HF.to_string(),
            default_model_id: "openai/whisper-tiny".to_string(),
            required_extras: vec!["transcription".to_string()],
        },
        FeatureInfo {
            feature_id: "stem_separation".to_string(),
            label: "Stem separation".to_string(),
            description: "Demucs splits clips into drums/bass/vocals/other".to_string(),
            kind: "stems".to_string(),
            backends: vec![BACKEND_HF.to_string()],
            default_backend: BACKEND_HF.to_string(),
            default_model_id: "facebook/htdemucs".to_string(),
            required_extras: vec!["stems".to_string()],
        },
        FeatureInfo {
            feature_id: "llm_naming_refinement".to_string(),
            label: "LLM naming refinement".to_string(),
            description: "Local LLM refines transcript-derived filenames".to_string(),
            kind: "llm".to_string(),
            backends: vec![
                BACKEND_FOUNDATION.to_string(),
                BACKEND_OLLAMA.to_string(),
                BACKEND_HF.to_string(),
            ],
            // Default to ollama for back-compat with existing installs.
            // The migration in ``ensure_defaults`` keeps anyone with a
            // persisted ollama model on ollama.
            default_backend: BACKEND_OLLAMA.to_string(),
            default_model_id: "gemma3:1b".to_string(),
            // Feature-level: empty. Per-backend extras carry the actual
            // requirements (foundation: none, ollama: llm_ollama, hf: llm_hf).
            required_extras: vec![],
        },
    ]
}

// Convenience lookups.

fn find_feature(feature_id: &str) -> Option<FeatureInfo> {
    registered_features()
        .into_iter()
        .find(|f| f.feature_id == feature_id)
}

fn find_static_model(model_id: &str) -> Option<ModelInfo> {
    registered_models()
        .into_iter()
        .find(|m| m.model_id == model_id)
}

// ============ Ollama dynamic-model helpers ============

fn fetch_ollama_status(app_state: &State<'_, AppState>) -> Option<serde_json::Value> {
    rpc(app_state, "get_ollama_status", serde_json::json!({})).ok()
}

fn dynamic_ollama_models(ollama: &serde_json::Value) -> Vec<ModelInfo> {
    let avail = ollama
        .get("available_models")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    avail
        .iter()
        .filter_map(|v| v.as_str())
        .map(|name| ModelInfo {
            model_id: name.to_string(),
            label: name.to_string(),
            kind: "llm".to_string(),
            size_estimate_mb: 0,
            backend: BACKEND_OLLAMA.to_string(),
            download_strategy: "lib_managed:ollama".to_string(),
        })
        .collect()
}

/// Translate ollama's snapshot to the same shape as ``ml_list_model_states``.
/// Distinguishes daemon-unreachable from daemon-up-with-no-models-pulled.
fn ollama_model_state(model_id: &str, ollama: &serde_json::Value) -> serde_json::Value {
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

    let downloaded = avail_names.iter().any(|n| n == model_id);
    let is_active = active_model == model_id;
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

/// Probe ollama daemon availability — returns ``(available, reason_if_not)``.
fn probe_ollama_availability(ollama: Option<&serde_json::Value>) -> (bool, Option<String>) {
    match ollama {
        Some(o) => {
            let raw_error = o.get("error").and_then(|v| v.as_str());
            let avail_count = o
                .get("available_models")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            if let Some(err) = raw_error {
                if avail_count == 0 {
                    return (
                        false,
                        Some(format!(
                            "Ollama daemon unreachable — install via `brew install ollama` and run `ollama serve` ({err})"
                        )),
                    );
                }
            }
            (true, None)
        }
        None => (
            false,
            Some(
                "Ollama daemon unreachable — install via `brew install ollama` and run `ollama serve`"
                    .to_string(),
            ),
        ),
    }
}

/// Probe Apple Foundation Models availability via the Swift bridge.
fn probe_foundation_availability() -> (bool, Option<String>) {
    let available = crate::foundation_models::available();
    let reason = if available {
        None
    } else {
        crate::foundation_models::unavailable_reason()
    };
    (available, reason)
}

// ============ Config persistence ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeatureState {
    pub enabled: bool,
    /// Selected backend for this feature. Filled in by migration if missing.
    #[serde(default)]
    pub backend: String,
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
            let entry = self.features.entry(f.feature_id.clone()).or_insert_with(|| {
                FeatureState {
                    enabled: false,
                    backend: f.default_backend.clone(),
                    model_id: f.default_model_id.clone(),
                }
            });

            // Migration: legacy ``ollama:gemma3:1b`` model_id with empty backend.
            // Strip the prefix and set backend = ollama.
            if entry.backend.is_empty() {
                if let Some(rest) = entry.model_id.strip_prefix("ollama:") {
                    entry.backend = BACKEND_OLLAMA.to_string();
                    entry.model_id = rest.to_string();
                } else {
                    // Pre-backend non-LLM feature, or LLM with non-prefixed id.
                    // Use feature's default_backend.
                    entry.backend = f.default_backend.clone();
                }
            }

            // Backend-scoped sanity: if the backend isn't allowed for this
            // feature, fall back to the default.
            if !f.backends.contains(&entry.backend) {
                entry.backend = f.default_backend.clone();
                entry.model_id = f.default_model_id.clone();
            }
        }
    }
}

pub struct MlConfigState {
    inner: Mutex<MlConfig>,
    path: PathBuf,
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

/// Compose status from all sources: HF / lib_managed:demucs from the
/// sidecar's tracker, ``ollama:*`` from ``get_ollama_status``, foundation
/// from the availability probe.
///
/// The LLM dropdown for the active backend always contains at least the
/// persisted/default model so the UI never shows an empty selector.
fn fetch_full_status(
    config: &MlConfig,
    app_state: &State<'_, AppState>,
) -> MlStatus {
    // Static (HF + foundation) state from sidecar.
    let static_models = registered_models();
    let hf_ids: Vec<String> = static_models
        .iter()
        .filter(|m| m.backend == BACKEND_HF)
        .map(|m| m.model_id.clone())
        .collect();
    let mut states = fetch_model_states(app_state, &hf_ids).unwrap_or_default();

    // Foundation state: synthesized from probe (Slice 1: always not_available).
    let (fm_available, fm_reason) = probe_foundation_availability();
    for m in static_models.iter().filter(|m| m.backend == BACKEND_FOUNDATION) {
        let state = if fm_available { "loaded" } else { "not_available" };
        states.insert(
            m.model_id.clone(),
            serde_json::json!({
                "model_id": m.model_id,
                "state": state,
                "downloaded": fm_available,
                "loaded": fm_available,
                "disk_bytes": 0,
                "error": if fm_available { None } else { fm_reason.clone() },
            }),
        );
    }

    // Ollama state: dynamic models + states.
    let ollama_opt = fetch_ollama_status(app_state);
    let mut all_models = static_models;
    let mut ollama_extras: Vec<ModelInfo> = match &ollama_opt {
        Some(o) => dynamic_ollama_models(o),
        None => vec![],
    };
    if let Some(ollama) = &ollama_opt {
        for m in &ollama_extras {
            states.insert(m.model_id.clone(), ollama_model_state(&m.model_id, ollama));
        }
    }

    // Always include persisted + default ollama model so the dropdown has
    // an entry even when the daemon is down.
    if let Some(llm_state) = config.features.get("llm_naming_refinement") {
        if llm_state.backend == BACKEND_OLLAMA {
            let candidate = &llm_state.model_id;
            if !candidate.is_empty()
                && !ollama_extras.iter().any(|m| &m.model_id == candidate)
            {
                ollama_extras.push(ModelInfo {
                    model_id: candidate.clone(),
                    label: candidate.clone(),
                    kind: "llm".to_string(),
                    size_estimate_mb: 0,
                    backend: BACKEND_OLLAMA.to_string(),
                    download_strategy: "lib_managed:ollama".to_string(),
                });
                let synthetic = match &ollama_opt {
                    Some(o) => ollama_model_state(candidate, o),
                    None => serde_json::json!({
                        "model_id": candidate,
                        "state": "error",
                        "downloaded": false,
                        "loaded": false,
                        "disk_bytes": 0,
                        "error": "ollama daemon unreachable — install via `brew install ollama` and run `ollama serve`",
                    }),
                };
                states.insert(candidate.clone(), synthetic);
            }
        }
    }
    all_models.extend(ollama_extras);

    // Backend availability list.
    let (ollama_avail, ollama_reason) = probe_ollama_availability(ollama_opt.as_ref());
    let backends: Vec<MlBackendView> = registered_backends()
        .into_iter()
        .map(|b| {
            let (available, unavailable_reason) = match b.backend_id.as_str() {
                BACKEND_FOUNDATION => probe_foundation_availability(),
                BACKEND_OLLAMA => (ollama_avail, ollama_reason.clone()),
                BACKEND_HF => (true, None),
                _ => (false, Some("Unknown backend".to_string())),
            };
            MlBackendView {
                info: b,
                available,
                unavailable_reason,
            }
        })
        .collect();

    build_status(config, &states, all_models, backends)
}

// ============ Public response shapes ============

#[derive(Debug, Serialize)]
pub struct MlStatus {
    pub features: Vec<MlFeatureView>,
    pub models: Vec<MlModelView>,
    pub backends: Vec<MlBackendView>,
}

#[derive(Debug, Serialize)]
pub struct MlFeatureView {
    #[serde(flatten)]
    pub info: FeatureInfo,
    pub enabled: bool,
    pub backend: String,
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

#[derive(Debug, Serialize)]
pub struct MlBackendView {
    #[serde(flatten)]
    pub info: BackendInfo,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

fn build_status(
    config: &MlConfig,
    sidecar_states: &HashMap<String, serde_json::Value>,
    all_models: Vec<ModelInfo>,
    backends: Vec<MlBackendView>,
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
                    backend: info.default_backend.clone(),
                    model_id: info.default_model_id.clone(),
                });
            MlFeatureView {
                info,
                enabled: state.enabled,
                backend: state.backend,
                model_id: state.model_id,
            }
        })
        .collect();

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

    MlStatus {
        features,
        models,
        backends,
    }
}

// ============ Tauri commands ============

#[tauri::command]
pub fn ml_get_status(
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let config = cfg.snapshot()?;
    let snapshot = fetch_full_status(&config, &app_state);

    // Auto-load any enabled HF feature whose model is downloaded but not
    // yet loaded. Foundation / ollama backends manage their own warmup,
    // so this only fires for HF. Idempotent on the sidecar side
    // (``models.load_model`` returns the current state when already
    // loading or loaded), so it's safe to fire on every status call —
    // catches the post-toggle download-completed case in addition to
    // app-startup. The autoload_done flag is retained so first-startup
    // still reliably re-fetches once.
    let mut kicked = false;
    let mut already_kicked: std::collections::HashSet<String> = Default::default();
    for feat in &snapshot.features {
        if !feat.enabled {
            continue;
        }
        if feat.backend != BACKEND_HF {
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
                kicked = true;
            }
        }
    }
    cfg.autoload_done.store(true, Ordering::SeqCst);

    if kicked {
        // Re-fetch so the response reflects the "loading" we just kicked off.
        return Ok(fetch_full_status(&config, &app_state));
    }

    Ok(snapshot)
}

/// Trigger a load for ``(backend, model_id)``. Foundation: no-op (OS).
/// Ollama: warmup via ``set_ollama_model``. HF: standard ``ml_load_model``.
fn dispatch_load(app_state: &State<'_, AppState>, backend: &str, model_id: &str) {
    match backend {
        BACKEND_FOUNDATION => { /* OS-managed, no-op */ }
        BACKEND_OLLAMA => {
            let _ = rpc(
                app_state,
                "set_ollama_model",
                serde_json::json!({ "model": model_id }),
            );
        }
        BACKEND_HF => {
            let _ = rpc(
                app_state,
                "ml_load_model",
                serde_json::json!({ "model_id": model_id }),
            );
        }
        _ => {}
    }
}

/// Trigger an unload. Foundation/ollama: no-op (externally managed).
fn dispatch_unload(app_state: &State<'_, AppState>, backend: &str, model_id: &str) {
    if backend == BACKEND_HF {
        let _ = rpc(
            app_state,
            "ml_unload_model",
            serde_json::json!({ "model_id": model_id }),
        );
    }
}

#[tauri::command]
pub fn ml_set_feature_enabled(
    feature_id: String,
    enabled: bool,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let info = find_feature(&feature_id)
        .ok_or_else(|| format!("Unknown feature: {feature_id}"))?;

    let prev = cfg.snapshot()?;
    let prev_state = prev
        .features
        .get(&feature_id)
        .cloned()
        .unwrap_or_else(|| FeatureState {
            enabled: false,
            backend: info.default_backend.clone(),
            model_id: info.default_model_id.clone(),
        });

    let updated = cfg.update(|c| {
        let entry = c
            .features
            .entry(feature_id.clone())
            .or_insert_with(|| FeatureState {
                enabled: false,
                backend: info.default_backend.clone(),
                model_id: info.default_model_id.clone(),
            });
        entry.enabled = enabled;
    })?;

    if enabled {
        dispatch_load(&app_state, &prev_state.backend, &prev_state.model_id);
    } else {
        // Unload only if no other enabled feature uses the same (backend, model_id).
        let still_referenced = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id
                && fs.enabled
                && fs.backend == prev_state.backend
                && fs.model_id == prev_state.model_id
        });
        if !still_referenced {
            dispatch_unload(&app_state, &prev_state.backend, &prev_state.model_id);
        }
    }

    Ok(fetch_full_status(&updated, &app_state))
}

#[tauri::command]
pub fn ml_set_feature_backend(
    feature_id: String,
    backend: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let info = find_feature(&feature_id)
        .ok_or_else(|| format!("Unknown feature: {feature_id}"))?;

    if !info.backends.contains(&backend) {
        return Err(format!(
            "Backend {backend} is not allowed for feature {feature_id}"
        ));
    }

    let prev = cfg.snapshot()?;
    let prev_state = prev
        .features
        .get(&feature_id)
        .cloned()
        .unwrap_or_else(|| FeatureState {
            enabled: false,
            backend: info.default_backend.clone(),
            model_id: info.default_model_id.clone(),
        });

    if prev_state.backend == backend {
        return Ok(fetch_full_status(&prev, &app_state));
    }

    // Pick a sensible default model for the new backend. Strategy:
    //   1. If a model_id is already persisted under this (feature, backend)
    //      historically, we'd use it — but we don't track per-backend
    //      history yet. v1: fall through to (2).
    //   2. First model in the registry whose backend matches and kind == feature.kind.
    //   3. If none, blank — UI will surface a "no models" hint.
    let candidate_model = registered_models()
        .into_iter()
        .find(|m| m.backend == backend && m.kind == info.kind)
        .map(|m| m.model_id);
    let new_model_id = candidate_model.unwrap_or_default();

    let updated = cfg.update(|c| {
        let entry = c
            .features
            .entry(feature_id.clone())
            .or_insert_with(|| FeatureState {
                enabled: false,
                backend: backend.clone(),
                model_id: new_model_id.clone(),
            });
        entry.backend = backend.clone();
        entry.model_id = new_model_id.clone();
    })?;

    // If the feature was enabled, swap the underlying model: unload previous,
    // load new. Reference counting means we only unload if no one else uses it.
    if prev_state.enabled {
        let prev_still = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id
                && fs.enabled
                && fs.backend == prev_state.backend
                && fs.model_id == prev_state.model_id
        });
        if !prev_still {
            dispatch_unload(&app_state, &prev_state.backend, &prev_state.model_id);
        }
        if !new_model_id.is_empty() {
            dispatch_load(&app_state, &backend, &new_model_id);
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
    let info = find_feature(&feature_id)
        .ok_or_else(|| format!("Unknown feature: {feature_id}"))?;

    let prev = cfg.snapshot()?;
    let prev_state = prev
        .features
        .get(&feature_id)
        .cloned()
        .unwrap_or_else(|| FeatureState {
            enabled: false,
            backend: info.default_backend.clone(),
            model_id: info.default_model_id.clone(),
        });

    // Validate: the target model must exist within the feature's selected
    // backend (or be a discovered ollama model when backend == ollama).
    match prev_state.backend.as_str() {
        BACKEND_OLLAMA => {
            // Trust the caller — ollama models are dynamic; we don't have
            // a static registry to validate against. Kind is implicitly llm.
            if info.kind != "llm" {
                return Err(format!(
                    "Ollama models can only be assigned to llm-kind features (feature {feature_id} is kind={})",
                    info.kind
                ));
            }
        }
        BACKEND_FOUNDATION | BACKEND_HF => {
            let target = find_static_model(&model_id)
                .ok_or_else(|| format!("Unknown model: {model_id}"))?;
            if target.backend != prev_state.backend {
                return Err(format!(
                    "Model {} belongs to backend {} but feature {} is using backend {}",
                    model_id, target.backend, feature_id, prev_state.backend
                ));
            }
            if target.kind != info.kind {
                return Err(format!(
                    "Model {} (kind={}) is not compatible with feature {} (kind={})",
                    model_id, target.kind, feature_id, info.kind
                ));
            }
        }
        _ => {
            return Err(format!("Unknown backend: {}", prev_state.backend));
        }
    }

    let updated = cfg.update(|c| {
        let entry = c.features.entry(feature_id.clone()).or_default();
        entry.model_id = model_id.clone();
    })?;

    if prev_state.enabled && prev_state.model_id != model_id {
        let prev_still = updated.features.iter().any(|(fid, fs)| {
            fid != &feature_id
                && fs.enabled
                && fs.backend == prev_state.backend
                && fs.model_id == prev_state.model_id
        });
        if !prev_still {
            dispatch_unload(&app_state, &prev_state.backend, &prev_state.model_id);
        }
        dispatch_load(&app_state, &prev_state.backend, &model_id);
    }

    Ok(fetch_full_status(&updated, &app_state))
}

/// Look up the backend a model_id belongs to. For ollama models (which are
/// dynamic and not in the static registry), returns ``Some(BACKEND_OLLAMA)``
/// only if the model_id is the persisted/active LLM model and that feature
/// is on ollama backend — otherwise returns ``None`` (caller must default).
fn backend_for_model(model_id: &str, config: &MlConfig) -> Option<String> {
    if let Some(m) = find_static_model(model_id) {
        return Some(m.backend);
    }
    // Possibly an ollama model. Check the LLM feature config.
    if let Some(llm_state) = config.features.get("llm_naming_refinement") {
        if llm_state.backend == BACKEND_OLLAMA && llm_state.model_id == model_id {
            return Some(BACKEND_OLLAMA.to_string());
        }
    }
    // Fallback: assume ollama (it's the only backend with dynamic models today).
    Some(BACKEND_OLLAMA.to_string())
}

#[tauri::command]
pub fn ml_download_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = cfg.snapshot()?;
    let backend = backend_for_model(&model_id, &config)
        .unwrap_or_else(|| BACKEND_HF.to_string());
    match backend.as_str() {
        BACKEND_OLLAMA => Err(format!(
            "Ollama models are managed by the daemon. Pull from a terminal: `ollama pull {model_id}`"
        )),
        BACKEND_FOUNDATION => Err(
            "Foundation Models is provided by the operating system — no download needed."
                .to_string(),
        ),
        _ => rpc(
            &app_state,
            "ml_download_model",
            serde_json::json!({ "model_id": model_id }),
        ),
    }
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
    let config = cfg.snapshot()?;

    // Refuse if any enabled feature depends on this model.
    let referenced = config
        .features
        .iter()
        .any(|(_, fs)| fs.enabled && fs.model_id == model_id);
    if referenced {
        return Err(format!(
            "Model {model_id} is in use by an enabled feature. Disable the feature or pick a different model first."
        ));
    }

    let backend = backend_for_model(&model_id, &config)
        .unwrap_or_else(|| BACKEND_HF.to_string());
    match backend.as_str() {
        BACKEND_OLLAMA => Err(format!(
            "Ollama models are managed by the daemon. Remove from a terminal: `ollama rm {model_id}`"
        )),
        BACKEND_FOUNDATION => Err(
            "Foundation Models is provided by the operating system — nothing to remove.".to_string(),
        ),
        _ => rpc(
            &app_state,
            "ml_remove_model",
            serde_json::json!({ "model_id": model_id }),
        ),
    }
}

#[tauri::command]
pub fn ml_load_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = cfg.snapshot()?;
    let backend = backend_for_model(&model_id, &config)
        .unwrap_or_else(|| BACKEND_HF.to_string());
    match backend.as_str() {
        BACKEND_OLLAMA => rpc(
            &app_state,
            "set_ollama_model",
            serde_json::json!({ "model": model_id }),
        ),
        BACKEND_FOUNDATION => Ok(serde_json::json!({ "noop": true })),
        _ => rpc(
            &app_state,
            "ml_load_model",
            serde_json::json!({ "model_id": model_id }),
        ),
    }
}

#[tauri::command]
pub fn ml_unload_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = cfg.snapshot()?;
    let backend = backend_for_model(&model_id, &config)
        .unwrap_or_else(|| BACKEND_HF.to_string());
    if backend != BACKEND_HF {
        return Ok(serde_json::json!({ "noop": true }));
    }
    rpc(
        &app_state,
        "ml_unload_model",
        serde_json::json!({ "model_id": model_id }),
    )
}

/// Reload a model: unload + load. Doesn't touch ``enabled``. For ollama,
/// re-runs warmup via ``set_ollama_model``. For foundation, no-op.
#[tauri::command]
pub fn ml_reload_model(
    model_id: String,
    cfg: State<'_, MlConfigState>,
    app_state: State<'_, AppState>,
) -> Result<MlStatus, String> {
    let config = cfg.snapshot()?;
    let backend = backend_for_model(&model_id, &config)
        .unwrap_or_else(|| BACKEND_HF.to_string());
    dispatch_unload(&app_state, &backend, &model_id);
    dispatch_load(&app_state, &backend, &model_id);
    Ok(fetch_full_status(&config, &app_state))
}

// ============ Runtime ML deps detection (vault-347l) ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraStatus {
    pub installed: bool,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepsStatus {
    pub extras: HashMap<String, ExtraStatus>,
}

/// Report which sidecar ML extras (transformers/torch/faster-whisper/demucs/
/// ollama/accelerate) are installed in the running sidecar's interpreter.
/// Phase 1: read-only — Settings UI uses this to grey feature toggles whose
/// deps are missing. Phase 2 (separate task) wires actual install via a
/// uv-managed runtime venv.
#[tauri::command]
pub fn deps_get_status(app_state: State<'_, AppState>) -> Result<DepsStatus, String> {
    let raw = rpc(&app_state, "deps_status", serde_json::json!({}))?;
    serde_json::from_value(raw).map_err(|e| format!("deps_status decode failed: {e}"))
}
