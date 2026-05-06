import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getNativeQuality, getNativeAudioInfo } from "../hooks/useNativeAnalysis";
import { RANKED_MODELS, type OllamaStatusDict } from "../types/ollama";
import type { SearchStats } from "../api/types";

import type { OrphanedRecording } from "./OrphanedRecordingsDialog";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "../store/updaterStore";
import { api, type AppVersions } from "../api/client";

interface SettingsDialogProps {
  onClose: () => void;
  llmStatus: OllamaStatusDict;
  onRefreshLlm: () => Promise<void>;
  onSetLlmModel: (model: string | null) => Promise<void>;
  onShowOrphans: (orphans: OrphanedRecording[]) => void;
}

export function SettingsDialog({ onClose, llmStatus, onRefreshLlm, onSetLlmModel, onShowOrphans }: SettingsDialogProps) {
  const [watchDirs, setWatchDirs] = useState<string[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [llmRefreshing, setLlmRefreshing] = useState(false);
  const [llmSetError, setLlmSetError] = useState<string | null>(null);
  const [orphanScanning, setOrphanScanning] = useState(false);
  const [orphanScanResult, setOrphanScanResult] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterNewVersion = useUpdaterStore((s) => s.newVersion);
  const updaterLastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const updaterError = useUpdaterStore((s) => s.error);
  const updaterCheck = useUpdaterStore((s) => s.check);
  const updaterInstall = useUpdaterStore((s) => s.install);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
    setVersionsLoading(true);
    api
      .getAppVersions()
      .then(setVersions)
      .catch((err) => console.warn("getAppVersions failed:", err))
      .finally(() => setVersionsLoading(false));
  }, []);

  const refreshVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      setVersions(await api.getAppVersions());
    } catch (err) {
      console.warn("getAppVersions refresh failed:", err);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  // Load watch directories and stats on mount
  useEffect(() => {
    invoke<string[]>("watch_list_directories")
      .then(setWatchDirs)
      .catch((err) => console.error("Failed to load watch dirs:", err));

    invoke<SearchStats>("get_search_stats")
      .then(setStats)
      .catch((err) => console.error("Failed to load stats:", err));
  }, []);

  const handleAddWatchDir = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await invoke("watch_add_directory", { path: selected });
        setWatchDirs((prev) => [...prev, selected]);
      }
    } catch (err) {
      console.error("Failed to add watch directory:", err);
    }
  }, []);

  const handleRemoveWatchDir = useCallback(async (path: string) => {
    try {
      await invoke("watch_remove_directory", { path });
      setWatchDirs((prev) => prev.filter((d) => d !== path));
    } catch (err) {
      console.error("Failed to remove watch directory:", err);
    }
  }, []);

  const handleScanOrphans = useCallback(async () => {
    setOrphanScanning(true);
    setOrphanScanResult(null);
    try {
      const results = await invoke<OrphanedRecording[]>("scan_orphaned_recordings");
      if (results.length === 0) {
        setOrphanScanResult("No orphaned recordings found.");
      } else {
        onClose();
        onShowOrphans(results);
      }
    } catch (err) {
      setOrphanScanResult(`Error: ${err}`);
    } finally {
      setOrphanScanning(false);
    }
  }, [onClose, onShowOrphans]);

  const handleTestAnalysis = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "aif", "aiff", "flac", "mp3", "ogg"] }],
      });
      if (selected && typeof selected === "string") {
        const startTime = performance.now();
        const [info, quality] = await Promise.all([
          getNativeAudioInfo(selected),
          getNativeQuality(selected),
        ]);
        const elapsed = performance.now() - startTime;
        setTestResult(
          `${selected.split("/").pop()}\n` +
          `Duration: ${info.duration_sec.toFixed(2)}s | ${info.sample_rate}Hz | ${info.channels}ch\n` +
          `RMS: ${quality.rms_db.toFixed(1)}dB | Peak: ${quality.peak_db.toFixed(1)}dB | Crest: ${quality.crest_factor.toFixed(1)}dB\n` +
          `Analysis time: ${elapsed.toFixed(0)}ms`
        );
      }
    } catch (err) {
      setTestResult(`Error: ${err}`);
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-raised border border-surface-border rounded-lg w-[500px] max-h-[80vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Watch Directories */}
          <section>
            <h3 className="text-sm font-medium mb-3">Watch Directories</h3>
            <div className="space-y-2">
              {watchDirs.length === 0 ? (
                <p className="text-xs text-gray-500">No directories being watched</p>
              ) : (
                watchDirs.map((dir) => (
                  <div key={dir} className="flex items-center justify-between bg-surface rounded px-3 py-2 text-sm">
                    <span className="truncate flex-1 mr-2" title={dir}>{dir}</span>
                    <button
                      onClick={() => handleRemoveWatchDir(dir)}
                      className="text-red-400 hover:text-red-300 text-xs shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
              <button
                onClick={handleAddWatchDir}
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover rounded text-sm transition-colors"
              >
                Add Directory
              </button>
            </div>
          </section>

          {/* Analysis Test */}
          <section>
            <h3 className="text-sm font-medium mb-3">Analysis</h3>
            <button
              onClick={handleTestAnalysis}
              disabled={testing}
              className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors disabled:opacity-50"
            >
              {testing ? "Analyzing..." : "Test Analysis on File"}
            </button>
            {testResult && (
              <pre className="mt-2 text-xs text-gray-400 bg-surface rounded p-3 whitespace-pre-wrap">{testResult}</pre>
            )}
          </section>

          {/* LLM Vocal Naming */}
          <section>
            <h3 className="text-sm font-medium mb-3">LLM Vocal Naming</h3>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex justify-between items-center">
                <span>Status</span>
                <span className={
                  llmStatus.state === "loaded" ? "text-green-400" :
                  llmStatus.state === "loading" ? "text-yellow-400" :
                  llmStatus.state === "errored" ? "text-red-400" : "text-gray-500"
                }>
                  {llmStatus.state === "loaded" ? `Ready (${llmStatus.model})` :
                   llmStatus.state === "loading" ? "Loading…" :
                   llmStatus.state === "errored" ? `Error: ${llmStatus.error ?? "unknown"}` :
                   "Not loaded"}
                </span>
              </div>
              {llmStatus.available_models.length > 0 && (
                <div className="flex justify-between items-center gap-3">
                  <span className="shrink-0">Model</span>
                  <select
                    value={llmStatus.model ?? ""}
                    onChange={async (e) => {
                      setLlmSetError(null);
                      try {
                        await onSetLlmModel(e.target.value || null);
                      } catch (err) {
                        setLlmSetError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                    className="bg-surface border border-surface-border rounded px-2 py-1 text-xs text-gray-300 flex-1 min-w-0"
                  >
                    {RANKED_MODELS.filter((m) => llmStatus.available_models.includes(m)).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {llmStatus.available_models
                      .filter((m) => !(RANKED_MODELS as readonly string[]).includes(m))
                      .map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                  </select>
                </div>
              )}
              {llmSetError && (
                <p className="text-xs text-red-400">{llmSetError}</p>
              )}
              <button
                onClick={async () => {
                  setLlmRefreshing(true);
                  try { await onRefreshLlm(); } finally { setLlmRefreshing(false); }
                }}
                disabled={llmRefreshing}
                className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors disabled:opacity-50"
              >
                {llmRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </section>

          {/* Recordings */}
          <section>
            <h3 className="text-sm font-medium mb-3">Recordings</h3>
            <button
              onClick={handleScanOrphans}
              disabled={orphanScanning}
              className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors disabled:opacity-50"
            >
              {orphanScanning ? "Scanning…" : "Scan for orphaned recordings"}
            </button>
            {orphanScanResult && (
              <p className="mt-2 text-xs text-gray-400">{orphanScanResult}</p>
            )}
          </section>

          {/* Library Info */}
          <section>
            <h3 className="text-sm font-medium mb-3">Library Info</h3>
            {stats ? (
              <div className="space-y-1 text-sm text-gray-400">
                <div className="flex justify-between">
                  <span>Total Samples</span>
                  <span className="text-gray-300">{stats.total_samples.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Embeddings</span>
                  <span className="text-gray-300">{stats.total_embeddings.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Index Loaded</span>
                  <span className="text-gray-300">{stats.index_loaded ? "Yes" : "No"}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Loading...</p>
            )}
          </section>

          {/* Updates */}
          <section>
            <h3 className="text-sm font-medium mb-3">Updates</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Current version</span>
                <span className="text-gray-300 tabular-nums">
                  {appVersion ? `v${appVersion}` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Last checked</span>
                <span className="text-gray-300">
                  {formatLastChecked(updaterLastCheckedAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void updaterCheck()}
                  disabled={updaterStatus === "checking" || updaterStatus === "installing"}
                  className="px-3 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-surface-border rounded transition-colors disabled:opacity-50"
                  data-testid="settings-check-updates"
                >
                  {updaterStatus === "checking" ? "Checking…" : "Check for Updates"}
                </button>
                {updaterStatus === "available" && (
                  <button
                    type="button"
                    onClick={() => void updaterInstall()}
                    className="px-3 py-1.5 text-xs bg-accent/30 hover:bg-accent/50 text-accent border border-accent rounded font-medium transition-colors"
                    data-testid="settings-install-update"
                  >
                    Install v{updaterNewVersion} &amp; Restart
                  </button>
                )}
                {updaterStatus === "installing" && (
                  <span className="text-xs text-gray-400">
                    Installing… app will restart.
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500" data-testid="settings-update-status">
                {updaterStatusMessage(updaterStatus, updaterNewVersion, updaterError)}
              </p>
            </div>
          </section>

          {/* About */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">About</h3>
              <button
                type="button"
                onClick={() => void refreshVersions()}
                disabled={versionsLoading}
                className="text-[10px] px-2 py-0.5 bg-surface hover:bg-surface-hover border border-surface-border rounded transition-colors disabled:opacity-50"
                title="Re-query sidecar version (useful after first ML call wakes it)"
              >
                {versionsLoading ? "…" : "↻"}
              </button>
            </div>
            <div className="space-y-1 text-sm">
              <VersionRow label="App" value={versions ? `v${versions.app}` : "—"} />
              <VersionRow label="Tauri" value={versions ? `v${versions.tauri}` : "—"} />
              <VersionRow label="OS / arch" value={versions?.os ?? "—"} mono />
              {versions?.sidecar ? (
                <>
                  <VersionRow
                    label="Sidecar"
                    value={`v${versions.sidecar.package_version}${versions.sidecar.is_frozen ? " (bundled)" : " (dev)"}`}
                  />
                  <VersionRow
                    label="Python"
                    value={`${versions.sidecar.python_implementation} ${versions.sidecar.python_version}`}
                  />
                </>
              ) : (
                <VersionRow
                  label="Sidecar"
                  value={versionsLoading ? "Loading…" : "Not started"}
                  hint={
                    !versionsLoading
                      ? "Starts on first ML call (auto-naming, captioning)"
                      : undefined
                  }
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function VersionRow({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <>
      <div className="flex justify-between text-gray-400">
        <span>{label}</span>
        <span
          className={`text-gray-300 ${mono ? "font-mono text-xs" : "tabular-nums"}`}
        >
          {value}
        </span>
      </div>
      {hint && <p className="text-[10px] text-gray-500 -mt-1">{hint}</p>}
    </>
  );
}

function formatLastChecked(ts: number | null): string {
  if (!ts) return "never";
  const ageMs = Date.now() - ts;
  if (ageMs < 60_000) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function updaterStatusMessage(
  status: ReturnType<typeof useUpdaterStore.getState>["status"],
  newVersion: string | null,
  error: string | null,
): string {
  switch (status) {
    case "idle":
      return "";
    case "checking":
      return "Contacting update server…";
    case "up_to_date":
      return "You're on the latest version.";
    case "available":
      return `Update available: v${newVersion ?? "?"}.`;
    case "installing":
      return "Downloading + verifying signature, then app will restart.";
    case "error":
      return `Update check failed: ${error ?? "unknown error"}`;
  }
}

export default SettingsDialog;
