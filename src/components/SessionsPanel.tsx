import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { SessionSummary, CurrentSessionContext } from "../api/client";
import type { Sample } from "../api/types";
import { useStore } from "../store";
import { SessionsList } from "./SessionsList";
import { SessionTimeline } from "./SessionTimeline";

const ACTIVE_POLL_MS = 5000;

/**
 * Sessions view composite — sidebar list of recording sessions on the
 * left, horizontal timeline of clips for the selected session on the
 * right. Clicking a clip-tick selects it in the existing right details
 * panel via `useStore.setSelectedSample`.
 *
 * Active-session integration:
 * - Polls `session_current()` every 5s so the in-progress placeholder
 *   appears the moment the user arms.
 * - Once the first clip lands during an arm cycle, `session_list` will
 *   include it as a normal row (with a live-pulse indicator), and the
 *   placeholder disappears.
 *
 * Refresh model: list and clips re-fetch when the panel mounts and on
 * an explicit refresh call. We intentionally don't poll session_list
 * — sessions are append-mostly and the user already gets new-clip
 * feedback from the SessionBanner. Re-mounting the view (or hitting
 * the refresh chip in HeaderBar — wired upstream via `setActiveView`)
 * picks up new state.
 */
export function SessionsPanel() {
  const setSelectedSample = useStore((s) => s.setSelectedSample);
  const selectedSample = useStore((s) => s.selectedSample);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] =
    useState<CurrentSessionContext | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [clips, setClips] = useState<Sample[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: fetch sessions + active-session snapshot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, current] = await Promise.all([
          api.sessionList(),
          api.sessionCurrent(),
        ]);
        if (cancelled) return;
        setSessions(list);
        setActiveSession(current);
        // Auto-select the first session if none selected — gives the
        // panel something useful to render on first open.
        if (list.length > 0 && selectedTag === null) {
          setSelectedTag(list[0].session_tag);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount; selectedTag is only set via this effect's
    // first-row auto-select, so re-running on change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lightweight active-session poll so the in-progress placeholder
  // appears live without requiring a manual refresh.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const current = await api.sessionCurrent();
        if (!cancelled) setActiveSession(current);
      } catch {
        // Backend may not be ready (DB warming up). The placeholder
        // just won't render — not an error to surface.
      }
    };
    const id = window.setInterval(tick, ACTIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Fetch clips when selected session changes.
  useEffect(() => {
    if (selectedTag === null) {
      setClips([]);
      return;
    }
    let cancelled = false;
    setClipsLoading(true);
    (async () => {
      try {
        const result = await api.sessionGet(selectedTag);
        if (!cancelled) {
          setClips(result);
          // Clear the selected sample when switching sessions so the
          // right details panel doesn't stick on a clip from another
          // session — the user will pick a fresh one.
          setSelectedSample(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setClipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTag, setSelectedSample]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.session_tag === selectedTag) ?? null,
    [sessions, selectedTag]
  );

  if (error) {
    return (
      <div
        className="p-4 text-xs text-red-400"
        data-testid="sessions-panel-error"
      >
        Failed to load sessions: {error}
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 min-h-0 bg-surface text-white"
      data-testid="sessions-panel"
    >
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-surface-border flex flex-col">
        <div className="px-3 py-2 border-b border-surface-border text-xs font-medium uppercase tracking-wide text-gray-400">
          Sessions
        </div>
        <SessionsList
          sessions={sessions}
          activeSession={activeSession}
          selectedTag={selectedTag}
          onSelect={setSelectedTag}
          loading={listLoading}
        />
      </aside>

      {/* Timeline */}
      <main className="flex-1 min-w-0 flex flex-col">
        {selectedSession ? (
          <SessionTimeline
            session={selectedSession}
            clips={clips}
            selectedSampleId={selectedSample?.id ?? null}
            onSelectClip={setSelectedSample}
            loading={clipsLoading}
          />
        ) : (
          <div
            className="flex-1 flex items-center justify-center text-xs text-gray-500"
            data-testid="sessions-panel-empty-detail"
          >
            Select a session from the list to view its timeline.
          </div>
        )}
      </main>
    </div>
  );
}
