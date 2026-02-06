import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { getNativeQuality, getNativeAudioInfo } from "../hooks/useNativeAnalysis";
import type { SearchStats } from "../api/types";

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [watchDirs, setWatchDirs] = useState<string[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

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
      const { open } = await import("@tauri-apps/api/dialog");
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

  const handleTestAnalysis = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { open } = await import("@tauri-apps/api/dialog");
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
        </div>
      </div>
    </div>
  );
}

export default SettingsDialog;
