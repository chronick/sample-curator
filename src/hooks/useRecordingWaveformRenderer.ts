import { useEffect, useCallback } from "react";
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
    // 200-1000 → hue 0-60
    return ((centroid - 200) / 800) * 60;
  }
  if (centroid < 4000) {
    // 1000-4000 → hue 60-180
    return 60 + ((centroid - 1000) / 3000) * 120;
  }
  // >4000 → hue 180-240
  const t = Math.min((centroid - 4000) / 8000, 1);
  return 180 + t * 60;
}

/**
 * Custom hook that draws Ableton-style growing waveform bars with centroid coloring.
 * T0 at far left, waveform grows rightward.
 * Symmetric bars around center line with auto-gain.
 */
export function useRecordingWaveformRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  data: RecordingWaveformData | null
) {
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
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

    const barWidth = width / 800; // Always lay out for 800 bars (max)
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
  }, [data, canvasRef]);

  useEffect(() => {
    draw();
  }, [draw]);
}
