/**
 * Card/Grid view of samples with type badges and score indicators.
 */

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

export function SampleGrid({
  samples,
  selectedSample,
  selectedIds,
  onSelect,
  onToggleSelect,
  onPlay,
}: SampleGridProps) {
  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto p-4"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "12px",
        alignContent: "start",
      }}
    >
      {samples.map((sample) => {
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
}

export default SampleGrid;
