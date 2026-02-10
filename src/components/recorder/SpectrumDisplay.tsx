import { useRef } from "react";
import { useRecorderStore } from "../../store/recorderStore";
import { useCanvasResize, useSpectrumRenderer } from "../../hooks/useVisualization";

export function SpectrumDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumData = useRecorderStore((s) => s.spectrumData);
  const prevDataRef = useRef<number[]>([]);

  useCanvasResize(canvasRef);
  useSpectrumRenderer(canvasRef, spectrumData, prevDataRef);

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">Frequency Spectrum</div>
      <canvas
        ref={canvasRef}
        className="w-full h-20 bg-surface rounded border border-surface-border"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
