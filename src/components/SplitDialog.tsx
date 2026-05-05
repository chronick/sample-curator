import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SplitMode = "silence" | "changepoint";

interface SplitDialogProps {
  /** Sample IDs to split. Dialog won't open if empty. */
  sampleIds: number[];
  open: boolean;
  onClose: () => void;
  /**
   * Called once `split_samples` returns the job handle. The dialog
   * itself doesn't track progress — the parent (or a global listener)
   * subscribes to `split:*` Tauri events.
   */
  onSubmitted?: (jobId: string, totalSamples: number) => void;
}

/**
 * Modal for the multi-select "Split selection" action (vault-3fe9 / T3).
 *
 * The dialog collects: mode (silence | changepoint), minimum chunk
 * length in seconds, and whether to move the source clips to Trash
 * once chunks land. On submit it invokes `split_samples` and bows
 * out — the actual work runs in a backend thread that emits Tauri
 * events for progress.
 */
export function SplitDialog({
  sampleIds,
  open,
  onClose,
  onSubmitted,
}: SplitDialogProps) {
  const [mode, setMode] = useState<SplitMode>("silence");
  const [minChunkSecs, setMinChunkSecs] = useState(1.0);
  const [deleteSource, setDeleteSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const count = sampleIds.length;

  const submit = async () => {
    if (count === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const handle = await invoke<{ job_id: string; total_samples: number }>(
        "split_samples",
        {
          sampleIds,
          params: {
            mode,
            min_chunk_secs: minChunkSecs,
            delete_source: deleteSource,
          },
        }
      );
      onSubmitted?.(handle.job_id, handle.total_samples);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="split-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-dialog-title"
    >
      <div className="w-[420px] max-w-[90vw] bg-surface border border-surface-border rounded-lg shadow-xl">
        <div className="px-4 py-3 border-b border-surface-border">
          <h2
            id="split-dialog-title"
            className="text-sm font-medium text-gray-100"
          >
            Split selection
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {count} {count === 1 ? "sample" : "samples"} will be split into
            sub-samples tagged with{" "}
            <code className="text-gray-300">parent:&lt;id&gt;</code>.
          </p>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* Mode */}
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Mode
            </label>
            <div className="flex gap-2">
              {(["silence", "changepoint"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
                    mode === m
                      ? "bg-accent/20 text-accent border-accent"
                      : "bg-surface hover:bg-surface-hover border-surface-border text-gray-300"
                  }`}
                  data-testid={`split-mode-${m}`}
                >
                  {m === "silence" ? "Silence" : "Spectral change"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {mode === "silence"
                ? "Splits at silent regions (RMS < -40 dB for ≥ 0.5s)."
                : "Splits where spectral content changes significantly."}
            </p>
          </div>

          {/* Min chunk seconds */}
          <div className="space-y-1">
            <label
              htmlFor="split-min-chunk"
              className="text-xs font-medium uppercase tracking-wide text-gray-400"
            >
              Min chunk length (seconds)
            </label>
            <input
              id="split-min-chunk"
              type="number"
              min={0.1}
              max={300}
              step={0.1}
              value={minChunkSecs}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v) && v > 0) setMinChunkSecs(v);
              }}
              className="w-full bg-surface border border-surface-border rounded px-2 py-1.5 text-xs text-white tabular-nums focus:outline-none focus:border-accent"
            />
          </div>

          {/* Delete source */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteSource}
              onChange={(e) => setDeleteSource(e.target.checked)}
              className="mt-0.5 accent-red-400"
              data-testid="split-delete-source"
            />
            <span className="text-xs text-gray-300">
              Move source clips to Trash after splitting.
              <span className="text-gray-500 block mt-0.5">
                Recoverable from the OS Trash; sub-samples remain.
              </span>
            </span>
          </label>

          {error && (
            <div
              className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5"
              data-testid="split-dialog-error"
            >
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-surface-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-surface-border rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || count === 0}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent hover:bg-accent/30 border border-accent rounded transition-colors disabled:opacity-50"
            data-testid="split-dialog-submit"
          >
            {submitting ? "Starting…" : `Split ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
