/**
 * Panel for finding similar and compatible samples.
 */

import { useState, useCallback, useEffect } from "react";
import { api } from "../api/client";
import type { Sample, SimilarityResult, CompatibilityResult, SearchAspects, CompatibilityCriteria, SearchStats } from "../api/types";

interface Props {
  sample: Sample | null;
  onSelectSample: (sampleId: number) => void;
}

type SearchMode = "similar" | "compatible";

/** Extract error message from various error formats */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    // Tauri errors often come as objects
    if ("message" in err && typeof err.message === "string") {
      return err.message;
    }
    // Sometimes the error is nested
    if ("error" in err && typeof err.error === "string") {
      return err.error;
    }
  }
  return String(err);
}

export function SimilarityPanel({ sample, onSelectSample }: Props) {
  const [mode, setMode] = useState<SearchMode>("similar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchStats, setSearchStats] = useState<SearchStats | null>(null);
  const [generatingEmbeddings, setGeneratingEmbeddings] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Similar search results
  const [similarResults, setSimilarResults] = useState<SimilarityResult[]>([]);

  // Compatible search results
  const [compatibleResults, setCompatibleResults] = useState<CompatibilityResult[]>([]);

  // Aspect sliders for similarity search
  const [aspects, setAspects] = useState<SearchAspects>({
    timbre: 1.0,
    pitch: 1.0,
    amplitude: 1.0,
    spectrum: 1.0,
  });

  // Criteria toggles for compatibility search
  const [criteria, setCriteria] = useState<CompatibilityCriteria>({
    check_key: true,
    check_bpm: true,
    check_frequency: true,
    check_dynamics: true,
  });

  // Load search stats on mount
  useEffect(() => {
    const loadStats = async () => {
      try {
        const stats = await api.getSearchStats();
        setSearchStats(stats);
      } catch (err) {
        console.error("Failed to load search stats:", err);
      }
    };
    loadStats();
  }, []);

  // Reset search state when sample changes
  useEffect(() => {
    setSimilarResults([]);
    setCompatibleResults([]);
    setError(null);
    setHasSearched(false);
  }, [sample?.id]);

  const handleFindSimilar = useCallback(async () => {
    if (!sample) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await api.findSimilar(sample.id, 20, aspects);
      setSimilarResults(results);
      setCompatibleResults([]);
    } catch (err) {
      const message = getErrorMessage(err);
      // Add helpful context for common errors
      if (message.includes("not found") || message.includes("EmbeddingNotFound")) {
        setError(`No embedding for this sample. Click "Generate Embeddings" first.`);
      } else if (message.includes("index") && message.includes("empty")) {
        setError(`No embeddings in database. Generate embeddings for your samples first.`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [sample, aspects]);

  const handleFindCompatible = useCallback(async () => {
    if (!sample) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await api.findCompatible(sample.id, 20, criteria);
      setCompatibleResults(results);
      setSimilarResults([]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [sample, criteria]);

  const handleGenerateEmbeddings = useCallback(async () => {
    setGeneratingEmbeddings(true);
    setError(null);
    try {
      const count = await api.generateMissingEmbeddings(50);
      // Refresh stats
      const stats = await api.getSearchStats();
      setSearchStats(stats);
      if (count === 0 && stats.total_embeddings < stats.total_samples) {
        // Samples exist but couldn't generate embeddings - likely missing spectral analysis
        setError(
          `Samples need spectral analysis first. Try re-analyzing samples or importing with analysis enabled.`
        );
      } else if (count > 0) {
        // Success - clear any previous error
        setError(null);
      }
    } catch (err) {
      setError(`Failed to generate embeddings: ${getErrorMessage(err)}`);
    } finally {
      setGeneratingEmbeddings(false);
    }
  }, []);

  const handleSearch = mode === "similar" ? handleFindSimilar : handleFindCompatible;

  if (!sample) {
    return (
      <div className="p-4 text-center text-gray-500">
        Select a sample to find similar or compatible samples
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex border-b border-surface-border">
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            mode === "similar"
              ? "bg-accent text-white"
              : "bg-surface hover:bg-surface-hover"
          }`}
          onClick={() => setMode("similar")}
        >
          Find Similar
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            mode === "compatible"
              ? "bg-accent text-white"
              : "bg-surface hover:bg-surface-hover"
          }`}
          onClick={() => setMode("compatible")}
        >
          Find Compatible
        </button>
      </div>

      {/* Options */}
      <div className="p-3 border-b border-surface-border bg-surface">
        {mode === "similar" ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-400 mb-2">Aspect Weights</div>
            <AspectSlider
              label="Timbre"
              value={aspects.timbre ?? 1}
              onChange={(v) => setAspects({ ...aspects, timbre: v })}
            />
            <AspectSlider
              label="Pitch"
              value={aspects.pitch ?? 1}
              onChange={(v) => setAspects({ ...aspects, pitch: v })}
            />
            <AspectSlider
              label="Amplitude"
              value={aspects.amplitude ?? 1}
              onChange={(v) => setAspects({ ...aspects, amplitude: v })}
            />
            <AspectSlider
              label="Spectrum"
              value={aspects.spectrum ?? 1}
              onChange={(v) => setAspects({ ...aspects, spectrum: v })}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-400 mb-2">Compatibility Criteria</div>
            <CriteriaToggle
              label="Key"
              checked={criteria.check_key ?? true}
              onChange={(v) => setCriteria({ ...criteria, check_key: v })}
            />
            <CriteriaToggle
              label="BPM"
              checked={criteria.check_bpm ?? true}
              onChange={(v) => setCriteria({ ...criteria, check_bpm: v })}
            />
            <CriteriaToggle
              label="Frequency"
              checked={criteria.check_frequency ?? true}
              onChange={(v) => setCriteria({ ...criteria, check_frequency: v })}
            />
            <CriteriaToggle
              label="Dynamics"
              checked={criteria.check_dynamics ?? true}
              onChange={(v) => setCriteria({ ...criteria, check_dynamics: v })}
            />
          </div>
        )}

        <button
          className="w-full mt-3 px-4 py-2 bg-accent hover:bg-accent-hover rounded text-sm font-medium transition-colors disabled:opacity-50"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "Searching..." : mode === "similar" ? "Find Similar" : "Find Compatible"}
        </button>
      </div>

      {/* Search stats indicator */}
      {searchStats && mode === "similar" && (
        <div className="px-3 py-2 border-b border-surface-border bg-surface text-xs">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">
              {searchStats.total_embeddings} / {searchStats.total_samples} samples indexed
            </span>
            {searchStats.total_embeddings < searchStats.total_samples && (
              <button
                onClick={handleGenerateEmbeddings}
                disabled={generatingEmbeddings}
                className="px-2 py-1 text-xs bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
              >
                {generatingEmbeddings ? "Generating..." : "Generate Embeddings"}
              </button>
            )}
          </div>
          {searchStats.total_embeddings === 0 && (
            <div className="mt-1 text-yellow-500">
              No embeddings yet. Generate embeddings to enable similarity search.
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/20 border-b border-red-900/30">
          <div className="text-red-400 text-sm font-medium mb-1">Search failed</div>
          <div className="text-red-300 text-xs">{error}</div>
          {error.includes("embedding") && searchStats && searchStats.total_embeddings < searchStats.total_samples && (
            <button
              onClick={handleGenerateEmbeddings}
              disabled={generatingEmbeddings}
              className="mt-2 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
            >
              {generatingEmbeddings ? "Generating..." : "Generate Embeddings Now"}
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {mode === "similar" && similarResults.length > 0 && (
          <SimilarResultsList results={similarResults} onSelect={onSelectSample} />
        )}
        {mode === "compatible" && compatibleResults.length > 0 && (
          <CompatibleResultsList results={compatibleResults} onSelect={onSelectSample} />
        )}

        {/* Empty state: no search yet */}
        {!loading && !error && !hasSearched && similarResults.length === 0 && compatibleResults.length === 0 && (
          <div className="p-4 text-center text-gray-500 text-sm">
            {mode === "similar" && searchStats?.total_embeddings === 0 ? (
              <div>
                <div className="mb-2">Generate embeddings first to enable similarity search.</div>
                <button
                  onClick={handleGenerateEmbeddings}
                  disabled={generatingEmbeddings}
                  className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
                >
                  {generatingEmbeddings ? "Generating..." : "Generate Embeddings"}
                </button>
              </div>
            ) : (
              "Click the button above to search"
            )}
          </div>
        )}

        {/* Empty state: searched but no results */}
        {!loading && !error && hasSearched && similarResults.length === 0 && compatibleResults.length === 0 && (
          <div className="p-4 text-center">
            <div className="text-gray-400 text-sm mb-1">No results found</div>
            <div className="text-gray-500 text-xs">
              {mode === "similar"
                ? "No similar samples in the library."
                : "No compatible samples found with current criteria."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AspectSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-16">{label}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
      />
      <span className="text-xs w-8 text-right text-gray-400">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function CriteriaToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function SimilarResultsList({
  results,
  onSelect,
}: {
  results: SimilarityResult[];
  onSelect: (sampleId: number) => void;
}) {
  return (
    <div className="divide-y divide-surface-border">
      {results.map((result) => (
        <button
          key={result.sample_id}
          className="w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors"
          onClick={() => onSelect(result.sample_id)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm">Sample #{result.sample_id}</span>
            <SimilarityBadge similarity={result.similarity} />
          </div>
        </button>
      ))}
    </div>
  );
}

function CompatibleResultsList({
  results,
  onSelect,
}: {
  results: CompatibilityResult[];
  onSelect: (sampleId: number) => void;
}) {
  return (
    <div className="divide-y divide-surface-border">
      {results.map((result) => (
        <button
          key={result.sample_id}
          className="w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors"
          onClick={() => onSelect(result.sample_id)}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm">Sample #{result.sample_id}</span>
            <CompatibilityBadge score={result.score} />
          </div>
          {result.notes.length > 0 && (
            <div className="text-xs text-gray-400">
              {result.notes.slice(0, 2).join(" • ")}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function SimilarityBadge({ similarity }: { similarity: number }) {
  const percent = Math.round(similarity * 100);
  const color =
    percent >= 80
      ? "bg-green-600"
      : percent >= 60
      ? "bg-yellow-600"
      : "bg-gray-600";

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {percent}% similar
    </span>
  );
}

function CompatibilityBadge({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  const color =
    percent >= 80
      ? "bg-green-600"
      : percent >= 60
      ? "bg-yellow-600"
      : "bg-gray-600";

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {percent}% compatible
    </span>
  );
}
