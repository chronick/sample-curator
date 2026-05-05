import { useEffect, useState } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { api } from "../../api/client";

/**
 * Continuous-recording session banner (vault-1ge8 / T1).
 *
 * Visible whenever the recorder is armed AND monitoring. Shows live
 * elapsed time since arm-on, count of clips finalized in this cycle,
 * and pending+running pipeline jobs — confirms the loop is alive
 * without watching the level meter.
 *
 * On disarm, briefly shows a final summary ("Session ended: N clips,
 * M:SS" or "No clips captured"), then hides itself.
 *
 * Reads `sessionStartedAt` / `sessionClipCount` / `sessionEndSummary`
 * straight from the recorder store — those are kept in sync with the
 * arm-on/off lifecycle in the store itself, so this component never
 * needs to invoke a Tauri command for session state. Pipeline counters
 * come from `get_job_stats` polled at a slow cadence.
 */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
};

const END_SUMMARY_TIMEOUT_MS = 5000;
const PIPELINE_POLL_MS = 3000;

export function SessionBanner() {
  const isArmed = useRecorderStore((s) => s.isArmed);
  const isMonitoring = useRecorderStore((s) => s.isMonitoring);
  const sessionStartedAt = useRecorderStore((s) => s.sessionStartedAt);
  const sessionClipCount = useRecorderStore((s) => s.sessionClipCount);
  const sessionEndSummary = useRecorderStore((s) => s.sessionEndSummary);
  const clearSessionEndSummary = useRecorderStore(
    (s) => s.clearSessionEndSummary
  );

  // Live tick for elapsed time. Starts when armed, stops when not.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isArmed || sessionStartedAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isArmed, sessionStartedAt]);

  // Pipeline backlog poll. Only runs while the banner is visible to
  // avoid background DB hits — the rest of the app already shows job
  // stats elsewhere if the user wants the full picture.
  const [pipelinePending, setPipelinePending] = useState<number | null>(null);
  useEffect(() => {
    if (!isArmed || !isMonitoring) {
      setPipelinePending(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await api.getJobStats();
        if (!cancelled) {
          setPipelinePending(resp.stats.pending + resp.stats.running);
        }
      } catch {
        // DB not initialized yet, or worker not started — render
        // nothing rather than an error banner. The user has bigger
        // problems if get_job_stats throws.
        if (!cancelled) setPipelinePending(null);
      }
    };
    tick();
    const id = window.setInterval(tick, PIPELINE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isArmed, isMonitoring]);

  // Auto-clear end summary after a short window so the banner doesn't
  // stick around indefinitely after disarm.
  useEffect(() => {
    if (!sessionEndSummary) return;
    const id = window.setTimeout(
      () => clearSessionEndSummary(),
      END_SUMMARY_TIMEOUT_MS
    );
    return () => window.clearTimeout(id);
  }, [sessionEndSummary, clearSessionEndSummary]);

  // Render decision tree: live banner > end summary > nothing.
  const showLive = isArmed && isMonitoring && sessionStartedAt !== null;

  if (showLive) {
    const elapsedMs = now - sessionStartedAt;
    return (
      <div
        className="px-4 py-1.5 bg-yellow-900/20 border-b border-yellow-700/40 text-xs text-yellow-200 flex items-center gap-4"
        data-testid="session-banner"
      >
        <span className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"
            aria-hidden="true"
          />
          <span className="font-medium tracking-wide uppercase text-[10px]">
            Session
          </span>
        </span>
        <span className="tabular-nums" data-testid="session-elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <span data-testid="session-clip-count">
          {sessionClipCount}{" "}
          {sessionClipCount === 1 ? "clip" : "clips"}
        </span>
        {pipelinePending !== null && pipelinePending > 0 && (
          <span
            className="text-yellow-300/80"
            data-testid="session-pipeline-backlog"
          >
            {pipelinePending} pending
          </span>
        )}
      </div>
    );
  }

  if (sessionEndSummary) {
    const { clipCount, durationMs } = sessionEndSummary;
    const message =
      clipCount === 0
        ? "No clips captured"
        : `Session ended: ${clipCount} ${clipCount === 1 ? "clip" : "clips"}, ${formatElapsed(durationMs)}`;
    return (
      <div
        className="px-4 py-1.5 bg-surface-raised/60 border-b border-surface-border text-xs text-gray-400"
        data-testid="session-banner-summary"
      >
        {message}
      </div>
    );
  }

  return null;
}
