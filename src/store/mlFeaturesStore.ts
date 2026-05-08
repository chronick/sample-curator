/**
 * ML features store. Manages feature toggles + model lifecycle (download,
 * load, unload, remove) by proxying through the `ml_*` Tauri commands.
 *
 * Three-layer mental model (vault-3ume):
 *
 * - **Backends** (foundation / ollama / hf) — execution providers, each
 *   with its own model list and availability state.
 * - **Models** — owned by a backend. HF models are static; ollama models
 *   are dynamic; foundation has a synthetic system-default.
 * - **Features** — multi-backend or single-backend. The LLM feature
 *   exposes all three; everything else is HF-only and the UI hides
 *   the backend selector.
 *
 * Polls while any model is in a transient state (`downloading`,
 * `loading`) so progress reflects on the UI without push events.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type ModelState =
  | "not_downloaded"
  | "downloading"
  | "downloaded_not_loaded"
  | "loading"
  | "loaded"
  | "update_available"
  | "error"
  | "not_available";

export interface MlFeatureView {
  feature_id: string;
  label: string;
  description: string;
  kind: string;
  backends: string[];
  default_backend: string;
  default_model_id: string;
  enabled: boolean;
  backend: string;
  model_id: string;
  /** Sidecar extras the feature itself depends on, regardless of backend
   * (vault-347l). Per-backend extras live on `MlBackendView`. */
  required_extras: string[];
}

export interface MlModelView {
  model_id: string;
  label: string;
  kind: string;
  size_estimate_mb: number;
  /** Backend that owns this model — "foundation" | "ollama" | "hf". */
  backend: string;
  /**
   * `hf` (default), `lib_managed:<lib>`, `lib_managed:ollama`, or `system`
   * (OS-provided, no download). Drives "via X library" hint.
   */
  download_strategy: string;
  state: ModelState;
  downloaded: boolean;
  loaded: boolean;
  disk_bytes: number;
  error: string | null;
}

export interface MlBackendView {
  backend_id: string;
  label: string;
  description: string;
  available: boolean;
  unavailable_reason: string | null;
  /** Sidecar extras this backend depends on (vault-347l). */
  required_extras: string[];
}

export interface MlStatus {
  features: MlFeatureView[];
  models: MlModelView[];
  backends: MlBackendView[];
}

/** Per-extra install state from the sidecar's `deps_status` RPC (vault-347l). */
export interface ExtraStatus {
  installed: boolean;
  missing: string[];
}

export interface DepsStatus {
  extras: Record<string, ExtraStatus>;
}

/** Compute which of a (feature, backend) pair's required extras are
 * missing. Returns an empty array when deps haven't loaded yet so we
 * fail open during the brief mount window — Phase 1 keeps current
 * behavior intact rather than greying every toggle on first paint. */
export function missingExtrasForFeature(
  feature: Pick<MlFeatureView, "required_extras" | "backend" | "kind">,
  backends: MlBackendView[],
  deps: DepsStatus | null,
): string[] {
  if (!deps || !deps.extras) return [];
  const required = new Set<string>(feature.required_extras ?? []);
  // Backend `required_extras` describe the substrate an LLM execution
  // provider needs (llm_hf for HF inference, llm_ollama for the daemon
  // client). Non-LLM features set `backend = "hf"` purely because they
  // share the HF Hub model-loading path, but their actual substrate is
  // declared on the feature (embedding/transcription/stems). Only fold
  // backend extras in when the feature is the LLM one — otherwise we
  // surface a false-positive "Missing: llm_hf" on every HF feature.
  if (feature.kind === "llm") {
    const backend = backends.find((b) => b.backend_id === feature.backend);
    for (const e of backend?.required_extras ?? []) required.add(e);
  }
  const missing: string[] = [];
  for (const extra of required) {
    const status = deps.extras[extra];
    if (!status || !status.installed) missing.push(extra);
  }
  return missing;
}

interface MlFeaturesState {
  status: MlStatus | null;
  /** Sidecar ML deps install state (vault-347l). null until first fetch. */
  deps: DepsStatus | null;
  loading: boolean;
  error: string | null;
  pollHandle: ReturnType<typeof setTimeout> | null;

  refresh: () => Promise<void>;
  refreshDeps: () => Promise<void>;
  setFeatureEnabled: (featureId: string, enabled: boolean) => Promise<void>;
  setFeatureBackend: (featureId: string, backend: string) => Promise<void>;
  setFeatureModel: (featureId: string, modelId: string) => Promise<void>;
  download: (modelId: string) => Promise<void>;
  cancel: (modelId: string) => Promise<void>;
  remove: (modelId: string) => Promise<void>;
  reload: (modelId: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

const POLL_MS = 1500;

function isTransient(status: MlStatus | null): boolean {
  if (!status) return false;
  return status.models.some((m) => m.state === "downloading" || m.state === "loading");
}

export const useMlFeaturesStore = create<MlFeaturesState>((set, get) => ({
  status: null,
  deps: null,
  loading: false,
  error: null,
  pollHandle: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const status = await invoke<MlStatus>("ml_get_status");
      set({ status, loading: false });
      if (isTransient(status)) {
        get().startPolling();
      } else {
        get().stopPolling();
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  async refreshDeps() {
    try {
      const deps = await invoke<DepsStatus>("deps_get_status");
      set({ deps });
    } catch (e) {
      // Don't surface deps fetch failures as the global ML error — the
      // existing toggles still work without deps gating; we just lose
      // the greyed-toggle UX. Log to console for diagnosis.
      console.warn("deps_get_status failed", e);
    }
  },

  async setFeatureEnabled(featureId, enabled) {
    set({ error: null });
    try {
      const status = await invoke<MlStatus>("ml_set_feature_enabled", { featureId, enabled });
      set({ status });
      if (isTransient(status)) get().startPolling();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async setFeatureBackend(featureId, backend) {
    set({ error: null });
    try {
      const status = await invoke<MlStatus>("ml_set_feature_backend", { featureId, backend });
      set({ status });
      if (isTransient(status)) get().startPolling();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async setFeatureModel(featureId, modelId) {
    set({ error: null });
    try {
      const status = await invoke<MlStatus>("ml_set_feature_model", { featureId, modelId });
      set({ status });
      if (isTransient(status)) get().startPolling();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async download(modelId) {
    set({ error: null });
    try {
      await invoke("ml_download_model", { modelId });
      await get().refresh();
      get().startPolling();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async cancel(modelId) {
    set({ error: null });
    try {
      await invoke("ml_cancel_download", { modelId });
      await get().refresh();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async remove(modelId) {
    set({ error: null });
    try {
      await invoke("ml_remove_model", { modelId });
      await get().refresh();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async reload(modelId) {
    set({ error: null });
    try {
      const status = await invoke<MlStatus>("ml_reload_model", { modelId });
      set({ status });
      if (isTransient(status)) get().startPolling();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  startPolling() {
    const existing = get().pollHandle;
    if (existing) return;
    const tick = async () => {
      try {
        const status = await invoke<MlStatus>("ml_get_status");
        set({ status });
        if (isTransient(status)) {
          set({ pollHandle: setTimeout(tick, POLL_MS) });
        } else {
          set({ pollHandle: null });
        }
      } catch {
        set({ pollHandle: null });
      }
    };
    set({ pollHandle: setTimeout(tick, POLL_MS) });
  },

  stopPolling() {
    const handle = get().pollHandle;
    if (handle) {
      clearTimeout(handle);
      set({ pollHandle: null });
    }
  },
}));
