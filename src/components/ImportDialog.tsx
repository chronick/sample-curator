/**
 * Import dialog with wizard flow.
 */

import { useState, useEffect } from "react";
import { open } from "@tauri-apps/api/dialog";
import type { ImportOptions, ImportProgress } from "../api/types";
import { api } from "../api";

interface ImportDialogProps {
  onClose: () => void;
  onComplete: () => void;
}

type ImportStep = "select" | "options" | "importing" | "complete";

export function ImportDialog({ onClose, onComplete }: ImportDialogProps) {
  const [step, setStep] = useState<ImportStep>("select");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [options, setOptions] = useState<ImportOptions>({
    recursive: true,
    exclude_patterns: [],
    analyze: true,
    detect_duplicates: true,
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Select directory
  const handleSelectDirectory = async () => {
    // Check if running inside Tauri
    if (typeof window.__TAURI__ === "undefined") {
      setError("Not running in Tauri. Please use the desktop app, not a browser.");
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Sample Directory",
      });

      if (selected && typeof selected === "string") {
        setSelectedPath(selected);
        setStep("options");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select directory");
    }
  };

  // Start import
  const startImport = async () => {
    if (!selectedPath) return;

    console.log("Starting import for path:", selectedPath);
    console.log("Options:", options);
    setStep("importing");
    setError(null);

    try {
      console.log("Calling api.startImport...");
      const id = await api.startImport(selectedPath, options);
      console.log("Import started with job ID:", id);
      setJobId(id);
    } catch (err) {
      console.error("Import failed:", err);
      setError(err instanceof Error ? err.message : "Failed to start import");
      setStep("options");
    }
  };

  // Poll progress
  useEffect(() => {
    if (!jobId || step !== "importing") return;

    const interval = setInterval(async () => {
      try {
        const p = await api.getImportProgress(jobId);
        setProgress(p);

        if (p.phase === "complete" || p.phase === "error") {
          clearInterval(interval);
          setStep("complete");
        }
      } catch (err) {
        console.error("Failed to get progress:", err);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [jobId, step]);

  // Cancel import
  const cancelImport = async () => {
    if (jobId) {
      try {
        await api.cancelImport(jobId);
      } catch (err) {
        console.error("Failed to cancel:", err);
      }
    }
    onClose();
  };

  // Get phase display name
  const getPhaseDisplay = (phase: string) => {
    const phases: Record<string, string> = {
      scanning: "Scanning files...",
      fingerprinting: "Generating fingerprints...",
      analyzing: "Analyzing audio...",
      importing: "Importing to library...",
      complete: "Import complete!",
      error: "Import failed",
    };
    return phases[phase] || phase;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-raised border border-surface-border rounded-lg shadow-xl w-[500px] max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <h2 className="text-lg font-semibold">Import Samples</h2>
          <button
            onClick={step === "importing" ? cancelImport : onClose}
            className="text-gray-400 hover:text-white"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Step 1: Select directory */}
          {step === "select" && (
            <div className="py-4">
              <div className="text-center">
                <div className="text-4xl mb-3">📁</div>
                <p className="text-white mb-2">
                  Select a folder containing audio samples
                </p>
                <p className="text-gray-400 text-sm mb-4">
                  Supports .wav, .aif, .flac, .mp3, .ogg
                </p>
                <button
                  onClick={handleSelectDirectory}
                  className="px-6 py-2 bg-accent hover:bg-accent-hover rounded font-medium transition-colors"
                >
                  Select Directory
                </button>
              </div>
              {error && (
                <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
              )}
            </div>
          )}

          {/* Step 2: Configure options */}
          {step === "options" && selectedPath && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Selected Directory
                </label>
                <div className="px-3 py-2 bg-surface border border-surface-border rounded text-sm truncate">
                  {selectedPath}
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options.recursive}
                    onChange={(e) =>
                      setOptions({ ...options, recursive: e.target.checked })
                    }
                    className="rounded border-surface-border"
                  />
                  <span className="text-sm">Scan subdirectories</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options.analyze}
                    onChange={(e) =>
                      setOptions({ ...options, analyze: e.target.checked })
                    }
                    className="rounded border-surface-border"
                  />
                  <span className="text-sm">
                    Analyze audio (BPM, key, quality scores)
                  </span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options.detect_duplicates}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        detect_duplicates: e.target.checked,
                      })
                    }
                    className="rounded border-surface-border"
                  />
                  <span className="text-sm">Skip duplicate files</span>
                </label>
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <button
                  onClick={() => setStep("select")}
                  className="px-4 py-2 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={startImport}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover rounded text-sm font-medium transition-colors"
                >
                  Start Import
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === "importing" && !progress && (
            <div className="py-8 text-center">
              <p className="text-gray-400">Starting import...</p>
            </div>
          )}
          {step === "importing" && progress && (
            <div className="py-4">
              <div className="text-center mb-4">
                <p className="text-lg font-medium">
                  {getPhaseDisplay(progress.phase)}
                </p>
                {progress.current_file && (
                  <p className="text-sm text-gray-400 truncate mt-1">
                    {progress.current_file}
                  </p>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-surface-border rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{
                    width: `${
                      progress.total > 0
                        ? (progress.current / progress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="flex justify-between text-sm text-gray-400">
                <span>
                  {progress.current} / {progress.total} files
                </span>
                <span>
                  {progress.total > 0
                    ? Math.round((progress.current / progress.total) * 100)
                    : 0}
                  %
                </span>
              </div>

              <div className="flex justify-center pt-4">
                <button
                  onClick={cancelImport}
                  className="px-4 py-2 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === "complete" && progress && (
            <div className="py-4">
              <div className="text-center mb-6">
                {progress.phase === "complete" ? (
                  <>
                    <div className="text-4xl mb-2">&#10003;</div>
                    <p className="text-lg font-medium text-score-high">
                      Import Complete!
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-2">&#10007;</div>
                    <p className="text-lg font-medium text-score-low">
                      Import Failed
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Imported:</span>
                  <span className="font-medium">{progress.imported_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Duplicates skipped:</span>
                  <span className="font-medium">
                    {progress.duplicates_skipped}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Errors:</span>
                  <span className="font-medium">{progress.errors.length}</span>
                </div>
              </div>

              {/* Errors list */}
              {progress.errors.length > 0 && (
                <div className="mt-4 max-h-32 overflow-y-auto">
                  <p className="text-sm font-medium text-red-400 mb-2">Errors:</p>
                  {progress.errors.slice(0, 10).map(([path, error], i) => (
                    <p key={i} className="text-xs text-gray-400 truncate">
                      {path}: {error}
                    </p>
                  ))}
                  {progress.errors.length > 10 && (
                    <p className="text-xs text-gray-500">
                      ... and {progress.errors.length - 10} more
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-center pt-4">
                <button
                  onClick={onComplete}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover rounded text-sm font-medium transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportDialog;
