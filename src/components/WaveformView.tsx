/**
 * Waveform visualization component.
 */

import { useRef, useEffect, useState } from "react";
import type { Sample, WaveformData } from "../api/types";
import { api } from "../api";

interface WaveformViewProps {
  sample: Sample;
  isPlaying: boolean;
  onSeek: (position: number) => void;
}

export function WaveformView({ sample, isPlaying, onSeek }: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);
  const [playheadPosition] = useState(0);

  // Fetch waveform data
  useEffect(() => {
    let cancelled = false;

    async function fetchWaveform() {
      setLoading(true);
      try {
        const width = containerRef.current?.offsetWidth || 800;
        const data = await api.getWaveform(sample.id, width);
        if (!cancelled) {
          setWaveform(data);
        }
      } catch (err) {
        console.error("Failed to load waveform:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchWaveform();

    return () => {
      cancelled = true;
    };
  }, [sample.id]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const { peaks } = waveform;

    // Clear
    ctx.fillStyle = "#242424";
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    const midY = height / 2;
    const barWidth = width / peaks.length;

    ctx.fillStyle = "#646cff";

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const barHeight = peaks[i] * midY;

      // Draw symmetric bar
      ctx.fillRect(x, midY - barHeight, barWidth - 1, barHeight * 2);
    }

    // Draw playhead
    if (isPlaying) {
      const playX = playheadPosition * width;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(playX, 0, 2, height);
    }
  }, [waveform, isPlaying, playheadPosition]);

  // Handle click to seek
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = x / rect.width;
    onSeek(position);
  };

  // Format duration
  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-full flex flex-col" ref={containerRef}>
      {/* Sample info */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium truncate">
          {sample.path.split("/").pop()}
        </span>
        <span className="text-xs text-gray-400">
          {formatDuration(sample.duration)}
        </span>
      </div>

      {/* Waveform canvas */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-raised rounded text-gray-500 text-sm">
            Loading waveform...
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={containerRef.current?.offsetWidth || 800}
            height={100}
            className="w-full h-full cursor-pointer rounded"
            onClick={handleClick}
          />
        )}
      </div>

      {/* Sample details */}
      <div className="flex gap-4 mt-2 text-xs text-gray-400">
        {sample.bpm && <span>BPM: {Math.round(sample.bpm)}</span>}
        {sample.key && <span>Key: {sample.key}</span>}
        {sample.sample_rate && (
          <span>{Math.round(sample.sample_rate / 1000)}kHz</span>
        )}
        {sample.channels && (
          <span>{sample.channels === 1 ? "Mono" : "Stereo"}</span>
        )}
      </div>
    </div>
  );
}

export default WaveformView;
