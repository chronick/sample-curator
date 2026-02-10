/**
 * Card/Grid view of samples with type badges and score indicators.
 * Virtualized via @tanstack/react-virtual for performance at 1000+ samples.
 */

import { useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Sample } from "../api/types";
import { getTypeEmoji } from "../utils/emoji";
import { ScoreIndicator } from "./ScoreIndicator";

interface SampleGridProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
}

const COLUMN_MIN_WIDTH = 210;

export function SampleGrid({
  samples,
  selectedSample,
  selectedIds,
  onSelect,
  onToggleSelect,
  onPlay,
}: SampleGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);

  // Calculate column count from container width
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setColumnCount(Math.max(1, Math.floor(w / COLUMN_MIN_WIDTH)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(samples.length / columnCount);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 4,
  });

  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto p-4">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * columnCount;
          const rowSamples = samples.slice(startIdx, startIdx + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0"
              style={{
                top: virtualRow.start,
                height: virtualRow.size,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                gap: 12,
              }}
            >
              {rowSamples.map((sample) => {
                const isSelected = selectedSample?.id === sample.id;
                const isChecked = selectedIds.has(sample.id);
                const filename = sample.path.split("/").pop() ?? sample.path;

                return (
                  <div
                    key={sample.id}
                    className={`bg-surface-raised border rounded-lg p-3 cursor-pointer hover:border-accent/50 transition-colors ${
                      isSelected
                        ? "border-accent"
                        : isChecked
                          ? "border-surface-border bg-surface-hover"
                          : "border-surface-border"
                    }`}
                    onClick={() => onSelect(sample)}
                    onDoubleClick={() => onPlay(sample)}
                  >
                    {/* Checkbox + Filename */}
                    <div className="flex items-start gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleSelect(sample.id);
                        }}
                        className="mt-0.5 rounded border-surface-border"
                      />
                      <span className="text-sm truncate flex-1" title={filename}>
                        {filename}
                      </span>
                    </div>

                    {/* Type badge */}
                    {sample.sample_type && (
                      <div className="mb-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-surface border border-surface-border rounded text-xs">
                          {getTypeEmoji(sample.sample_type)} {sample.sample_type}
                        </span>
                      </div>
                    )}

                    {/* BPM / Key */}
                    <div className="flex items-center gap-3 mb-2 text-xs text-gray-400">
                      <span>{sample.bpm ? `${Math.round(sample.bpm)} BPM` : "-"}</span>
                      <span>{sample.key || "-"}</span>
                    </div>

                    {/* Score */}
                    <div className="mb-2">
                      <ScoreIndicator score={sample.applicability_score} />
                    </div>

                    {/* Tags */}
                    {(sample.tags || []).length > 0 && (
                      <div className="flex gap-1 overflow-hidden">
                        {(sample.tags || []).slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-surface-border rounded text-xs truncate"
                          >
                            {tag}
                          </span>
                        ))}
                        {(sample.tags || []).length > 2 && (
                          <span className="text-xs text-gray-500">
                            +{sample.tags.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SampleGrid;
