/**
 * Waveform visualization component.
 *
 * Supports two data sources:
 * - Native Rust (fast): Direct call to sample-analysis-core via Tauri
 * - Sidecar (slower): Python JSON-RPC call via sidecar
 */

import { useRef, useEffect, useState } from "react";
import type { Sample, WaveformData, SpectrogramData } from "../api/types";
import { api } from "../api";
import { getNativeWaveform, getNativeSpectrogram } from "../hooks/useNativeAnalysis";

type ViewMode = "waveform" | "spectrogram";
type DataSource = "native" | "sidecar";

// Simple in-memory cache for waveform and spectrogram data
const waveformCache = new Map<string, WaveformData>();
const spectrogramCache = new Map<string, SpectrogramData>();

function getCacheKey(path: string, width: number, height?: number, source?: string): string {
  return `${source || "native"}:${path}:${width}${height ? `:${height}` : ""}`;
}

interface WaveformViewProps {
  sample: Sample;
  isPlaying: boolean;
  progress: number;
  onSeek: (position: number) => void;
  onPlay?: () => void;
  /** Use native Rust analysis (fast) or Python sidecar (slower). Default: native */
  useNative?: boolean;
}

export function WaveformView({ sample, isPlaying, progress, onSeek, onPlay, useNative = true }: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [spectrogram, setSpectrogram] = useState<SpectrogramData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("waveform");
  const [dataSource, setDataSource] = useState<DataSource>(useNative ? "native" : "sidecar");
  const [loading, setLoading] = useState(false);
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 150 });

  // Track container size with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Fetch waveform data when sample or canvas size changes
  useEffect(() => {
    if (canvasSize.width <= 0) return;

    let cancelled = false;

    async function fetchWaveform() {
      const cacheKey = getCacheKey(sample.path, canvasSize.width, undefined, dataSource);

      // Check cache first
      const cached = waveformCache.get(cacheKey);
      if (cached) {
        console.log(`[${dataSource}] Waveform cache hit`);
        setWaveform(cached);
        setLoadTime(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadTime(null);
      const startTime = performance.now();

      try {
        let data: WaveformData;

        if (dataSource === "native") {
          // Use native Rust analyzer (fast)
          console.log("[Native] Fetching waveform for:", sample.path, "width:", canvasSize.width);
          const nativeResult = await getNativeWaveform(sample.path, canvasSize.width);
          data = { peaks: nativeResult.data, duration: nativeResult.duration };
        } else {
          // Use Python sidecar (slower)
          console.log("[Sidecar] Fetching waveform for sample:", sample.id, "width:", canvasSize.width);
          data = await api.getWaveform(sample.id, canvasSize.width);
        }

        const elapsed = performance.now() - startTime;
        console.log(`[${dataSource}] Waveform loaded in ${elapsed.toFixed(1)}ms`);

        // Cache the result
        waveformCache.set(cacheKey, data);

        if (!cancelled) {
          setWaveform(data);
          setLoadTime(elapsed);
        }
      } catch (err) {
        console.error(`[${dataSource}] Failed to load waveform:`, err);
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
  }, [sample.id, sample.path, canvasSize.width, dataSource]);

  // Fetch spectrogram data when mode changes
  useEffect(() => {
    if (viewMode !== "spectrogram" || canvasSize.width <= 0) return;

    let cancelled = false;

    async function fetchSpectrogram() {
      const cacheKey = getCacheKey(sample.path, canvasSize.width, canvasSize.height, dataSource);

      // Check cache first
      const cached = spectrogramCache.get(cacheKey);
      if (cached) {
        console.log(`[${dataSource}] Spectrogram cache hit`);
        setSpectrogram(cached);
        setLoadTime(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadTime(null);
      const startTime = performance.now();

      try {
        let data: SpectrogramData;

        if (dataSource === "native") {
          // Use native Rust analyzer (fast)
          console.log("[Native] Fetching spectrogram for:", sample.path);
          const nativeResult = await getNativeSpectrogram(sample.path, canvasSize.width, canvasSize.height);
          data = {
            spectrogram: nativeResult.spectrogram,
            duration: nativeResult.duration,
            width: nativeResult.width,
            height: nativeResult.height,
          };
        } else {
          // Use Python sidecar (slower)
          console.log("[Sidecar] Fetching spectrogram for sample:", sample.id);
          data = await api.getSpectrogram(sample.id, canvasSize.width, canvasSize.height);
        }

        const elapsed = performance.now() - startTime;
        console.log(`[${dataSource}] Spectrogram loaded in ${elapsed.toFixed(1)}ms`);

        // Cache the result
        spectrogramCache.set(cacheKey, data);

        if (!cancelled) {
          setSpectrogram(data);
          setLoadTime(elapsed);
        }
      } catch (err) {
        console.error(`[${dataSource}] Failed to load spectrogram:`, err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSpectrogram();

    return () => {
      cancelled = true;
    };
  }, [sample.id, sample.path, viewMode, canvasSize.width, canvasSize.height, dataSource]);

  // Color mapping for spectrogram (value 0-1 to RGB)
  const valueToColor = (value: number): string => {
    // Map value to a color gradient: blue -> cyan -> green -> yellow -> orange -> red
    const hue = (1 - value) * 240; // 240 (blue) to 0 (red)
    const saturation = 80;
    const lightness = 10 + value * 50; // Darker for low values
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  // Draw waveform or spectrogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    console.log("Drawing canvas:", { width, height, viewMode, hasPeaks: !!waveform?.peaks?.length });

    // Clear with dark background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    if (viewMode === "waveform") {
      if (!waveform || !waveform.peaks || waveform.peaks.length === 0) {
        // Draw "no data" message
        ctx.fillStyle = "#666";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No waveform data", width / 2, height / 2);
        return;
      }

      const { peaks } = waveform;
      const midY = height / 2;
      const barWidth = Math.max(1, width / peaks.length);

      // Draw center line
      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      // Draw waveform bars
      ctx.fillStyle = "#646cff";

      for (let i = 0; i < peaks.length; i++) {
        const x = i * barWidth;
        const barHeight = Math.max(1, peaks[i] * midY * 0.9);

        // Draw symmetric bar
        ctx.fillRect(x, midY - barHeight, Math.max(1, barWidth - 1), barHeight * 2);
      }
    } else if (viewMode === "spectrogram") {
      if (!spectrogram || !spectrogram.spectrogram) {
        ctx.fillStyle = "#666";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No spectrogram data", width / 2, height / 2);
        return;
      }

      const { spectrogram: data } = spectrogram;
      const numFreqBins = data.length;
      const numTimeFrames = data[0]?.length || 0;

      if (numFreqBins === 0 || numTimeFrames === 0) return;

      const pixelWidth = width / numTimeFrames;
      const pixelHeight = height / numFreqBins;

      // Draw spectrogram (row 0 = low freq at bottom)
      for (let freqIdx = 0; freqIdx < numFreqBins; freqIdx++) {
        for (let timeIdx = 0; timeIdx < numTimeFrames; timeIdx++) {
          const value = data[freqIdx][timeIdx];
          ctx.fillStyle = valueToColor(value);
          const y = height - (freqIdx + 1) * pixelHeight;
          ctx.fillRect(timeIdx * pixelWidth, y, pixelWidth + 0.5, pixelHeight + 0.5);
        }
      }
    }

    // Draw playhead when playing or after seeking
    if (progress > 0) {
      const playX = progress * width;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(playX, 0, 2, height);
    }
  }, [waveform, spectrogram, viewMode, isPlaying, progress, canvasSize]);

  // Handle click to play and seek
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = x / rect.width;

    // Start playback if not playing, then seek
    if (onPlay) {
      onPlay();
    }
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
    <div className="h-full flex flex-col">
      {/* Sample info and view toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium truncate">
          {sample.path.split("/").pop()}
        </span>
        <div className="flex items-center gap-2">
          {/* Data source toggle */}
          <div className="flex bg-surface border border-surface-border rounded overflow-hidden">
            <button
              onClick={() => setDataSource("native")}
              className={`px-2 py-0.5 text-xs transition-colors ${
                dataSource === "native"
                  ? "bg-green-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
              title="Native Rust (fast)"
            >
              Native
            </button>
            <button
              onClick={() => setDataSource("sidecar")}
              className={`px-2 py-0.5 text-xs transition-colors ${
                dataSource === "sidecar"
                  ? "bg-yellow-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
              title="Python Sidecar (slower)"
            >
              Sidecar
            </button>
          </div>
          {/* View mode toggle */}
          <div className="flex bg-surface border border-surface-border rounded overflow-hidden">
            <button
              onClick={() => setViewMode("waveform")}
              className={`px-2 py-0.5 text-xs transition-colors ${
                viewMode === "waveform"
                  ? "bg-accent text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Wave
            </button>
            <button
              onClick={() => setViewMode("spectrogram")}
              className={`px-2 py-0.5 text-xs transition-colors ${
                viewMode === "spectrogram"
                  ? "bg-accent text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Spec
            </button>
          </div>
          {/* Load time indicator */}
          {loadTime !== null && (
            <span className={`text-xs ${loadTime < 50 ? "text-green-400" : loadTime < 200 ? "text-yellow-400" : "text-red-400"}`}>
              {loadTime.toFixed(0)}ms
            </span>
          )}
          <span className="text-xs text-gray-400">
            {formatDuration(sample.duration)}
          </span>
        </div>
      </div>

      {/* Waveform canvas */}
      <div className="flex-1 relative" ref={containerRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-raised rounded text-gray-500 text-sm z-10">
            Loading...
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="w-full h-full cursor-pointer rounded"
          onClick={handleClick}
        />
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
