import { useRef } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { useCanvasResize, useWaveformRenderer } from "../../hooks/useVisualization";

export function WaveformDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformData = useRecorderStore((s) => s.waveformData);

  useCanvasResize(canvasRef);
  useWaveformRenderer(canvasRef, waveformData);

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">Waveform</div>
      <canvas
        ref={canvasRef}
        className="w-full h-24 bg-surface rounded border border-surface-border"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
