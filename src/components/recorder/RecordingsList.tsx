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

function InlinePlayer({ rec }: { rec: RecordingEntry }) {
  const { isPlaying, currentSample, play, pause, resume, progress } = usePlayer();
  const isThisPlaying = isPlaying && currentSample === rec.path;

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isThisPlaying) {
      pause();
    } else if (currentSample === rec.path) {
      resume();
    } else {
      play(rec.path);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-surface-border">
      <button
        onClick={handlePlayPause}
        className="text-accent hover:text-accent-hover text-xs font-medium"
      >
        {isThisPlaying ? "Pause" : "Play"}
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
              : "border-surface-border hover:border-accent/50"
          }`}
        >
          <div>
            <span className="text-gray-300">{getFilename(rec.path)}</span>
            <span className="text-gray-500 ml-2">
              ({formatDuration(rec.duration_secs)})
            </span>
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
