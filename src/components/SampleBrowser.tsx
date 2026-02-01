/**
 * Sample browser with virtual scrolling.
 */

import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Sample } from "../api/types";
import { ScoreIndicator } from "./ScoreIndicator";

interface SampleBrowserProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  loading: boolean;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
}

export function SampleBrowser({
  samples,
  selectedSample,
  selectedIds,
  loading,
  onSelect,
  onToggleSelect,
  onPlay,
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
        {/* Header */}
        <div className="sticky top-0 z-10 flex bg-surface-raised border-b border-surface-border text-xs text-gray-400 font-medium">
          <div className="w-8 px-2 py-2" />
          <div className="flex-1 px-2 py-2">Name</div>
          <div className="w-20 px-2 py-2 text-right">Score</div>
          <div className="w-16 px-2 py-2 text-right">BPM</div>
          <div className="w-16 px-2 py-2">Key</div>
          <div className="w-20 px-2 py-2">Type</div>
          <div className="w-32 px-2 py-2">Tags</div>
        </div>

        {/* Rows */}
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const sample = samples[virtualItem.index];
          const isSelected = selectedSample?.id === sample.id;
          const isChecked = selectedIds.has(sample.id);

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
              <div className="w-20 px-2 text-sm text-gray-400 truncate">
                {sample.sample_type || "-"}
              </div>
              <div className="w-32 px-2 flex gap-1 overflow-hidden">
                {sample.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 bg-surface-border rounded text-xs truncate"
                  >
                    {tag}
                  </span>
                ))}
                {sample.tags.length > 3 && (
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
