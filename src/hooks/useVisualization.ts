import { useEffect, useCallback } from "react";

export function useCanvasResize(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);
}

export function useWaveformRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  data: number[]
) {
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, width, height);

    // Center line
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (data.length === 0) return;

    // Auto-gain: find peak and scale so it fills ~80% of the canvas
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const gain = peak > 0.0001 ? Math.min(0.8 / peak, 200) : 1;

    // Waveform
    ctx.strokeStyle = "#646cff";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();

    const sliceWidth = width / data.length;
    for (let i = 0; i < data.length; i++) {
      const x = i * sliceWidth;
      const amplified = Math.max(-1, Math.min(1, data[i] * gain));
      const y = (1 - amplified) * height / 2;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, [data, canvasRef]);

  useEffect(() => {
    draw();
  }, [draw]);
}

export function useSpectrumRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  data: number[],
  prevDataRef: React.MutableRefObject<number[]>
) {
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) return;

    // Smooth falloff
    const smoothed = data.map((val, i) => {
      const prev = prevDataRef.current[i] || 0;
      return Math.max(val, prev * 0.85);
    });
    prevDataRef.current = smoothed;

    const barWidth = width / smoothed.length;
    const gap = Math.max(1, barWidth * 0.1);

    // Find peak for auto-gain
    let specPeak = 0;
    for (let i = 0; i < smoothed.length; i++) {
      if (smoothed[i] > specPeak) specPeak = smoothed[i];
    }
    const specGain = specPeak > 0.00001 ? Math.min(1.0 / specPeak, 5000) : 1;

    for (let i = 0; i < smoothed.length; i++) {
      // Apply gain then sqrt for better dynamic range visibility
      const scaled = Math.min(smoothed[i] * specGain, 1);
      const magnitude = Math.sqrt(scaled);
      const barHeight = magnitude * height;
      const x = i * barWidth;
      const y = height - barHeight;

      ctx.fillStyle = "#646cff";
      ctx.fillRect(x + gap / 2, y, barWidth - gap, barHeight);
    }
  }, [data, canvasRef, prevDataRef]);

  useEffect(() => {
    draw();
  }, [draw]);
}
