/**
 * Sample browser with virtual scrolling and sortable columns.
 */

import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Sample } from "../api/types";
import { ScoreIndicator } from "./ScoreIndicator";
import { getTypeEmoji } from "../utils/emoji";

interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

interface SampleBrowserProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  loading: boolean;
  sortConfig?: SortConfig;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
  onSort?: (field: string) => void;
}

const SORTABLE_COLUMNS: Array<{ key: string; label: string; className: string; align?: string }> = [
  { key: "path", label: "Name", className: "flex-1 px-2 py-2" },
  { key: "applicability_score", label: "Score", className: "w-20 px-2 py-2 text-right", align: "right" },
  { key: "bpm", label: "BPM", className: "w-16 px-2 py-2 text-right", align: "right" },
  { key: "key", label: "Key", className: "w-16 px-2 py-2" },
  { key: "sample_type", label: "Type", className: "w-24 px-2 py-2" },
];

function SortIndicator({ field, sortConfig }: { field: string; sortConfig?: SortConfig }) {
  if (!sortConfig || sortConfig.field !== field) {
    return <span className="text-gray-600 ml-1">{"  "}</span>;
  }
  return (
    <span className="text-accent ml-1">
      {sortConfig.direction === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

export function SampleBrowser({
  samples,
  selectedSample,
  selectedIds,
  loading,
  sortConfig,
  onSelect,
  onToggleSelect,
  onPlay,
  onSort,
}: SampleBrowserProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = selectedSample
        ? samples.findIndex((s) => s.id === selectedSample.id)
        : -1;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex < samples.length - 1) {
            onSelect(samples[currentIndex + 1]);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (currentIndex > 0) {
            onSelect(samples[currentIndex - 1]);
          }
          break;
        case " ":
          e.preventDefault();
          if (selectedSample) {
            onPlay(selectedSample);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (selectedSample) {
            onToggleSelect(selectedSample.id);
          }
          break;
      }
    },
    [samples, selectedSample, onSelect, onPlay, onToggleSelect]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Loading samples...
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-auto focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {/* Header with sortable columns */}
        <div className="sticky top-0 z-10 flex bg-surface-raised border-b border-surface-border text-xs text-gray-400 font-medium">
          <div className="w-8 px-2 py-2" />
          {SORTABLE_COLUMNS.map((col) => (
            <div
              key={col.key}
              className={`${col.className} cursor-pointer hover:text-gray-200 select-none transition-colors`}
              onClick={() => onSort?.(col.key)}
            >
              {col.label}
              <SortIndicator field={col.key} sortConfig={sortConfig} />
            </div>
          ))}
          <div className="w-32 px-2 py-2">Tags</div>
        </div>

        {/* Rows */}
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const sample = samples[virtualItem.index];
          const isSelected = selectedSample?.id === sample.id;
          const isChecked = selectedIds.has(sample.id);
          const emoji = getTypeEmoji(sample.sample_type);

          return (
            <div
              key={sample.id}
              className={`absolute top-0 left-0 w-full flex items-center cursor-pointer transition-colors ${
                isSelected
                  ? "bg-accent/20 border-l-2 border-accent"
                  : isChecked
                  ? "bg-surface-hover"
                  : "hover:bg-surface-hover"
              }`}
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start + 32}px)`,
              }}
              onClick={() => onSelect(sample)}
              onDoubleClick={() => onPlay(sample)}
            >
              <div className="w-8 px-2">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSelect(sample.id);
                  }}
                  className="rounded border-surface-border"
                />
              </div>
              <div className="flex-1 px-2 truncate text-sm">
                {sample.path.split("/").pop()}
              </div>
              <div className="w-20 px-2 text-right">
                <ScoreIndicator score={sample.applicability_score} />
              </div>
              <div className="w-16 px-2 text-right text-sm text-gray-400">
                {sample.bpm ? Math.round(sample.bpm) : "-"}
              </div>
              <div className="w-16 px-2 text-sm text-gray-400">
                {sample.key || "-"}
              </div>
              <div className="w-24 px-2 text-sm text-gray-400 truncate">
                {emoji && <span className="mr-1">{emoji}</span>}
                {sample.sample_type || "-"}
              </div>
              <div className="w-32 px-2 flex gap-1 overflow-hidden">
                {(sample.tags || []).slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 bg-surface-border rounded text-xs truncate"
                  >
                    {tag}
                  </span>
                ))}
                {(sample.tags || []).length > 3 && (
                  <span className="text-xs text-gray-500">
                    +{sample.tags.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SampleBrowser;
