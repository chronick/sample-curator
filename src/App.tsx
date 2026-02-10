import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { SampleBrowser } from "./components/SampleBrowser";
import { SampleGrid } from "./components/SampleGrid";
import { FileBrowser } from "./components/FileBrowser";
import { WaveformView } from "./components/WaveformView";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TagEditor } from "./components/TagEditor";
import { SimilarityPanel } from "./components/SimilarityPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { QueryBar } from "./components/QueryBar";
import { FilterBreadcrumbs } from "./components/FilterBreadcrumbs";
import { TabBar } from "./components/TabBar";
import { SampleDetails } from "./components/SampleDetails";
import { BatchActionsPanel } from "./components/BatchActionsPanel";
import { ConstellationExplorer } from "./components/ConstellationExplorer";
import { RadarComparator } from "./components/RadarComparator";
import { SpectralColorWheel } from "./components/SpectralColorWheel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DragHandle } from "./components/DragHandle";
import { HeaderBar } from "./components/HeaderBar";
import { useLibrary } from "./hooks/useLibrary";
import { useStore } from "./store";
import { usePlayer } from "./hooks/usePlayer";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { JobProgressBar } from "./components/JobProgressBar";
import { JobsPanel } from "./components/JobsPanel";
import { useJobs } from "./hooks/useJobs";
import { api } from "./api/client";
import type { SearchFilters, ViewMode } from "./api/types";

type RightPanelMode = "details" | "similar" | "projects" | "duplicates";

const VIEW_MODES: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: "list", label: "List", icon: "\u2630" },
  { mode: "grid", label: "Grid", icon: "\u2637" },
  { mode: "constellation", label: "Constellation", icon: "\u2726" },
  { mode: "radar", label: "Radar Grid", icon: "\u25C9" },
  { mode: "colorwheel", label: "Color Wheel", icon: "\u25D4" },
];

function isExploreMode(mode: ViewMode): boolean {
  return mode === "constellation" || mode === "radar" || mode === "colorwheel";
}

function AnalyzeButton({ sampleId }: { sampleId: number }) {
  const [status, setStatus] = useState<"idle" | "queued" | "error">("idle");

  return (
    <button
      onClick={async () => {
        try {
          await api.queueSampleJob(sampleId, "full");
          setStatus("queued");
          setTimeout(() => setStatus("idle"), 2000);
        } catch (err) {
          console.error("Failed to queue analysis:", err);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2000);
        }
      }}
      className={`px-3 py-1 border rounded text-xs transition-colors ${
        status === "queued"
          ? "bg-green-500/20 border-green-500/30 text-green-400"
          : status === "error"
          ? "bg-red-500/20 border-red-500/30 text-red-400"
          : "bg-surface hover:bg-surface-hover border-surface-border"
      }`}
      title="Queue this sample for full analysis"
    >
      {status === "queued" ? "Queued!" : status === "error" ? "Failed" : "Analyze"}
    </button>
  );
}

