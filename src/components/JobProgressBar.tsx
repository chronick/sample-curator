/**
 * Thin progress bar + text shown in the HeaderBar when jobs are processing.
 * Clickable to toggle the jobs panel.
 */

import { useStore } from "../store";

export function JobProgressBar() {
  const jobStats = useStore((s) => s.jobStats);
  const setActiveView = useStore((s) => s.setActiveView);

  if (!jobStats) return null;

  const { pending, running, complete, failed } = jobStats;
  const active = pending + running;
  if (active === 0) return null;

  const total = pending + running + complete + failed;
  const done = complete + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <button
      onClick={() => setActiveView("jobs")}
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors text-xs"
      title="Click to view job details"
    >
      {/* Progress bar */}
      <div className="w-24 h-1.5 bg-surface-border rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Text */}
      <span className="text-gray-400 whitespace-nowrap">
        {running > 0 ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse inline-block mr-1" />
            {done} of {total} jobs
          </>
        ) : (
          `${pending} queued`
        )}
      </span>
    </button>
  );
}
