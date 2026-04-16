/**
 * Sample browser with virtual scrolling and sortable columns.
 */

import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Sample } from "../api/types";
import { ScoreIndicator } from "./ScoreIndicator";
import { getTagEmoji } from "../utils/emoji";

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
  { key: "created_at", label: "Created", className: "w-20 px-2 py-2 text-right", align: "right" },
];

/** Threshold (ms) under which a sample is visually flagged as "just recorded". */
const FRESH_WINDOW_MS = 5 * 60 * 1000;

/** Produce a short "2m ago" / "3h ago" / "2d ago" string from an ISO timestamp. */
export function formatRelativeTime(isoTimestamp: string | null | undefined, now: number = Date.now()): string {
  if (!isoTimestamp) return "-";
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) return "-";
  const deltaMs = now - ts;
  if (deltaMs < 0) return "just now"; // clock skew — don't show future times
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

/** True if the sample was created within the last FRESH_WINDOW_MS. */
export function isFreshlyRecorded(isoTimestamp: string | null | undefined, now: number = Date.now()): boolean {
  if (!isoTimestamp) return false;
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) return false;
  return now - ts < FRESH_WINDOW_MS && now - ts >= 0;
}

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
          <div className="w-48 px-2 py-2">Tags</div>
        </div>

        {/* Rows */}
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const sample = samples[virtualItem.index];
          const isSelected = selectedSample?.id === sample.id;
          const isChecked = selectedIds.has(sample.id);
          const isFresh = isFreshlyRecorded(sample.created_at);
          return (
            <div
              key={sample.id}
              data-testid={isFresh ? "fresh-sample-row" : undefined}
              className={`absolute top-0 left-0 w-full flex items-center cursor-pointer transition-colors ${
                isSelected
                  ? "bg-accent/20 border-l-2 border-accent"
                  : isChecked
                  ? "bg-surface-hover"
                  : isFresh
                  ? "bg-emerald-500/10 hover:bg-emerald-500/15"
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
              <div className="flex-1 px-2 truncate text-sm flex items-center gap-2">
                <span className="truncate">{sample.path.split("/").pop()}</span>
                {isFresh && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 text-[9px] tracking-wide uppercase border border-emerald-600/40"
                    title="Recorded or imported within the last 5 minutes"
                  >
                    new
                  </span>
                )}
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
              <div
                className={`w-20 px-2 text-right text-xs tabular-nums ${
                  isFresh ? "text-emerald-400" : "text-gray-500"
                }`}
                title={sample.created_at}
              >
                {formatRelativeTime(sample.created_at)}
              </div>
              <div className="w-48 px-2 flex gap-1 overflow-hidden">
                {(sample.tags || []).slice(0, 3).map((tag) => {
                  const emoji = getTagEmoji(tag);
                  return (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 bg-surface-border rounded text-xs truncate"
                    >
                      {emoji && <span className="mr-0.5">{emoji}</span>}
                      {tag}
                    </span>
                  );
                })}
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
