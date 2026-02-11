import { useRef } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { useCanvasResize, useWaveformRenderer } from "../../hooks/useVisualization";
import { useRecordingWaveformRenderer } from "../../hooks/useRecordingWaveformRenderer";

export function WaveformDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformData = useRecorderStore((s) => s.waveformData);
  const isRecording = useRecorderStore((s) => s.isRecording);
  const recordingWaveform = useRecorderStore((s) => s.recordingWaveform);

  useCanvasResize(canvasRef);

  // Both hooks always called (React rules) — they receive empty data for the inactive mode.
  useWaveformRenderer(canvasRef, isRecording ? [] : waveformData);
  useRecordingWaveformRenderer(canvasRef, isRecording ? recordingWaveform : null);

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
