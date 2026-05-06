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
}

export interface MlStatus {
  features: MlFeatureView[];
  models: MlModelView[];
  backends: MlBackendView[];
}

interface MlFeaturesState {
  status: MlStatus | null;
  loading: boolean;
  error: string | null;
  pollHandle: ReturnType<typeof setTimeout> | null;

  refresh: () => Promise<void>;
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
