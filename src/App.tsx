import { useState, useEffect, useCallback, Component, ErrorInfo, ReactNode } from "react";
import { SampleBrowser } from "./components/SampleBrowser";
import { SampleGrid } from "./components/SampleGrid";
import { FilterPanel } from "./components/FilterPanel";
import { WaveformView } from "./components/WaveformView";
import { ImportDialog } from "./components/ImportDialog";
import { TagEditor } from "./components/TagEditor";
import { SimilarityPanel } from "./components/SimilarityPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { QueryBar } from "./components/QueryBar";
import { FilterBreadcrumbs } from "./components/FilterBreadcrumbs";
import { TabBar } from "./components/TabBar";
import { PackTree } from "./components/PackTree";
import { AcousticBadges } from "./components/AcousticBadges";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";
import { api, JobStatusResponse } from "./api/client";
import { getTypeEmoji } from "./utils/emoji";
import type { Sample, SearchFilters } from "./api/types";

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
  const [acousticTags, setAcousticTags] = useState<string[]>([]);

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

    pollJobStatus();
    const interval = setInterval(pollJobStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const {
    samples,
    totalSamples,
    selectedSample,
    selectedIds,
    filters,
    loading,
    packs,
    allTags,
    typeCounts,
    sortField,
    sortDirection,
    viewMode,
    tabs,
    activeTabId,
    setFilters,
    resetFilters,
    selectSample,
    toggleSelection,
    refresh,
    setSortField,
    setViewMode,
    addTab,
    closeTab,
    setActiveTab,
  } = useLibrary();

  const { currentSample, isPlaying, progress, play, pause, resume, seek } = usePlayer();

  // Fetch acoustic tags when selected sample changes
  useEffect(() => {
    if (selectedSample) {
      api.findSimilar(selectedSample.id, 1).catch(() => {}); // warm up
      // Try to get acoustic tags
      import("@tauri-apps/api/tauri").then(({ invoke }) => {
        invoke<{ tags: string[] }>("get_acoustic_tags", { sampleId: selectedSample.id })
          .then((result) => setAcousticTags(result.tags || []))
          .catch(() => setAcousticTags([]));
      });
    } else {
      setAcousticTags([]);
    }
  }, [selectedSample]);

  // Handler to select a sample by ID (for similarity/compatibility results)
  const handleSelectSampleById = useCallback(async (sampleId: number) => {
    try {
      const sample = await api.getSample(sampleId);
      selectSample(sample);
    } catch (err) {
      console.error("Failed to select sample:", err);
    }
  }, [selectSample]);

  // Handle filter removal from breadcrumbs
  const handleRemoveFilter = useCallback(
    (key: string, value?: string) => {
      const update: Partial<SearchFilters> = {};
      switch (key) {
        case "sample_type":
          update.sample_type = undefined;
          break;
        case "min_bpm":
          update.min_bpm = undefined;
          break;
        case "max_bpm":
          update.max_bpm = undefined;
          break;
        case "min_score":
          update.min_score = undefined;
          break;
        case "max_score":
          update.max_score = undefined;
          break;
        case "pack_id":
          update.pack_id = undefined;
          break;
        case "query":
          update.query = "";
          break;
        case "tags":
          if (value) {
            update.tags = (filters.tags || []).filter((t) => t !== value);
          } else {
            update.tags = [];
          }
          break;
      }
      setFilters(update);
    },
    [filters, setFilters]
  );

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

        case "ArrowDown":
          e.preventDefault();
          if (samples.length > 0) {
            const currentIndex = selectedSample
              ? samples.findIndex((s) => s.id === selectedSample.id)
              : -1;
            const nextIndex = Math.min(currentIndex + 1, samples.length - 1);
            selectSample(samples[nextIndex]);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (samples.length > 0) {
            const currentIndex = selectedSample
              ? samples.findIndex((s) => s.id === selectedSample.id)
              : 1;
            const prevIndex = Math.max(currentIndex - 1, 0);
            selectSample(samples[prevIndex]);
          }
          break;

        case "s":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("similar");
          }
          break;

        case "c":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("similar");
          }
          break;

        case "p":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("projects");
          }
          break;

        case "d":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setRightPanelMode("duplicates");
          }
          break;

        case "f":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
          }
          break;

        case "i":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setShowImport(true);
          }
          break;

        case "r":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            refresh();
          }
          break;

        case "t":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            addTab();
          }
          break;

        case "w":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            closeTab(activeTabId);
          }
          break;

        case "g":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setViewMode(viewMode === "list" ? "grid" : "list");
          }
          break;
      }

      // Tab switching with Cmd+1-9
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < tabs.length) {
          setActiveTab(tabs[tabIndex].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSample, samples, isPlaying, currentSample, play, pause, resume, selectSample, refresh, viewMode, setViewMode, addTab, closeTab, activeTabId, tabs, setActiveTab]);

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
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <button
            onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
            className="px-2 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
            title={`Switch to ${viewMode === "list" ? "grid" : "list"} view (G)`}
          >
            {viewMode === "list" ? "\u2637" : "\u2630"}
          </button>
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

      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTab}
        onNewTab={() => addTab()}
        onCloseTab={closeTab}
      />

      {/* Query bar */}
      <div className="px-4 py-2 border-b border-surface-border bg-surface">
        <QueryBar
          filters={filters}
          onFiltersChange={setFilters}
          allTags={allTags}
          packs={packs}
        />
      </div>

      {/* Filter breadcrumbs */}
      <FilterBreadcrumbs
        filters={filters}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={resetFilters}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: PackTree + FilterPanel */}
        <aside className="w-64 border-r border-surface-border bg-surface overflow-y-auto flex flex-col">
          <PackTree
            packs={packs}
            typeCounts={typeCounts}
            totalSamples={totalSamples}
            activeFilter={{
              type: filters.sample_type || undefined,
              packId: filters.pack_id || undefined,
            }}
            onFilterByType={(type) => setFilters({ sample_type: type || undefined })}
            onFilterByPack={(packId) => setFilters({ pack_id: packId || undefined })}
          />
          <div className="border-t border-surface-border">
            <FilterPanel filters={filters} onChange={setFilters} />
          </div>
        </aside>

        {/* Sample browser / grid */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {viewMode === "list" ? (
            <SampleBrowser
              samples={samples}
              selectedSample={selectedSample}
              selectedIds={selectedIds}
              loading={loading}
              sortConfig={{ field: sortField, direction: sortDirection }}
              onSelect={selectSample}
              onToggleSelect={toggleSelection}
              onPlay={(sample) => play(sample.path)}
              onSort={setSortField}
            />
          ) : (
            <SampleGrid
              samples={samples}
              selectedSample={selectedSample}
              selectedIds={selectedIds}
              onSelect={selectSample}
              onToggleSelect={toggleSelection}
              onPlay={(sample) => play(sample.path)}
            />
          )}

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
              <SampleDetails sample={selectedSample} acousticTags={acousticTags} />
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
          {totalSamples} samples
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

function SampleDetails({ sample, acousticTags }: { sample: Sample; acousticTags: string[] }) {
  const emoji = getTypeEmoji(sample.sample_type);

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
            <div className="text-sm">
              {emoji && <span className="mr-1">{emoji}</span>}
              {sample.sample_type}
            </div>
          </div>
        )}
      </div>

      {/* Acoustic badges */}
      {acousticTags.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Acoustic</div>
          <AcousticBadges tags={acousticTags} />
        </div>
      )}

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

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
