import { useEffect, useRef } from "react";
import { useRecorderStore } from "../store/recorderStore";
import type { RecordingWaveformData } from "../types/recorder";

/**
 * Map spectral centroid frequency to HSL hue for Ableton-style coloring.
 * <200Hz → red (hue 0)
 * 200-1000Hz → orange-yellow (hue 30-60)
 * 1000-4000Hz → yellow-cyan (hue 60-180)
 * >4000Hz → blue (hue 240)
 */
function centroidToHue(centroid: number): number {
  if (centroid <= 0) return 0;
  if (centroid < 200) return 0;
  if (centroid < 1000) {
    return ((centroid - 200) / 800) * 60;
  }
  if (centroid < 4000) {
    return 60 + ((centroid - 1000) / 3000) * 120;
  }
  const t = Math.min((centroid - 4000) / 8000, 1);
  return 180 + t * 60;
}

function drawRecordingWaveform(
  canvas: HTMLCanvasElement | null,
  data: RecordingWaveformData | null
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);

  // Center line
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  if (!data || data.peaks.length === 0) return;

  const { peaks, centroids } = data;
  const numBars = peaks.length;

  // Auto-gain normalization
  let maxPeak = 0;
  for (let i = 0; i < numBars; i++) {
    if (peaks[i] > maxPeak) maxPeak = peaks[i];
  }
  const gain = maxPeak > 0.0001 ? Math.min(0.85 / maxPeak, 200) : 1;

  const barWidth = width / 800;
  const gap = Math.max(0.5, barWidth * 0.15);
  const centerY = height / 2;

  for (let i = 0; i < numBars; i++) {
    const amplitude = Math.min(peaks[i] * gain, 1);
    const barHeight = amplitude * centerY;
    const x = i * barWidth;

    const hue = centroidToHue(centroids[i]);
    ctx.fillStyle = `hsl(${hue}, 75%, 55%)`;
    ctx.fillRect(
      x + gap / 2,
      centerY - barHeight,
      barWidth - gap,
      barHeight * 2
    );
  }
}

/**
 * Recording waveform renderer that bypasses React re-renders entirely.
 * Runs its own rAF loop when recording, reading directly from the Zustand store
 * via getState() instead of subscribing to state changes.
 * Only redraws when the data reference changes (new poll result).
 */
export function useRecordingWaveformRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  isRecording: boolean
) {
  const lastDataRef = useRef<RecordingWaveformData | null>(null);

  useEffect(() => {
    if (!isRecording) {
      lastDataRef.current = null;
      return;
    }

    let animFrame: number;
    const draw = () => {
      const data = useRecorderStore.getState().recordingWaveform;
      // Only redraw when the store has new data (reference changed)
      if (data !== lastDataRef.current) {
        lastDataRef.current = data;
        drawRecordingWaveform(canvasRef.current, data);
      }
      animFrame = requestAnimationFrame(draw);
    };
    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [isRecording, canvasRef]);
}
