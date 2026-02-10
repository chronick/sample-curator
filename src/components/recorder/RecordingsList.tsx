import { useRecorderStore } from "../../store/recorderStore";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getFilename(path: string): string {
  return path.split("/").pop() || path;
}

export function RecordingsList() {
  const recordings = useRecorderStore((s) => s.recentRecordings);
  const lastSaved = useRecorderStore((s) => s.lastSavedSample);

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
          className="flex-shrink-0 bg-surface-raised rounded px-3 py-1.5 text-xs border border-surface-border hover:border-accent/50 cursor-default"
        >
          <span className="text-gray-300">{getFilename(rec.path)}</span>
          <span className="text-gray-500 ml-2">
            ({formatDuration(rec.duration_secs)})
          </span>
          {lastSaved && lastSaved.path === rec.path && (
            <span className="ml-2 text-green-400 text-[10px] font-medium">Saved</span>
          )}
        </div>
      ))}
    </div>
  );
}
