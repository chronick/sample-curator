/**
 * Filter panel for sample search.
 */

import { useState } from "react";
import type { SearchFilters } from "../api/types";
import { useStore } from "../store";

interface FilterPanelProps {
  filters: SearchFilters;
  onChange: (filters: Partial<SearchFilters>) => void;
}

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const { packs = [], allTags = [], resetFilters } = useStore();
  const [tagInput, setTagInput] = useState("");

  const handleTagAdd = (tag: string) => {
    if (tag && !filters.tags?.includes(tag)) {
      onChange({ tags: [...(filters.tags || []), tag] });
    }
    setTagInput("");
  };

  const handleTagRemove = (tag: string) => {
    onChange({ tags: filters.tags?.filter((t) => t !== tag) });
  };

  const filteredTags = allTags.filter(
    (tag) =>
      tag.toLowerCase().includes(tagInput.toLowerCase()) &&
      !filters.tags?.includes(tag)
  );

  return (
    <div className="p-4 space-y-6">
      {/* Search */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Search
        </label>
        <input
          type="text"
          value={filters.query || ""}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="Search samples..."
          className="w-full px-3 py-1.5 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
        />
      </div>

      {/* Score range */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Score Range
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={filters.min_score ?? ""}
            onChange={(e) =>
              onChange({ min_score: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Min"
            min={0}
            max={100}
            className="w-16 px-2 py-1 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
          />
          <span className="text-gray-500">-</span>
          <input
            type="number"
            value={filters.max_score ?? ""}
            onChange={(e) =>
              onChange({ max_score: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Max"
            min={0}
            max={100}
            className="w-16 px-2 py-1 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* BPM range */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          BPM Range
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={filters.min_bpm ?? ""}
            onChange={(e) =>
              onChange({ min_bpm: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Min"
            min={20}
            max={300}
            className="w-16 px-2 py-1 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
          />
          <span className="text-gray-500">-</span>
          <input
            type="number"
            value={filters.max_bpm ?? ""}
            onChange={(e) =>
              onChange({ max_bpm: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Max"
            min={20}
            max={300}
            className="w-16 px-2 py-1 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Pack */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Pack
        </label>
        <select
          value={filters.pack_id ?? ""}
          onChange={(e) =>
            onChange({ pack_id: e.target.value ? Number(e.target.value) : undefined })
          }
          className="w-full px-3 py-1.5 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
        >
          <option value="">All Packs</option>
          {packs.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.name} ({pack.sample_count})
            </option>
          ))}
        </select>
      </div>

      {/* Sample Type */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Type
        </label>
        <select
          value={filters.sample_type ?? ""}
          onChange={(e) =>
            onChange({ sample_type: e.target.value || undefined })
          }
          className="w-full px-3 py-1.5 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
        >
          <option value="">All Types</option>
          <option value="kick">Kick</option>
          <option value="snare">Snare</option>
          <option value="hihat">Hi-Hat</option>
          <option value="clap">Clap</option>
          <option value="percussion">Percussion</option>
          <option value="bass">Bass</option>
          <option value="synth">Synth</option>
          <option value="fx">FX</option>
          <option value="vocal">Vocal</option>
          <option value="loop">Loop</option>
        </select>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Tags
        </label>

        {/* Selected tags */}
        {filters.tags && filters.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {(filters.tags || []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/20 text-accent rounded text-xs"
              >
                {tag}
                <button
                  onClick={() => handleTagRemove(tag)}
                  className="hover:text-white"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Tag input with autocomplete */}
        <div className="relative">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput) {
                handleTagAdd(tagInput);
              }
            }}
            placeholder="Add tag..."
            className="w-full px-3 py-1.5 bg-surface-raised border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
          />
          {tagInput && filteredTags.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-surface-border rounded shadow-lg max-h-32 overflow-y-auto">
              {filteredTags.slice(0, 10).map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleTagAdd(tag)}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={resetFilters}
        className="w-full px-3 py-1.5 bg-surface-raised hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
      >
        Reset Filters
      </button>
    </div>
  );
}

export default FilterPanel;
