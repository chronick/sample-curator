import { useState, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { SampleBrowser } from "./components/SampleBrowser";
import { FilterPanel } from "./components/FilterPanel";
import { WaveformView } from "./components/WaveformView";
import { ImportDialog } from "./components/ImportDialog";
import { TagEditor } from "./components/TagEditor";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";

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

function AppContent() {
  const [showImport, setShowImport] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Check for Tauri context
  useEffect(() => {
    if (typeof window.__TAURI__ === "undefined") {
      setInitError("Not running in Tauri context. Please use the desktop app.");
    }
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

  const { currentSample, isPlaying, progress, play, seek } = usePlayer();

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
      </div>

      {/* Status bar */}
      <footer className="px-4 py-1 text-xs text-gray-500 border-t border-surface-border bg-surface-raised flex justify-between">
        <span>
          {samples.length} samples
          {selectedIds.size > 0 && ` | ${selectedIds.size} selected`}
        </span>
        <span>
          {loading ? "Loading..." : "Ready"}
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

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
