import { useState } from "react";
import { SampleBrowser } from "./components/SampleBrowser";
import { FilterPanel } from "./components/FilterPanel";
import { WaveformView } from "./components/WaveformView";
import { ImportDialog } from "./components/ImportDialog";
import { TagEditor } from "./components/TagEditor";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";

function App() {
  const [showImport, setShowImport] = useState(false);
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

  const { currentSample, isPlaying, play, seek } = usePlayer();

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
            <div className="h-48 border-t border-surface-border bg-surface-raised flex">
              <div className="flex-1 p-4">
                <WaveformView
                  sample={selectedSample}
                  isPlaying={isPlaying && currentSample === selectedSample.path}
                  onSeek={seek}
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

export default App;
