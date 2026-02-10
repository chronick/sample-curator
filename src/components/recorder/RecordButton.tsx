import { useEffect } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { useRecorder } from "../../hooks/useRecorder";
import { useStore } from "../../store";

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return [h, m, s].map((v) => v.toString().padStart(2, "0")).join(":");
}

export function RecordButton() {
  const isRecording = useRecorderStore((s) => s.isRecording);
  const isMonitoring = useRecorderStore((s) => s.isMonitoring);
  const elapsedTime = useRecorderStore((s) => s.elapsedTime);
  const activeView = useStore((s) => s.activeView);
  const { startRecording, stopRecording } = useRecorder();

  // Keyboard shortcuts - only active when in record view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeView !== "record") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "r" || e.key === "R") {
        if (!isRecording && isMonitoring) startRecording();
      } else if (e.key === " ") {
        e.preventDefault();
        if (isRecording) stopRecording();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isRecording, isMonitoring, startRecording, stopRecording, activeView]);

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handleClick}
        disabled={!isMonitoring}
        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
          isRecording
            ? "bg-red-600 hover:bg-red-700 animate-pulse shadow-lg shadow-red-600/30"
            : isMonitoring
            ? "bg-accent hover:bg-accent-hover shadow-lg shadow-accent/30"
            : "bg-gray-600 cursor-not-allowed opacity-50"
        }`}
      >
        {isRecording ? (
          <div className="w-6 h-6 bg-white rounded-sm" />
        ) : (
          <div className="w-6 h-6 bg-white rounded-full" />
        )}
      </button>
      <div className="text-lg font-mono text-gray-300 tabular-nums">
        {formatTime(elapsedTime)}
      </div>
      <div className="text-xs text-gray-500">
        {isRecording ? "Space to stop" : isMonitoring ? "R to record" : "Select a device"}
      </div>
    </div>
  );
}
