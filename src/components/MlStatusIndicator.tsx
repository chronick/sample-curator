/**
 * Glanceable ML status dot for the header. Aggregates state across all
 * enabled ML features (CLAP, Whisper, Demucs, ollama):
 *
 * - green     all enabled features loaded
 * - yellow*   anything loading/downloading (pulsing)
 * - yellow    enabled but not loaded (no in-flight work)
 * - red       any error
 * - gray      no enabled features (or status not yet loaded)
 *
 * Click → opens Settings → Analysis & ML. Tooltip surfaces a short
 * summary so the user can act without opening the dialog.
 */

import { useEffect, useMemo } from "react";
import { useMlFeaturesStore, type MlStatus } from "../store/mlFeaturesStore";

const AMBIENT_POLL_MS = 10_000;

type Severity = "ok" | "loading" | "warn" | "error" | "idle";

interface Aggregate {
  severity: Severity;
  enabledCount: number;
  loadedCount: number;
  issues: string[];
}

function aggregate(status: MlStatus | null): Aggregate {
  if (!status) {
    return { severity: "idle", enabledCount: 0, loadedCount: 0, issues: [] };
  }
  let loading = 0;
  let errors = 0;
  let loaded = 0;
  let unloaded = 0;
  let enabled = 0;
  const issues: string[] = [];
  for (const f of status.features) {
    if (!f.enabled) continue;
    enabled += 1;
    const m = status.models.find(
      (mm) => mm.model_id === f.model_id && mm.backend === f.backend,
    );
    if (!m) continue;
    if (m.state === "loaded") {
      loaded += 1;
      continue;
    }
    if (m.state === "loading" || m.state === "downloading") {
      loading += 1;
      continue;
    }
    if (m.state === "error") {
      errors += 1;
      issues.push(`${f.label}: ${m.error ?? "error"}`);
      continue;
    }
    if (m.state === "not_available") {
      // Backend unavailable on this system. Surfaced in Settings — don't
      // double-report on the header dot.
      issues.push(`${f.label}: backend unavailable`);
      continue;
    }
    unloaded += 1;
    issues.push(`${f.label}: not loaded`);
  }
  let severity: Severity;
  if (enabled === 0) severity = "idle";
  else if (errors > 0) severity = "error";
  else if (loading > 0) severity = "loading";
  else if (unloaded > 0) severity = "warn";
  else severity = "ok";
  return { severity, enabledCount: enabled, loadedCount: loaded, issues };
}

function dotClass(s: Severity): string {
  switch (s) {
    case "ok":
      return "bg-green-500";
    case "loading":
      return "bg-yellow-400 animate-pulse";
    case "warn":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    case "idle":
    default:
      return "bg-gray-500";
  }
}

function tooltip(agg: Aggregate): string {
  if (agg.severity === "idle") return "No ML features enabled";
  if (agg.severity === "ok") {
    return `ML ready (${agg.loadedCount}/${agg.enabledCount} features loaded)`;
  }
  if (agg.severity === "loading") {
    return `ML loading… (${agg.loadedCount}/${agg.enabledCount} ready)`;
  }
  return `${agg.issues.length} ML issue${agg.issues.length === 1 ? "" : "s"}: ${agg.issues
    .slice(0, 2)
    .join("; ")}${agg.issues.length > 2 ? "…" : ""}`;
}

interface MlStatusIndicatorProps {
  onClick: () => void;
}

export function MlStatusIndicator({ onClick }: MlStatusIndicatorProps) {
  const status = useMlFeaturesStore((s) => s.status);
  const refresh = useMlFeaturesStore((s) => s.refresh);
  const agg = useMemo(() => aggregate(status), [status]);

  // Ambient poll so the dot reflects external changes (user pulls a new
  // ollama model from a terminal, daemon restarts, etc.) without requiring
  // the user to open Settings. The Settings panel uses the same store and
  // will see fresh data on its own.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, AMBIENT_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip(agg)}
      data-testid="ml-status-indicator"
      className="flex items-center justify-center w-3 h-3 shrink-0 cursor-pointer"
      aria-label={tooltip(agg)}
    >
      <span className={`block w-3 h-3 rounded-full ${dotClass(agg.severity)}`} />
    </button>
  );
}
