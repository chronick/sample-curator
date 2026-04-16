import { useRecorderStore } from "../../store/recorderStore";
import { useStore } from "../../store";
import { usePlayer } from "../../hooks/usePlayer";
import { api } from "../../api";
import type { RecordingEntry } from "../../types/recorder";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getFilename(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * Visual identifier for how the filename was generated. Small + subtle so
 * it doesn't compete with the filename, but lets the user audit quality
 * (seeing lots of "heroku" means the heuristic isn't firing; seeing "clap"
 * means CLAP inference is installed and confident).
 */
function NamingBadge({ method }: { method: string }) {
  const palette: Record<string, string> = {
    clap: "bg-violet-900/40 text-violet-300 border-violet-700/50",
    heuristic: "bg-blue-900/40 text-blue-300 border-blue-700/50",
    heroku: "bg-amber-900/40 text-amber-300 border-amber-700/50",
    "heroku-fallback": "bg-gray-800/60 text-gray-400 border-gray-600",
  };
  const cls = palette[method] ?? "bg-gray-800/60 text-gray-400 border-gray-600";
  return (
    <span
      className={`ml-2 px-1.5 py-0.5 rounded border text-[9px] tracking-wide uppercase ${cls}`}
      title={`Named by: ${method}`}
    >
      {method}
    </span>
  );
}

function InlinePlayer({ rec }: { rec: RecordingEntry }) {
  const { isPlaying, currentSample, play, pause, resume, progress } = usePlayer();
  const isThisPlaying = isPlaying && currentSample === rec.path;

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rec.saving) return; // File is being renamed; avoid 404 on stale path.
    if (isThisPlaying) {
      pause();
    } else if (currentSample === rec.path) {
      resume();
    } else {
      play(rec.path);
    }
  };

  const label = rec.saving
    ? "Saving…"
    : isThisPlaying
      ? "Pause"
      : "Play";

  return (
    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-surface-border">
      <button
        onClick={handlePlayPause}
        disabled={!!rec.saving}
        className={`text-xs font-medium ${
          rec.saving
            ? "text-gray-500 cursor-not-allowed"
            : "text-accent hover:text-accent-hover"
        }`}
      >
        {label}
      </button>
      <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: `${(isThisPlaying ? progress : 0) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function RecordingsList() {
  const recordings = useRecorderStore((s) => s.recentRecordings);
  const lastSaved = useRecorderStore((s) => s.lastSavedSample);
  const expandedIndex = useRecorderStore((s) => s.expandedRecordingIndex);
  const setExpandedIndex = useRecorderStore((s) => s.setExpandedRecordingIndex);

  const handleClick = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
  };

  const handleDoubleClick = async (rec: RecordingEntry) => {
    if (!rec.sample_id) return;
    try {
      const sample = await api.getSample(rec.sample_id);
      useStore.getState().setSelectedSample(sample);
      useStore.getState().setActiveView("browse");
    } catch (e) {
      console.warn("Failed to navigate to sample:", e);
    }
  };

  if (recordings.length === 0) {
    return (
      <div className="text-xs text-gray-600 py-2">
        No recordings yet
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto py-1">
      {recordings.map((rec, i) => (
        <div
          key={i}
          onClick={() => handleClick(i)}
          onDoubleClick={() => handleDoubleClick(rec)}
          className={`flex-shrink-0 bg-surface-raised rounded px-3 py-1.5 text-xs border cursor-pointer transition-colors ${
            expandedIndex === i
              ? "border-accent/70"
              : rec.saving
                ? "border-amber-700/40"
                : "border-surface-border hover:border-accent/50"
          }`}
        >
          <div className="flex items-center">
            <span className={rec.saving ? "text-gray-500 italic" : "text-gray-300"}>
              {getFilename(rec.path)}
            </span>
            <span className="text-gray-500 ml-2">
              ({formatDuration(rec.duration_secs)})
            </span>
            {rec.naming_method && <NamingBadge method={rec.naming_method} />}
            {lastSaved && lastSaved.path === rec.path && (
              <span className="ml-2 text-green-400 text-[10px] font-medium">Saved</span>
            )}
          </div>
          {expandedIndex === i && <InlinePlayer rec={rec} />}
        </div>
      ))}
    </div>
  );
}