function AppContent() {
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("details");
  const [acousticTags, setAcousticTags] = useState<string[]>([]);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  const activeView = useStore((s) => s.activeView);
  const setActiveView = useStore((s) => s.setActiveView);

  const { jobStats } = useJobs();

  // Panel sizes (px)
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(288);
  const [browsePlayerH, setBrowsePlayerH] = useState(288);
  const [explorePlayerH, setExplorePlayerH] = useState(180);

  // Panel visibility
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showPlayer, setShowPlayer] = useState(true);

  // Check for Tauri context
  useEffect(() => {
    if (typeof window.__TAURI_INTERNALS__ === "undefined") {
      setInitError("Not running in Tauri context. Please use the desktop app.");
    }
  }, []);

  // Close view menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
    };
    if (showViewMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showViewMenu]);

  const {
    samples,
    totalSamples,
    selectedSample,
    selectedIds,
    filters,
    loading,
    packs,
    allTags,
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

  const playerHeight = isExploreMode(viewMode) ? explorePlayerH : browsePlayerH;
  const setPlayerHeight = isExploreMode(viewMode) ? setExplorePlayerH : setBrowsePlayerH;

  const { currentSample, isPlaying, progress, play, pause, resume, seek } = usePlayer();

  // Fetch acoustic tags when selected sample changes
  useEffect(() => {
    if (selectedSample) {
      api.findSimilar(selectedSample.id, 1).catch(() => {}); // warm up
      // Try to get acoustic tags
      import("@tauri-apps/api/core").then(({ invoke }) => {
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

  // Analysis coverage for banner
  const analysisCoverage = useMemo(() => {
    if (samples.length === 0) return { analyzed: 0, total: 0, pct: 100 };
    const analyzed = samples.filter((s) => s.analyzed_at !== null).length;
    return { analyzed, total: samples.length, pct: Math.round((analyzed / samples.length) * 100) };
  }, [samples]);

  useKeyboardShortcuts({
    selectedSample,
    samples,
    isPlaying,
    currentSample,
    viewMode,
    tabs,
    activeTabId,
    activeView,
    play,
    pause,
    resume,
    selectSample,
    refresh,
    setViewMode,
    addTab,
    closeTab,
    setActiveTab,
    setShowLeft,
    setShowRight,
    setShowPlayer,
    setShowImport,
    setRightPanelMode,
    setActiveView,
  });

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
      <HeaderBar
        activeView={activeView}
        showLeft={showLeft}
        showRight={showRight}
        showPlayer={showPlayer}
        onSetActiveView={setActiveView}
        onToggleLeft={() => setShowLeft((v) => !v)}
        onToggleRight={() => setShowRight((v) => !v)}
        onTogglePlayer={() => setShowPlayer((v) => !v)}
        onShowSettings={() => setShowSettings(true)}
        onShowImport={() => setShowImport(true)}
        onRefresh={refresh}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: File Browser */}
        {showLeft && (
          <>
            <aside
              style={{ width: leftWidth }}
              className="flex-shrink-0 border-r border-surface-border bg-surface overflow-y-auto flex flex-col"
            >
              <FileBrowser
                onSelectSample={handleSelectSampleById}
                onPlayFile={(path) => play(path)}
              />
            </aside>
            <DragHandle
              direction="vertical"
              onDrag={(delta) =>
                setLeftWidth((w) => Math.min(500, Math.max(160, w + delta)))
              }
            />
          </>
        )}

        {/* Central panel */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {activeView === "browse" ? (
            <>
              {/* Tab bar + view selector row */}
              <div className="flex items-center border-b border-surface-border">
                <div className="flex-1 min-w-0">
                  <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={setActiveTab}
                    onNewTab={() => addTab()}
                    onCloseTab={closeTab}
                  />
                </div>
                {/* View selector dropdown */}
                <div className="relative flex-shrink-0 px-2" ref={viewMenuRef}>
                  <button
                    onClick={() => setShowViewMenu((v) => !v)}
                    className={`px-2 py-1 border rounded text-xs transition-colors ${
                      isExploreMode(viewMode)
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-surface hover:bg-surface-hover border-surface-border"
                    }`}
                    title="Switch view mode (V)"
                  >
                    {VIEW_MODES.find((m) => m.mode === viewMode)?.icon || "\u2630"}{" "}
                    {VIEW_MODES.find((m) => m.mode === viewMode)?.label || "View"}
                  </button>
                  {showViewMenu && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-surface-raised border border-surface-border rounded-lg shadow-xl z-50 py-1">
                      {VIEW_MODES.map(({ mode, label, icon }) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setViewMode(mode);
                            setShowViewMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors flex items-center gap-2 ${
                            viewMode === mode ? "text-accent" : ""
                          }`}
                        >
                          <span>{icon}</span>
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <JobProgressBar />
              </div>

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

              {/* Analysis coverage banner (shown in explore modes when coverage is low) */}
              {isExploreMode(viewMode) && analysisCoverage.pct < 80 && analysisCoverage.total > 0 && (
                <div className="px-4 py-2 bg-yellow-900/20 border-b border-yellow-700/30 flex items-center justify-between text-[11px]">
                  <span className="text-yellow-500/80">
                    {analysisCoverage.pct}% of samples analyzed — some visualizations may be incomplete
                  </span>
                  <button
                    onClick={async () => {
                      const unanalyzed = samples.filter((s) => s.analyzed_at === null);
                      for (const s of unanalyzed.slice(0, 50)) {
                        try {
                          await api.queueSampleJob(s.id, "full");
                        } catch {}
                      }
                    }}
                    className="text-yellow-400 hover:text-yellow-300 font-medium ml-4 whitespace-nowrap"
                  >
                    Analyze All
                  </button>
                </div>
              )}

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
              ) : viewMode === "grid" ? (
                <SampleGrid
                  samples={samples}
                  selectedSample={selectedSample}
                  selectedIds={selectedIds}
                  onSelect={selectSample}
                  onToggleSelect={toggleSelection}
                  onPlay={(sample) => play(sample.path)}
                />
              ) : viewMode === "constellation" ? (
                <ConstellationExplorer
                  samples={samples}
                  selectedSample={selectedSample}
                  selectedIds={selectedIds}
                  onSelect={selectSample}
                  onToggleSelect={toggleSelection}
                  onPlay={(sample) => play(sample.path)}
                />
              ) : viewMode === "radar" ? (
                <RadarComparator
                  samples={samples}
                  selectedSample={selectedSample}
                  selectedIds={selectedIds}
                  onSelect={selectSample}
                  onToggleSelect={toggleSelection}
                  onPlay={(sample) => play(sample.path)}
                />
              ) : viewMode === "colorwheel" ? (
                <SpectralColorWheel
                  samples={samples}
                  selectedSample={selectedSample}
                  selectedIds={selectedIds}
                  onSelect={selectSample}
                  onToggleSelect={toggleSelection}
                  onPlay={(sample) => play(sample.path)}
                />
              ) : null}

              {/* Player panel - inside central column, between sidebars */}
              {showPlayer && selectedSample && (
                <>
                  <DragHandle
                    direction="horizontal"
                    onDrag={(delta) =>
                      setPlayerHeight((h) => Math.min(500, Math.max(80, h - delta)))
                    }
                  />
                  <div
                    style={{ height: playerHeight }}
                    className="border-t border-surface-border bg-surface-raised flex overflow-y-auto flex-shrink-0"
                  >
                    <div className="flex-1 min-w-0 p-4 min-h-0">
                      <WaveformView
                        key={selectedSample.id}
                        sample={selectedSample}
                        isPlaying={isPlaying && currentSample === selectedSample.path}
                        progress={currentSample === selectedSample.path ? progress : 0}
                        onSeek={seek}
                        onPlay={() => play(selectedSample.path)}
                      />
                    </div>
                    {isExploreMode(viewMode) ? (
                      <div className="flex-shrink-0 px-4 py-2 border-l border-surface-border flex flex-col gap-2 h-full justify-center min-w-[200px]">
                        <div className="text-sm truncate" title={selectedSample.path}>
                          {selectedSample.path.split("/").pop()}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-3">
                          {selectedSample.sample_type && <span>{selectedSample.sample_type}</span>}
                          {selectedSample.bpm && <span>{Math.round(selectedSample.bpm)} BPM</span>}
                          {selectedSample.key && <span>{selectedSample.key}</span>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (isPlaying && currentSample === selectedSample.path) {
                                pause();
                              } else {
                                play(selectedSample.path);
                              }
                            }}
                            className="px-3 py-1 bg-accent hover:bg-accent-hover rounded text-xs font-medium transition-colors"
                          >
                            {isPlaying && currentSample === selectedSample.path ? "Pause" : "Play"}
                          </button>
                          <AnalyzeButton sampleId={selectedSample.id} />
                        </div>
                      </div>
                    ) : (
                      <div className="w-72 border-l border-surface-border p-4 flex-shrink-0">
                        <TagEditor
                          sample={selectedSample}
                          selectedCount={selectedIds.size}
                          onUpdate={refresh}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : activeView === "jobs" ? (
            <JobsPanel />
          ) : null}
        </main>

        {/* Right panel (similar/compatible/projects) */}
        {showRight && (
          <>
            <DragHandle
              direction="vertical"
              onDrag={(delta) =>
                setRightWidth((w) => Math.min(500, Math.max(200, w - delta)))
              }
            />
            <aside
              style={{ width: rightWidth }}
              className="flex-shrink-0 border-l border-surface-border bg-surface flex flex-col"
            >
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
                {rightPanelMode === "details" && selectedIds.size > 1 ? (
                  <BatchActionsPanel
                    selectedIds={selectedIds}
                    onUpdate={refresh}
                  />
                ) : rightPanelMode === "details" && selectedSample ? (
                  <SampleDetails sample={selectedSample} acousticTags={acousticTags} onUpdate={(updated) => {
                    useStore.getState().updateSample(updated);
                  }} />
                ) : null}
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
          </>
        )}
      </div>

      {/* Status bar */}
      <footer className="px-4 py-1 text-xs text-gray-500 border-t border-surface-border bg-surface-raised flex justify-between">
        <span>
          {totalSamples} samples
          {selectedIds.size > 0 && ` | ${selectedIds.size} selected`}
        </span>
        <span className="flex items-center gap-4">
          {/* Job status indicator */}
          {jobStats && (jobStats.pending > 0 || jobStats.running > 0) && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
              <span>Jobs active</span>
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

      {/* Settings dialog */}
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
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
