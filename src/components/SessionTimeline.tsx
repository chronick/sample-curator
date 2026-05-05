import { useMemo } from "react";
import type { Sample } from "../api/types";
import type { SessionSummary } from "../api/client";

interface SessionTimelineProps {
  session: SessionSummary;
  clips: Sample[];
  selectedSampleId: number | null;
  onSelectClip: (sample: Sample) => void;
  loading: boolean;
}

/**
 * Format a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") as a brief
 * absolute label in the user's local TZ, e.g. "Aug 5, 19:30:12".
 */
function formatAbsolute(raw: string): string {
  const utc = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(utc.getTime())) return raw;
  return utc.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Span in ms between two SQLite-formatted UTC timestamps. */
function spanMs(firstRaw: string, lastRaw: string): number {
  const first = new Date(firstRaw.replace(" ", "T") + "Z").getTime();
  const last = new Date(lastRaw.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(first) || Number.isNaN(last)) return 0;
  return Math.max(0, last - first);
}

/** Format span in ms as compact "Xm Ys" / "Xh Ym Zs". */
function formatSpan(ms: number): string {
  if (ms <= 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Horizontal session timeline. The axis spans from `first_clip_at` to
 * `last_clip_at` (clip span — does not include silence before first or
 * after last clip). Each clip renders as a vertical tick at its
 * `created_at` offset; click selects it in the right details panel.
 *
 * For single-clip sessions, the tick is centered.
 */
export function SessionTimeline({
  session,
  clips,
  selectedSampleId,
  onSelectClip,
  loading,
}: SessionTimelineProps) {
  const totalSpan = spanMs(session.first_clip_at, session.last_clip_at);
  const firstMs = useMemo(
    () => new Date(session.first_clip_at.replace(" ", "T") + "Z").getTime(),
    [session.first_clip_at]
  );

  const ticks = useMemo(() => {
    if (clips.length === 0) return [] as Array<{ sample: Sample; pct: number }>;
    if (clips.length === 1 || totalSpan === 0) {
      // One clip — center it. Avoids divide-by-zero and keeps the
      // single tick from snapping to the left edge.
      return clips.map((sample) => ({ sample, pct: 50 }));
    }
    return clips.map((sample) => {
      const t = new Date(sample.created_at.replace(" ", "T") + "Z").getTime();
      if (Number.isNaN(t)) return { sample, pct: 0 };
      const pct = ((t - firstMs) / totalSpan) * 100;
      return { sample, pct: Math.max(0, Math.min(100, pct)) };
    });
  }, [clips, firstMs, totalSpan]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="session-timeline"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border bg-surface-raised/40">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-gray-200 truncate">
            {session.derived_name}
          </h2>
          <div className="flex items-center gap-4 text-xs text-gray-400 tabular-nums">
            <span>
              {session.clip_count}{" "}
              {session.clip_count === 1 ? "clip" : "clips"}
            </span>
            <span>{formatSpan(totalSpan)}</span>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-1 truncate">
          {session.session_tag}
        </div>
      </div>

      {/* Axis */}
      <div className="px-4 py-6 border-b border-surface-border">
        {loading ? (
          <div
            className="text-xs text-gray-500"
            data-testid="session-timeline-loading"
          >
            Loading clips…
          </div>
        ) : (
          <>
            <div
              className="relative h-12 bg-surface-raised/40 border border-surface-border rounded"
              data-testid="session-timeline-axis"
            >
              {ticks.map(({ sample, pct }) => {
                const isSelected = sample.id === selectedSampleId;
                return (
                  <button
                    key={sample.id}
                    onClick={() => onSelectClip(sample)}
                    style={{ left: `${pct}%` }}
                    className={`absolute top-0 h-full -translate-x-1/2 w-1 transition-colors ${
                      isSelected
                        ? "bg-accent"
                        : "bg-yellow-400/70 hover:bg-yellow-300"
                    }`}
                    title={`${sample.path.split("/").pop()} · ${formatAbsolute(sample.created_at)}`}
                    data-testid="session-timeline-tick"
                    aria-label={`Clip at ${formatAbsolute(sample.created_at)}`}
                  />
                );
              })}
            </div>
            {/* Axis endpoints */}
            <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1 tabular-nums">
              <span>{formatAbsolute(session.first_clip_at)}</span>
              <span>{formatAbsolute(session.last_clip_at)}</span>
            </div>
          </>
        )}
      </div>

      {/* Clip list — secondary affordance, useful when ticks bunch up */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!loading && clips.length === 0 && (
          <div
            className="px-4 py-8 text-center text-xs text-gray-500"
            data-testid="session-timeline-empty"
          >
            No clips found for this session.
          </div>
        )}
        <ul className="divide-y divide-surface-border" role="list">
          {clips.map((sample) => {
            const isSelected = sample.id === selectedSampleId;
            return (
              <li key={sample.id}>
                <button
                  onClick={() => onSelectClip(sample)}
                  className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                    isSelected
                      ? "bg-accent/20 text-accent"
                      : "hover:bg-surface-hover text-gray-300"
                  }`}
                  aria-current={isSelected ? "true" : undefined}
                  data-testid="session-timeline-clip"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex-1">
                      {sample.path.split("/").pop()}
                    </span>
                    <span className="text-gray-500 tabular-nums flex-shrink-0">
                      {formatAbsolute(sample.created_at)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
