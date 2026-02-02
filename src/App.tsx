import { useState, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { SampleBrowser } from "./components/SampleBrowser";
import { FilterPanel } from "./components/FilterPanel";
import { WaveformView } from "./components/WaveformView";
import { ImportDialog } from "./components/ImportDialog";
import { TagEditor } from "./components/TagEditor";
import { SimilarityPanel } from "./components/SimilarityPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";
import { api, JobStatusResponse } from "./api/client";

// Error boundary to catch render errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("React Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h1 className="text-xl text-red-400 mb-4">Something went wrong</h1>
          <pre className="text-sm text-gray-400 bg-gray-800 p-4 rounded overflow-auto">
            {this.state.error}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type RightPanelMode = "details" | "similar" | "projects" | "duplicates";

function AppContent() {
  const [showImport, setShowImport] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("details");
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);

  // Check for Tauri context
  useEffect(() => {
    if (typeof window.__TAURI__ === "undefined") {
      setInitError("Not running in Tauri context. Please use the desktop app.");
    }
  }, []);

  // Poll job status periodically
  useEffect(() => {
    const pollJobStatus = async () => {
      try {
        const status = await api.getJobStats();
        setJobStatus(status);
      } catch (err) {
        // Ignore errors - job system might not be initialized yet
      }
    };

    // Initial poll
    pollJobStatus();

    // Poll every 5 seconds
    const interval = setInterval(pollJobStatus, 5000);
    return () => clearInterval(interval);
  }, []);


  const {
    samples,
    selectedSample,
    selectedIds,
    filters,
    loading,
    setFilters,
    selectSample,
    toggleSelection,
    refresh,
  } = useLibrary();

  const { currentSample, isPlaying, progress, play, pause, resume, seek } = usePlayer();

  // Handler to select a sample by ID (for similarity/compatibility results)
  const handleSelectSampleById = async (sampleId: number) => {
    try {
      const sample = await api.getSample(sampleId);
      selectSample(sample);
    } catch (err) {
      console.error("Failed to select sample:", err);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case " ": // Space - Play/Pause
          e.preventDefault();
          if (selectedSample) {
            if (isPlaying && currentSample === selectedSample.path) {
              pause();
            } else if (currentSample === selectedSample.path) {
              resume();
            } else {
              play(selectedSample.path);
            }
          }
          break;

        case "ArrowDown": // Navigate down
          e.preventDefault();
          if (samples.length > 0) {
            const currentIndex = selectedSample
              ? samples.findIndex((s) => s.id === selectedSample.id)
              : -1;
            const nextIndex = Math.min(currentIndex + 1, samples.length - 1);
            selectSample(samples[nextIndex]);
          }
          break;

        case "ArrowUp": // Navigate up
          e.preventDefault();
          if (samples.length > 0) {
            const currentIndex = selectedSample
              ? samples.findIndex((s) => s.id === selectedSample.id)
              : 1;
            const prevIndex = Math.max(currentIndex - 1, 0);
            selectSample(samples[prevIndex]);
          }
          break;

        case "s": // Find similar
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("similar");
          }
          break;

        case "c": // Find compatible
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("similar");
          }
          break;

        case "p": // Projects
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("projects");
          }
          break;

        case "d": // Duplicates
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("duplicates");
          }
          break;

        case "f": // Focus search (Cmd/Ctrl + F)
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
          }
          break;

        case "i": // Import (Cmd/Ctrl + I)
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setShowImport(true);
          }
          break;

        case "r": // Refresh (Cmd/Ctrl + R)
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            refresh();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSample, samples, isPlaying, currentSample, play, pause, resume, selectSample, refresh]);

  if (initError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <h1 className="text-xl text-red-400 mb-4">Initialization Error</h1>
          <p className="text-gray-400">{initError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-surface-border bg-surface-raised">
        <h1 className="text-lg font-semibold">Sample Curator</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover rounded text-sm font-medium transition-colors"
          >
            Import
          </button>
          <button
            onClick={refresh}
            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Filter panel */}
        <aside className="w-64 border-r border-surface-border bg-surface overflow-y-auto">
          <FilterPanel filters={filters} onChange={setFilters} />
        </aside>

        {/* Sample browser */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <SampleBrowser
            samples={samples}
            selectedSample={selectedSample}
            selectedIds={selectedIds}
            loading={loading}
            onSelect={selectSample}
            onToggleSelect={toggleSelection}
            onPlay={(sample) => play(sample.path)}
          />

          {/* Waveform and details */}
          {selectedSample && (
            <div className="h-72 border-t border-surface-border bg-surface-raised flex">
              <div className="flex-1 p-4">
                <WaveformView
                  sample={selectedSample}
                  isPlaying={isPlaying && currentSample === selectedSample.path}
                  progress={currentSample === selectedSample.path ? progress : 0}
                  onSeek={seek}
                  onPlay={() => play(selectedSample.path)}
                />
              </div>
              <div className="w-72 border-l border-surface-border p-4">
                <TagEditor
                  sample={selectedSample}
                  selectedCount={selectedIds.size}
                  onUpdate={refresh}
                />
              </div>
            </div>
          )}
        </main>

        {/* Right panel (similar/compatible/projects) */}
        <aside className="w-72 border-l border-surface-border bg-surface flex flex-col">
          {/* Panel mode tabs */}
          <div className="flex border-b border-surface-border text-xs">
            <button
              className={`flex-1 px-2 py-2 transition-colors ${
                rightPanelMode === "details" ? "bg-surface-hover text-accent" : "hover:bg-surface-hover"
              }`}
              onClick={() => setRightPanelMode("details")}
            >
              Details
            </button>
            <button
              className={`flex-1 px-2 py-2 transition-colors ${
                rightPanelMode === "similar" ? "bg-surface-hover text-accent" : "hover:bg-surface-hover"
              }`}
              onClick={() => setRightPanelMode("similar")}
            >
              Similar
            </button>
            <button
              className={`flex-1 px-2 py-2 transition-colors ${
                rightPanelMode === "projects" ? "bg-surface-hover text-accent" : "hover:bg-surface-hover"
              }`}
              onClick={() => setRightPanelMode("projects")}
            >
              Projects
            </button>
            <button
              className={`flex-1 px-2 py-2 transition-colors ${
                rightPanelMode === "duplicates" ? "bg-surface-hover text-accent" : "hover:bg-surface-hover"
              }`}
              onClick={() => setRightPanelMode("duplicates")}
            >
              Dupes
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {rightPanelMode === "details" && selectedSample && (
              <SampleDetails sample={selectedSample} />
            )}
            {rightPanelMode === "similar" && (
              <SimilarityPanel
                sample={selectedSample}
                onSelectSample={handleSelectSampleById}
              />
            )}
            {rightPanelMode === "projects" && (
              <ProjectsPanel
                selectedSampleIds={selectedIds}
                onSelectSample={handleSelectSampleById}
              />
            )}
            {rightPanelMode === "duplicates" && (
              <DuplicatesPanel
                onSelectSample={handleSelectSampleById}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="px-4 py-1 text-xs text-gray-500 border-t border-surface-border bg-surface-raised flex justify-between">
        <span>
          {samples.length} samples
          {selectedIds.size > 0 && ` | ${selectedIds.size} selected`}
        </span>
        <span className="flex items-center gap-4">
          {/* Job status indicator */}
          {jobStatus && (jobStatus.stats.pending > 0 || jobStatus.stats.running > 0) && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              <span>
                {jobStatus.stats.running > 0 && `${jobStatus.stats.running} processing`}
                {jobStatus.stats.running > 0 && jobStatus.stats.pending > 0 && ", "}
                {jobStatus.stats.pending > 0 && `${jobStatus.stats.pending} queued`}
              </span>
            </span>
          )}
          <span>
            {loading ? "Loading..." : "Ready"}
          </span>
        </span>
      </footer>

      {/* Import dialog */}
      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onComplete={() => {
            setShowImport(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SampleDetails({ sample }: { sample: Sample }) {
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <div className="text-xs text-gray-400 mb-1">File</div>
        <div className="text-sm truncate" title={sample.path}>
          {sample.path.split("/").pop()}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {sample.bpm && (
          <div>
            <div className="text-xs text-gray-400">BPM</div>
            <div className="text-sm">{Math.round(sample.bpm)}</div>
          </div>
        )}
        {sample.key && (
          <div>
            <div className="text-xs text-gray-400">Key</div>
            <div className="text-sm">{sample.key}</div>
          </div>
        )}
        {sample.duration && (
          <div>
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{sample.duration.toFixed(2)}s</div>
          </div>
        )}
        {sample.sample_type && (
          <div>
            <div className="text-xs text-gray-400">Type</div>
            <div className="text-sm">{sample.sample_type}</div>
          </div>
        )}
      </div>

      {/* Quality metrics */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Quality</div>
        <div className="space-y-1 text-xs">
          {sample.quality_score !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Quality Score</span>
              <span>{Math.round(sample.quality_score)}</span>
            </div>
          )}
          {sample.rms_db !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">RMS</span>
              <span>{sample.rms_db.toFixed(1)} dB</span>
            </div>
          )}
          {sample.crest_factor !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Crest Factor</span>
              <span>{sample.crest_factor.toFixed(1)} dB</span>
            </div>
          )}
        </div>
      </div>

      {/* Spectral */}
      {sample.spectral_centroid !== null && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Spectral</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Centroid</span>
              <span>{Math.round(sample.spectral_centroid)} Hz</span>
            </div>
            {sample.spectral_flatness !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Flatness</span>
                <span>{(sample.spectral_flatness * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      {sample.tags && sample.tags.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Tags</div>
          <div className="flex flex-wrap gap-1">
            {sample.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs bg-gray-700 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Import Sample type for SampleDetails
import type { Sample } from "./api/types";

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
