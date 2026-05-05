/**
 * Batch actions panel shown in the right sidebar when multiple samples are selected.
 * Provides common operations: re-analyze, delete, tag, clear selection.
 */

import { useEffect, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api/client";
import { useStore } from "../store";
import { SplitDialog } from "./SplitDialog";

interface BatchActionsPanelProps {
  selectedIds: Set<number>;
  onUpdate: () => void;
}

interface SplitProgressPayload {
  job_id: string;
  sample_index: number;
  total_samples: number;
  source_path: string;
  chunks_so_far: number;
}

interface SplitCompletePayload {
  job_id: string;
  total_samples: number;
  chunks_created: number;
  sources_deleted: number;
}

export function BatchActionsPanel({ selectedIds, onUpdate }: BatchActionsPanelProps) {
  const clearSelection = useStore((s) => s.clearSelection);
  const setActiveView = useStore((s) => s.setActiveView);
  const allTags = useStore((s) => s.allTags);
  const [newTag, setNewTag] = useState("");
  const [analyzeStatus, setAnalyzeStatus] = useState<"idle" | "queuing" | "done" | "error">("idle");
  const [analyzeCount, setAnalyzeCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  // Tracks whatever split job this panel last submitted so we can show
  // a tiny progress chip without a global UI surface. Cleared a few
  // seconds after `split:complete`.
  const [splitJob, setSplitJob] = useState<{
    jobId: string;
    progress: SplitProgressPayload | null;
    complete: SplitCompletePayload | null;
  } | null>(null);

  const count = selectedIds.size;
  const ids = Array.from(selectedIds);

  const handleAnalyzeSelected = useCallback(async () => {
    setAnalyzeStatus("queuing");
    setAnalyzeCount(0);
    let queued = 0;
    for (const id of ids) {
      try {
        await api.queueSampleJob(id, "full");
        queued++;
        setAnalyzeCount(queued);
      } catch (err) {
        console.error(`Failed to queue job for sample ${id}:`, err);
      }
    }
    setAnalyzeStatus(queued > 0 ? "done" : "error");
    setTimeout(() => setAnalyzeStatus("idle"), 2000);
  }, [ids]);

  const handleDeleteSelected = useCallback(async () => {
    try {
      await api.batchDelete(ids);
      setDeleteConfirm(false);
      onUpdate();
    } catch (err) {
      console.error("Failed to delete samples:", err);
    }
  }, [ids, onUpdate]);

  // Subscribe to split:* Tauri events. Only the panel that submitted a
  // job (the one whose `splitJob.jobId` matches) consumes the events;
  // others ignore. The library refreshes once on completion so the new
  // sub-samples show up.
  useEffect(() => {
    if (!splitJob) return;
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;
    (async () => {
      const offProgress = await listen<SplitProgressPayload>(
        "split:progress",
        (e) => {
          if (e.payload.job_id !== splitJob.jobId) return;
          if (!cancelled) {
            setSplitJob((prev) =>
              prev && prev.jobId === e.payload.job_id
                ? { ...prev, progress: e.payload }
                : prev
            );
          }
        }
      );
      const offComplete = await listen<SplitCompletePayload>(
        "split:complete",
        (e) => {
          if (e.payload.job_id !== splitJob.jobId) return;
          if (!cancelled) {
            setSplitJob((prev) =>
              prev && prev.jobId === e.payload.job_id
                ? { ...prev, complete: e.payload }
                : prev
            );
            // Refresh so chunks show up; clear the panel state shortly.
            onUpdate();
            window.setTimeout(() => {
              if (!cancelled) setSplitJob(null);
            }, 5000);
          }
        }
      );
      if (cancelled) {
        offProgress();
        offComplete();
      } else {
        unlisteners.push(offProgress, offComplete);
      }
    })();
    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [splitJob?.jobId, onUpdate]);

  const handleBatchAddTag = useCallback(async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag) return;
    try {
      await api.batchAddTags(ids, [tag]);
      setNewTag("");
      onUpdate();
    } catch (err) {
      console.error("Failed to batch add tag:", err);
    }
  }, [ids, newTag, onUpdate]);

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Selection summary */}
      <div>
        <div className="text-sm font-medium">{count} samples selected</div>
        <button
          onClick={clearSelection}
          className="text-xs text-gray-500 hover:text-gray-300 mt-1"
        >
          Clear selection
        </button>
      </div>

      {/* Split */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400">Split</div>
        <button
          onClick={() => setSplitDialogOpen(true)}
          disabled={count === 0 || splitJob !== null}
          className="w-full px-3 py-2 rounded text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
          data-testid="batch-actions-split"
        >
          Split selection…
        </button>
        {splitJob && (
          <div
            className="text-[10px] text-gray-400 bg-surface-raised/40 rounded px-2 py-1.5"
            data-testid="batch-actions-split-progress"
          >
            {splitJob.complete
              ? `Split done: ${splitJob.complete.chunks_created} chunks from ${splitJob.complete.total_samples} sources`
              : splitJob.progress
                ? `Splitting ${splitJob.progress.sample_index + 1}/${splitJob.progress.total_samples} · ${splitJob.progress.chunks_so_far} chunks so far`
                : "Starting split…"}
          </div>
        )}
      </div>

      {/* Analyze */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400">Analysis</div>
        <button
          onClick={handleAnalyzeSelected}
          disabled={analyzeStatus === "queuing"}
          className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors ${
            analyzeStatus === "done"
              ? "bg-green-500/20 text-green-400"
              : analyzeStatus === "error"
              ? "bg-red-500/20 text-red-400"
              : analyzeStatus === "queuing"
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-accent/20 text-accent hover:bg-accent/30"
          }`}
        >
          {analyzeStatus === "queuing"
            ? `Queuing... ${analyzeCount}/${count}`
            : analyzeStatus === "done"
            ? `Queued ${analyzeCount} jobs`
            : analyzeStatus === "error"
            ? "Failed to queue"
            : `Analyze ${count} samples`}
        </button>
        <button
          onClick={() => {
            handleAnalyzeSelected();
            setActiveView("jobs");
          }}
          disabled={analyzeStatus === "queuing"}
          className="w-full px-3 py-1.5 rounded text-xs bg-surface hover:bg-surface-hover border border-surface-border transition-colors"
        >
          Analyze &amp; view jobs
        </button>
      </div>

      {/* Batch tag */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400">Batch Tag</div>
        <div className="flex gap-1">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleBatchAddTag();
              }
            }}
            placeholder={`Tag ${count} samples...`}
            className="flex-1 px-2 py-1.5 text-xs bg-surface border border-surface-border rounded focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleBatchAddTag}
            disabled={!newTag.trim()}
            className="px-2 py-1.5 text-xs bg-accent/20 text-accent hover:bg-accent/30 rounded transition-colors disabled:opacity-30"
          >
            Add
          </button>
        </div>
        {/* Quick tag suggestions */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.slice(0, 8).map((tag) => (
              <button
                key={tag}
                onClick={async () => {
                  try {
                    await api.batchAddTags(ids, [tag]);
                    onUpdate();
                  } catch (err) {
                    console.error("Failed to batch add tag:", err);
                  }
                }}
                className="px-1.5 py-0.5 text-[10px] bg-surface-hover rounded hover:bg-accent/20 hover:text-accent transition-colors"
              >
                +{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Split modal */}
      <SplitDialog
        sampleIds={ids}
        open={splitDialogOpen}
        onClose={() => setSplitDialogOpen(false)}
        onSubmitted={(jobId) =>
          setSplitJob({ jobId, progress: null, complete: null })
        }
      />

      {/* Delete */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400">Danger Zone</div>
        {deleteConfirm ? (
          <div className="space-y-2">
            <div className="text-xs text-red-400">
              Delete {count} samples permanently?
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteSelected}
                className="flex-1 px-3 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-xs font-medium transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 px-3 py-2 bg-surface hover:bg-surface-hover border border-surface-border rounded text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="w-full px-3 py-2 bg-surface hover:bg-red-500/10 hover:text-red-400 border border-surface-border rounded text-xs transition-colors"
          >
            Delete {count} samples
          </button>
        )}
      </div>
    </div>
  );
}
