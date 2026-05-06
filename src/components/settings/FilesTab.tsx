import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, type AppDataPaths } from "../../api/client";
import type { OrphanedRecording } from "../OrphanedRecordingsDialog";
import { Section, PathRow, Button } from "./shared";

export function FilesTab({
  onClose,
  onShowOrphans,
}: {
  onClose: () => void;
  onShowOrphans: (orphans: OrphanedRecording[]) => void;
}) {
  const [paths, setPaths] = useState<AppDataPaths | null>(null);
  const [watchDirs, setWatchDirs] = useState<string[]>([]);
  const [orphanScanning, setOrphanScanning] = useState(false);
  const [orphanResult, setOrphanResult] = useState<string | null>(null);

  useEffect(() => {
    api.getAppDataPaths().then(setPaths).catch((err) => console.error("getAppDataPaths failed:", err));
    invoke<string[]>("watch_list_directories")
      .then(setWatchDirs)
      .catch((err) => console.error("Failed to load watch dirs:", err));
  }, []);

  const reveal = useCallback((path: string) => {
    void api.revealPath(path).catch((err) => console.error("reveal_path failed:", err));
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
    setOrphanResult(null);
    try {
      const results = await invoke<OrphanedRecording[]>("scan_orphaned_recordings");
      if (results.length === 0) {
        setOrphanResult("No orphaned recordings found.");
      } else {
        onClose();
        onShowOrphans(results);
      }
    } catch (err) {
      setOrphanResult(`Error: ${err}`);
    } finally {
      setOrphanScanning(false);
    }
  }, [onClose, onShowOrphans]);

  return (
    <div className="space-y-6">
      <Section title="App data">
        <div className="space-y-3">
          {paths ? (
            <>
              <PathRow
                label="Library data"
                path={paths.library_data_dir}
                onReveal={() => reveal(paths.library_data_dir)}
                hint="SQLite DB, FAISS index, models, recordings"
              />
              <PathRow
                label="Recordings"
                path={paths.recordings_dir}
                onReveal={() => reveal(paths.recordings_dir)}
                hint="Where the recorder writes WAVs"
              />
              <PathRow
                label="Config"
                path={paths.config_path}
                onReveal={() => reveal(paths.config_path)}
                hint="App configuration (TOML)"
              />
              <PathRow
                label="Models"
                path={paths.models_dir}
                onReveal={() => reveal(paths.models_dir)}
                hint="Downloaded ML weights (created on first download)"
              />
            </>
          ) : (
            <p className="text-xs text-gray-500">Loading…</p>
          )}
        </div>
      </Section>

      <Section
        title="Auto-import directories"
        action={
          <Button onClick={() => void handleAddWatchDir()} testId="files-add-watch">
            Add directory
          </Button>
        }
      >
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500">
            Folders the app monitors for new audio files and ingests automatically.
          </p>
          {watchDirs.length === 0 ? (
            <p className="text-xs text-gray-500">No directories being watched</p>
          ) : (
            watchDirs.map((dir) => (
              <div
                key={dir}
                className="flex items-center justify-between bg-surface rounded px-3 py-2 text-sm"
              >
                <span className="truncate flex-1 mr-2 font-mono text-xs" title={dir}>
                  {dir}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void api.revealPath(dir)}
                    className="text-gray-400 hover:text-white text-xs"
                    title="Reveal in Finder"
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveWatchDir(dir)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Recovery">
        <div className="space-y-2">
          <Button onClick={() => void handleScanOrphans()} disabled={orphanScanning} testId="files-scan-orphans">
            {orphanScanning ? "Scanning…" : "Scan for orphaned recordings"}
          </Button>
          {orphanResult && <p className="text-xs text-gray-400">{orphanResult}</p>}
          <p className="text-[11px] text-gray-500">
            Finds WAV files in the recordings directory that aren't tracked in the library — typically left
            behind by an app crash mid-recording.
          </p>
        </div>
      </Section>
    </div>
  );
}
