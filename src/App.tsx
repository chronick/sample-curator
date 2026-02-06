import { useState, useEffect, useCallback, Component, ErrorInfo, ReactNode } from "react";
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
import { AcousticBadges } from "./components/AcousticBadges";
import { useLibrary } from "./hooks/useLibrary";
import { useStore } from "./store";
import { usePlayer } from "./hooks/usePlayer";
import { api, JobStatusResponse } from "./api/client";
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
  const [showSettings, setShowSettings] = useState(false);
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
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
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
        {/* Left sidebar: File Browser */}
        <aside className="w-64 border-r border-surface-border bg-surface overflow-y-auto flex flex-col">
          <FileBrowser
            onSelectSample={handleSelectSampleById}
            onPlayFile={(path) => play(path)}
          />
        </aside>

        {/* Sample browser / grid */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
            <div className="h-72 border-t border-surface-border bg-surface-raised flex overflow-hidden">
              <div className="flex-1 min-w-0 p-4">
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
              <SampleDetails sample={selectedSample} acousticTags={acousticTags} onUpdate={(updated) => {
                useStore.getState().updateSample(updated);
              }} />
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

      {/* Settings dialog */}
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function SampleDetails({ sample, acousticTags, onUpdate }: { sample: Sample; acousticTags: string[]; onUpdate: (sample: Sample) => void }) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newTag, setNewTag] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Load all tags for autocomplete
  useEffect(() => {
    api.listTags().then(setAllTags).catch(() => {});
  }, []);

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const saveEdit = async () => {
    if (!editingField) return;
    try {
      const updates: Partial<Sample> = {};
      switch (editingField) {
        case "bpm":
          updates.bpm = editValue ? parseFloat(editValue) : null;
          break;
        case "key":
          updates.key = editValue || null;
          break;
      }
      const updated = await api.updateSample(sample.id, updates);
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to update sample:", err);
    }
    setEditingField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleAddTag = async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag || (sample.tags || []).includes(tag)) {
      setNewTag("");
      return;
    }
    try {
      const updated = await api.addTags(sample.id, [tag]);
      onUpdate(updated);
      setNewTag("");
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    try {
      const updated = await api.removeTags(sample.id, [tag]);
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  const handleTagInputChange = (value: string) => {
    setNewTag(value);
    if (value.length > 0) {
      const filtered = allTags
        .filter((t) => t.toLowerCase().startsWith(value.toLowerCase()))
        .filter((t) => !(sample.tags || []).includes(t))
        .slice(0, 5);
      setTagSuggestions(filtered);
    } else {
      setTagSuggestions([]);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (tagSuggestions.length > 0) {
        setNewTag(tagSuggestions[0]);
        setTagSuggestions([]);
        // Add it directly
        const tag = tagSuggestions[0].trim().toLowerCase();
        if (tag && !(sample.tags || []).includes(tag)) {
          api.addTags(sample.id, [tag]).then(onUpdate).catch(console.error);
          setNewTag("");
        }
      } else {
        handleAddTag();
      }
    } else if (e.key === "Escape") {
      setNewTag("");
      setTagSuggestions([]);
    }
  };

  const renderEditableField = (label: string, field: string, value: string | number | null, suffix?: string) => {
    const displayValue = value !== null && value !== undefined ? String(value) : "";
    const isEditing = editingField === field;

    return (
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              type={field === "bpm" ? "number" : "text"}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={saveEdit}
              autoFocus
              className="w-full px-1 py-0.5 text-sm bg-surface border border-accent rounded focus:outline-none"
            />
          </div>
        ) : (
          <div
            className="text-sm cursor-pointer hover:text-accent transition-colors group"
            onClick={() => startEdit(field, displayValue)}
            title="Click to edit"
          >
            {displayValue ? `${field === "bpm" ? Math.round(Number(displayValue)) : displayValue}${suffix || ""}` : "-"}
            <span className="ml-1 opacity-0 group-hover:opacity-50 text-xs">&#9998;</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <div className="text-xs text-gray-400 mb-1">File</div>
        <div className="text-sm truncate" title={sample.path}>
          {sample.path.split("/").pop()}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {renderEditableField("BPM", "bpm", sample.bpm)}
        {renderEditableField("Key", "key", sample.key)}
        {sample.duration && (
          <div>
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{sample.duration.toFixed(2)}s</div>
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

      {/* Editable Tags */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Tags</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {(sample.tags || []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-700 rounded group"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={newTag}
            onChange={(e) => handleTagInputChange(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="Add tag..."
            className="w-full px-2 py-1 text-xs bg-surface border border-surface-border rounded focus:outline-none focus:border-accent"
          />
          {tagSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-surface-border rounded shadow-lg">
              {tagSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="w-full px-2 py-1 text-xs text-left hover:bg-surface-hover"
                  onClick={() => {
                    const tag = suggestion.trim().toLowerCase();
                    if (tag && !(sample.tags || []).includes(tag)) {
                      api.addTags(sample.id, [tag]).then(onUpdate).catch(console.error);
                    }
                    setNewTag("");
                    setTagSuggestions([]);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
