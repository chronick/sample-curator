import { useRef } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { useCanvasResize, useWaveformRenderer } from "../../hooks/useVisualization";
import { useRecordingWaveformRenderer } from "../../hooks/useRecordingWaveformRenderer";

export function WaveformDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformData = useRecorderStore((s) => s.waveformData);
  const isRecording = useRecorderStore((s) => s.isRecording);

  useCanvasResize(canvasRef);

  // Live waveform: passes empty data when recording (renderer is a no-op for [])
  useWaveformRenderer(canvasRef, isRecording ? [] : waveformData);
  // Recording waveform: runs its own rAF loop, reads from store.getState() — no re-renders
  useRecordingWaveformRenderer(canvasRef, isRecording);

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">
        {isRecording ? "Recording" : "Waveform"}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-24 bg-surface rounded border border-surface-border"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
