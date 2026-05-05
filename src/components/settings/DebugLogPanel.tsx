import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TelemetryEvent {
  ts: string;
  category: string;
  event_type: string;
  details: unknown;
}

export type CategoryFilter = "all" | "arm" | "clip" | "job";

const FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "arm", label: "Arm" },
  { value: "clip", label: "Clip" },
  { value: "job", label: "Job" },
];

const POLL_MS = 1000;
const LIMIT = 100;

function formatDetails(details: unknown): string {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function formatTimestamp(ts: string): string {
  // Display HH:MM:SS in the user's local zone — full RFC3339 in title for hover.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString();
}

export function DebugLogPanel() {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const fetchEvents = useCallback(async (cat: CategoryFilter) => {
    try {
      const result = await invoke<TelemetryEvent[]>("telemetry_recent_events", {
        limit: LIMIT,
        category: cat === "all" ? null : cat,
      });
      if (!cancelled.current) {
        setEvents(result);
        setError(null);
      }
    } catch (err) {
      if (!cancelled.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    fetchEvents(filter);
    const id = window.setInterval(() => fetchEvents(filter), POLL_MS);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [filter, fetchEvents]);

  const empty = events.length === 0;

  const rows = useMemo(
    () =>
      events.map((ev, idx) => (
        <div
          key={`${ev.ts}-${idx}`}
          className="flex items-baseline gap-2 px-2 py-1 text-xs font-mono border-b border-surface-border last:border-b-0"
        >
          <span className="text-gray-500 shrink-0" title={ev.ts}>
            {formatTimestamp(ev.ts)}
          </span>
          <span
            className={
              ev.category === "arm"
                ? "text-blue-400 shrink-0 w-10"
                : ev.category === "clip"
                ? "text-green-400 shrink-0 w-10"
                : ev.category === "job"
                ? "text-yellow-400 shrink-0 w-10"
                : "text-gray-400 shrink-0 w-10"
            }
          >
            {ev.category}
          </span>
          <span className="text-gray-300 shrink-0">{ev.event_type}</span>
          <span className="text-gray-500 truncate flex-1" title={formatDetails(ev.details)}>
            {formatDetails(ev.details)}
          </span>
        </div>
      )),
    [events],
  );

  return (
    <section data-testid="debug-log-panel">
      <h3 className="text-sm font-medium mb-3">Debug log</h3>
      <div className="flex gap-1 mb-2" role="tablist" aria-label="Event category filter">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={
              "px-2 py-1 text-xs rounded border transition-colors " +
              (filter === f.value
                ? "bg-accent border-accent text-white"
                : "bg-surface border-surface-border text-gray-400 hover:text-gray-200")
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-red-400 mb-2" role="alert">
          {error}
        </p>
      )}
      <div
        className="bg-surface border border-surface-border rounded max-h-64 overflow-y-auto"
        data-testid="debug-log-events"
      >
        {empty ? (
          <p className="text-xs text-gray-500 px-3 py-4 text-center">
            No events recorded yet today.
          </p>
        ) : (
          rows
        )}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Events are written to <code>~/.music-hub-data/logs/events-YYYY-MM-DD.jsonl</code>.
        Showing last {LIMIT} from today&apos;s log; refreshes every {POLL_MS / 1000}s.
      </p>
    </section>
  );
}

export default DebugLogPanel;
