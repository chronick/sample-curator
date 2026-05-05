import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface OrphanedRecording {
  path: string;
  kind: "valid" | "invalid";
  size_bytes: number;
}

type ActionState = "idle" | "working" | "done" | "error";

interface RowState {
  action: ActionState;
  error?: string;
  dismissed: boolean;
}

interface Props {
  orphans: OrphanedRecording[];
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function OrphanedRecordingsDialog({ orphans, onClose }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(orphans.map((o) => [o.path, { action: "idle", dismissed: false }]))
  );

  const setRow = useCallback((path: string, update: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [path]: { ...prev[path], ...update } }));
  }, []);

  const handleImport = useCallback(
    async (path: string) => {
      setRow(path, { action: "working" });
      try {
        await invoke("import_orphaned_recording", { path });
        setRow(path, { action: "done", dismissed: true });
      } catch (err) {
        setRow(path, { action: "error", error: String(err) });
      }
    },
    [setRow]
  );

  const handleDelete = useCallback(
    async (path: string) => {
      setRow(path, { action: "working" });
      try {
        await invoke("delete_orphaned_recording", { path });
        setRow(path, { action: "done", dismissed: true });
      } catch (err) {
        setRow(path, { action: "error", error: String(err) });
      }
    },
    [setRow]
  );

  const handleSkip = useCallback(
    (path: string) => {
      setRow(path, { dismissed: true });
    },
    [setRow]
  );

  const visible = orphans.filter((o) => !rows[o.path]?.dismissed);
  const allDone = visible.length === 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={allDone ? onClose : undefined}
    >
      <div
        className="bg-surface-raised border border-surface-border rounded-lg w-[560px] max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Orphaned Recordings Found</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {allDone
                ? "All recordings handled."
                : `${visible.length} WAV file${visible.length !== 1 ? "s" : ""} on disk not in your library.`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4">
            &times;
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {allDone ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Nothing left to review. Close this dialog to continue.
            </p>
          ) : (
            visible.map((orphan) => {
              const row = rows[orphan.path] ?? { action: "idle", dismissed: false };
              const isWorking = row.action === "working";
              const isValid = orphan.kind === "valid";

              return (
                <div
                  key={orphan.path}
                  className="bg-surface border border-surface-border rounded p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        title={orphan.path}
                      >
                        {filename(orphan.path)}
                      </p>
                      <p className="text-xs text-gray-500 truncate" title={orphan.path}>
                        {orphan.path}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                          {formatBytes(orphan.size_bytes)}
                        </span>
                        {!isValid && (
                          <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                            corrupt / truncated
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {row.error && (
                    <p className="text-xs text-red-400">{row.error}</p>
                  )}

                  <div className="flex items-center gap-2">
                    {isValid && (
                      <button
                        disabled={isWorking}
                        onClick={() => handleImport(orphan.path)}
                        className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover rounded transition-colors disabled:opacity-50"
                      >
                        {isWorking ? "Importing…" : "Import"}
                      </button>
                    )}
                    <button
                      disabled={isWorking}
                      onClick={() => handleDelete(orphan.path)}
                      className="px-3 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-600/30 rounded transition-colors disabled:opacity-50"
                    >
                      {isWorking ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      disabled={isWorking}
                      onClick={() => handleSkip(orphan.path)}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-surface-border shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-surface hover:bg-surface-hover border border-surface-border rounded transition-colors"
          >
            {allDone ? "Close" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OrphanedRecordingsDialog;
