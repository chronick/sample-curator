import type { SessionSummary, CurrentSessionContext } from "../api/client";

interface SessionsListProps {
  sessions: SessionSummary[];
  /** Snapshot of the active arm-cycle session (`session_current()` RPC). */
  activeSession: CurrentSessionContext | null;
  selectedTag: string | null;
  onSelect: (sessionTag: string) => void;
  loading: boolean;
}

/**
 * Format a SQLite UTC timestamp as a brief local-time label.
 * SQLite uses "YYYY-MM-DD HH:MM:SS" (no timezone, implicitly UTC).
 * We render in the user's local TZ for human readability.
 */
function formatTimestamp(raw: string): string {
  const utc = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(utc.getTime())) return raw;
  return utc.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Span between first and last clip in a session, formatted as "Xm Ys".
 * Hides seconds for spans >= 1h to keep the row compact.
 */
function formatSpan(firstRaw: string, lastRaw: string): string {
  const first = new Date(firstRaw.replace(" ", "T") + "Z");
  const last = new Date(lastRaw.replace(" ", "T") + "Z");
  const ms = last.getTime() - first.getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SessionsList({
  sessions,
  activeSession,
  selectedTag,
  onSelect,
  loading,
}: SessionsListProps) {
  // The active session is shown as a placeholder row at the top *only* when
  // it has no clips yet (i.e. its session_tag isn't already in the list).
  // Once the first clip lands, session_list returns it as a normal row,
  // which we keep in place but mark with a live-pulse indicator.
  const activeTagInList =
    activeSession !== null &&
    sessions.some((s) => s.session_tag === activeSession.session_tag);

  const showInProgressPlaceholder =
    activeSession !== null && !activeTagInList;

  if (loading) {
    return (
      <div
        className="px-3 py-4 text-xs text-gray-500"
        data-testid="sessions-list-loading"
      >
        Loading sessions…
      </div>
    );
  }

  if (sessions.length === 0 && activeSession === null) {
    return (
      <div
        className="px-3 py-8 text-center text-xs text-gray-500"
        data-testid="sessions-list-empty"
      >
        No sessions yet. Arm the recorder to start one.
      </div>
    );
  }

  return (
    <ul
      className="flex-1 overflow-y-auto divide-y divide-surface-border"
      data-testid="sessions-list"
    >
      {showInProgressPlaceholder && (
        <li
          className="px-3 py-2 bg-yellow-900/10 text-xs"
          data-testid="sessions-list-active-placeholder"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"
              aria-hidden="true"
            />
            <span className="font-medium text-yellow-200">
              In progress
            </span>
            <span className="text-gray-500">0 clips</span>
          </div>
          <div className="text-gray-500 mt-0.5 truncate">
            {activeSession!.session_tag}
          </div>
        </li>
      )}
      {sessions.map((session) => {
        const isSelected = session.session_tag === selectedTag;
        const isActive =
          activeSession !== null &&
          activeSession.session_tag === session.session_tag;
        return (
          <li key={session.session_tag} data-testid="sessions-list-row">
            <button
              onClick={() => onSelect(session.session_tag)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                isSelected
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-gray-300"
              }`}
              aria-current={isSelected ? "true" : undefined}
            >
              <div className="flex items-center gap-2">
                {isActive && (
                  <span
                    className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0"
                    aria-label="active session"
                  />
                )}
                <span className="font-medium truncate flex-1">
                  {session.derived_name}
                </span>
                <span className="text-gray-500 tabular-nums flex-shrink-0">
                  {session.clip_count}{" "}
                  {session.clip_count === 1 ? "clip" : "clips"}
                </span>
              </div>
              <div className="text-gray-500 mt-0.5 flex items-center justify-between">
                <span>{formatTimestamp(session.first_clip_at)}</span>
                <span className="tabular-nums">
                  {formatSpan(session.first_clip_at, session.last_clip_at)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
