/**
 * Full jobs panel rendered as a top-level view in the central column.
 * Shows active, queued, completed, and failed jobs with actions.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useStore } from "../store";
import type { Job } from "../api/types";

function getJobTypeLabel(jobType: string): string {
  switch (jobType.toLowerCase()) {
    case "embedding": return "Embedding";
    case "spectral": return "Spectral";
    case "clap": return "CLAP";
    case "full": return "Full Analysis";
    default: return jobType;
  }
}

function getJobTypeIcon(jobType: string): string {
  switch (jobType.toLowerCase()) {
    case "embedding": return "\u{1F9E0}";
    case "spectral": return "\u{1F308}";
    case "clap": return "\u{1F50A}";
    case "full": return "\u{1F504}";
    default: return "\u{2699}";
  }
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  try {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function formatDuration(startTs: string | null, endTs: string | null): string {
  if (!startTs) return "";
  const start = new Date(startTs).getTime();
  const end = endTs ? new Date(endTs).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatRelativeTime(ts: string | null): string {
  if (!ts) return "";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

export function JobsPanel() {
  const jobStats = useStore((s) => s.jobStats);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0); // force re-render for elapsed time

  // Fetch jobs when panel mounts
  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true);
      try {
        const [jobList, stats] = await Promise.all([
          api.listJobs(100),
          api.getJobStats(),
        ]);
        setJobs(jobList);
        setWorkerRunning(stats.worker_running);
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, []);

  // Tick every second to update elapsed time on running jobs
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for Tauri events for real-time updates
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("job:progress", async () => {
        try {
          const jobList = await api.listJobs(100);
          setJobs(jobList);
        } catch {}
      }).then((unlisten) => {
        cleanup = unlisten;
      });
    }).catch(() => {});

    return () => { cleanup?.(); };
  }, []);

  const handleStartWorker = useCallback(async () => {
    try {
      await api.startJobWorker();
      setWorkerRunning(true);
    } catch (err) {
      console.error("Failed to start worker:", err);
    }
  }, []);

  const handleStopWorker = useCallback(async () => {
    try {
      await api.stopJobWorker();
      setWorkerRunning(false);
    } catch (err) {
      console.error("Failed to stop worker:", err);
    }
  }, []);

  const handleClearCompleted = useCallback(async () => {
    try {
      await api.cleanupOldJobs(0);
      const jobList = await api.listJobs(100);
      setJobs(jobList);
    } catch (err) {
      console.error("Failed to clear completed jobs:", err);
    }
  }, []);

  const handleResetStuck = useCallback(async () => {
    try {
      await api.resetStuckJobs();
      const jobList = await api.listJobs(100);
      setJobs(jobList);
    } catch (err) {
      console.error("Failed to reset stuck jobs:", err);
    }
  }, []);

  const handleRetryFailed = useCallback(async (job: Job) => {
    if (!job.sample_id) return;
    try {
      await api.queueSampleJob(job.sample_id, job.job_type);
    } catch (err) {
      console.error("Failed to retry job:", err);
    }
  }, []);

  const toggleError = useCallback((jobId: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }, []);

  // Rust serde serializes enum variants as PascalCase; normalize to lowercase
  const normalizeStatus = (s: string) => s.toLowerCase();
  const runningJobs = jobs.filter((j) => normalizeStatus(j.status) === "running");
  const pendingJobs = jobs.filter((j) => normalizeStatus(j.status) === "pending");
  const failedJobs = jobs.filter((j) => normalizeStatus(j.status) === "failed");
  const completedJobs = jobs.filter((j) => normalizeStatus(j.status) === "complete");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border">
        <span className="text-sm font-medium mr-auto">Background Jobs</span>
        <button
          onClick={workerRunning ? handleStopWorker : handleStartWorker}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            workerRunning
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
          }`}
        >
          {workerRunning ? "Stop Worker" : "Start Worker"}
        </button>
        <button
          onClick={handleClearCompleted}
          className="px-2 py-1 rounded text-xs bg-surface hover:bg-surface-hover border border-surface-border transition-colors"
        >
          Clear Done
        </button>
        <button
          onClick={handleResetStuck}
          className="px-2 py-1 rounded text-xs bg-surface hover:bg-surface-hover border border-surface-border transition-colors"
        >
          Reset Stuck
        </button>
      </div>

      {/* Stats bar */}
      {jobStats && (
        <div className="flex items-center gap-4 px-4 py-2 text-xs border-b border-surface-border bg-surface/30">
          <StatBadge label="Running" count={jobStats.running} color="yellow" />
          <StatBadge label="Pending" count={jobStats.pending} color="blue" />
          <StatBadge label="Done" count={jobStats.complete} color="green" />
          {jobStats.failed > 0 && <StatBadge label="Failed" count={jobStats.failed} color="red" />}
          <span className="ml-auto flex items-center gap-1.5 text-gray-500">
            <span className={`w-2 h-2 rounded-full ${workerRunning ? "bg-green-500" : "bg-gray-600"}`} />
            Worker {workerRunning ? "running" : "stopped"}
          </span>
        </div>
      )}

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {loading && jobs.length === 0 ? (
          <div className="p-8 text-sm text-gray-500 text-center">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <EmptyState workerRunning={workerRunning} onStartWorker={handleStartWorker} />
        ) : (
          <>
            {/* Running */}
            {runningJobs.length > 0 && (
              <JobSection title="In Progress" count={runningJobs.length} defaultOpen>
                {runningJobs.map((job) => (
                  <RunningJobCard key={job.id} job={job} />
                ))}
              </JobSection>
            )}

            {/* Pending */}
            {pendingJobs.length > 0 && (
              <JobSection title="Queued" count={pendingJobs.length} defaultOpen>
                {pendingJobs.map((job) => (
                  <PendingJobRow key={job.id} job={job} />
                ))}
              </JobSection>
            )}

            {/* Failed */}
            {failedJobs.length > 0 && (
              <JobSection title="Failed" count={failedJobs.length} defaultOpen>
                {failedJobs.map((job) => (
                  <FailedJobCard
                    key={job.id}
                    job={job}
                    expanded={expandedErrors.has(job.id)}
                    onToggle={() => toggleError(job.id)}
                    onRetry={() => handleRetryFailed(job)}
                  />
                ))}
              </JobSection>
            )}

            {/* Completed */}
            {completedJobs.length > 0 && (
              <JobSection title="Completed" count={completedJobs.length} defaultOpen={completedJobs.length <= 10}>
                {completedJobs.slice(0, 50).map((job) => (
                  <CompletedJobRow key={job.id} job={job} />
                ))}
                {completedJobs.length > 50 && (
                  <div className="px-4 py-2 text-xs text-gray-500 text-center">
                    ...and {completedJobs.length - 50} more
                  </div>
                )}
              </JobSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Sub-components ---- */

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const colors: Record<string, string> = {
    yellow: "bg-yellow-500/10 text-yellow-400",
    blue: "bg-blue-500/10 text-blue-400",
    green: "bg-green-500/10 text-green-400",
    red: "bg-red-500/10 text-red-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color] || ""}`}>
      {count} {label}
    </span>
  );
}

function EmptyState({ workerRunning, onStartWorker }: { workerRunning: boolean; onStartWorker: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="text-3xl mb-3 opacity-30">{"\u{2699}"}</div>
      <div className="text-sm text-gray-400 mb-1">No jobs in queue</div>
      <div className="text-xs text-gray-600 mb-4">
        Jobs are created when you analyze samples or import new files.
      </div>
      {!workerRunning && (
        <button
          onClick={onStartWorker}
          className="px-3 py-1.5 rounded text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
        >
          Start Worker
        </button>
      )}
    </div>
  );
}

function JobSection({ title, count, defaultOpen = true, children }: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-400 bg-surface/50 hover:bg-surface-hover sticky top-0 z-10 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>{"\u25B6"}</span>
        <span className="uppercase tracking-wide">{title}</span>
        <span className="text-gray-600">({count})</span>
      </button>
      {open && children}
    </div>
  );
}

function RunningJobCard({ job }: { job: Job }) {
  return (
    <div className="mx-4 my-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{getJobTypeIcon(job.job_type)}</span>
        <span className="text-sm font-medium text-yellow-300">{getJobTypeLabel(job.job_type)}</span>
        <span className="text-xs text-gray-500">#{job.id}</span>
        {job.sample_id && <span className="text-xs text-gray-500">- sample {job.sample_id}</span>}
        <span className="ml-auto text-xs text-yellow-500/70">
          {formatDuration(job.started_at, null)} elapsed
        </span>
      </div>
      {/* Indeterminate progress bar */}
      <div className="h-1 bg-yellow-500/10 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-yellow-500/50 rounded-full animate-indeterminate" />
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
        <span>Started {formatTimestamp(job.started_at)}</span>
      </div>
    </div>
  );
}

function PendingJobRow({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-surface-hover transition-colors">
      <span>{getJobTypeIcon(job.job_type)}</span>
      <span className="text-gray-300">{getJobTypeLabel(job.job_type)}</span>
      <span className="text-gray-600">#{job.id}</span>
      {job.sample_id && <span className="text-gray-600">sample {job.sample_id}</span>}
      <span className="ml-auto text-gray-600">{formatRelativeTime(job.created_at)}</span>
    </div>
  );
}

function FailedJobCard({ job, expanded, onToggle, onRetry }: {
  job: Job;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mx-4 my-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
      <div className="flex items-center gap-2">
        <span className="text-sm">{getJobTypeIcon(job.job_type)}</span>
        <span className="text-sm font-medium text-red-300">{getJobTypeLabel(job.job_type)}</span>
        <span className="text-xs text-gray-500">#{job.id}</span>
        {job.sample_id && <span className="text-xs text-gray-500">sample {job.sample_id}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {job.sample_id && (
            <button
              onClick={onRetry}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-surface hover:bg-surface-hover border border-surface-border transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
      {job.error_message && (
        <div className="mt-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
          >
            <span className={`transition-transform text-[8px] ${expanded ? "rotate-90" : ""}`}>{"\u25B6"}</span>
            {expanded ? "Hide error" : "Show error"}
          </button>
          {expanded && (
            <pre className="mt-1.5 p-2 bg-red-950/30 border border-red-500/10 rounded text-[11px] text-red-300/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-40 overflow-y-auto">
              {job.error_message}
            </pre>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-600">
        {job.started_at && <span>Started {formatTimestamp(job.started_at)}</span>}
        {job.started_at && job.completed_at && (
          <span>- ran for {formatDuration(job.started_at, job.completed_at)}</span>
        )}
      </div>
    </div>
  );
}

function CompletedJobRow({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-surface-hover transition-colors text-gray-500">
      <span>{getJobTypeIcon(job.job_type)}</span>
      <span>{getJobTypeLabel(job.job_type)}</span>
      <span className="text-gray-600">#{job.id}</span>
      {job.sample_id && <span className="text-gray-600">sample {job.sample_id}</span>}
      <span className="ml-auto flex items-center gap-2 text-gray-600">
        {job.started_at && job.completed_at && (
          <span>{formatDuration(job.started_at, job.completed_at)}</span>
        )}
        <span>{formatRelativeTime(job.completed_at)}</span>
      </span>
    </div>
  );
}

export default JobsPanel;
