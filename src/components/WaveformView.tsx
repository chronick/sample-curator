/**
 * Waveform visualization component.
 *
 * Uses native Rust analysis via Tauri for fast waveform and spectrogram rendering.
 */

import { useRef, useEffect, useState } from "react";
import type { Sample, WaveformData, SpectrogramData } from "../api/types";
import { getNativeSpectrogram, getNativeFrequencyWaveform } from "../hooks/useNativeAnalysis";
import type { NativeFrequencyWaveformResponse } from "../hooks/useNativeAnalysis";

type ViewMode = "waveform" | "spectrogram";

// Simple in-memory cache for waveform and spectrogram data
const waveformCache = new Map<string, WaveformData>();
const spectrogramCache = new Map<string, SpectrogramData>();
const frequencyWaveformCache = new Map<string, NativeFrequencyWaveformResponse>();

function getCacheKey(path: string, width: number, height?: number, scale?: string): string {
  return `${path}:${width}${height ? `:${height}` : ""}${scale ? `:${scale}` : ""}`;
}

interface WaveformViewProps {
  sample: Sample;
  isPlaying: boolean;
  progress: number;
  onSeek: (position: number) => void;
  onPlay?: () => void;
}

export function WaveformView({ sample, isPlaying, progress, onSeek, onPlay }: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [spectrogram, setSpectrogram] = useState<SpectrogramData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("waveform");
  const [spectrogramScale, setSpectrogramScale] = useState<"mel" | "linear">("mel");
  const [frequencyData, setFrequencyData] = useState<NativeFrequencyWaveformResponse | null>(null);
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
      const cacheKey = getCacheKey(sample.path, canvasSize.width);

      // Check cache first
      const cached = waveformCache.get(cacheKey);
      const cachedFreq = frequencyWaveformCache.get(cacheKey);
      if (cached && cachedFreq) {
        console.log("[Native] Waveform cache hit");
        setWaveform(cached);
        setFrequencyData(cachedFreq);
        setLoadTime(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadTime(null);
      const startTime = performance.now();

      try {
        console.log("[Native] Fetching frequency waveform for:", sample.path, "width:", canvasSize.width);
        const nativeResult = await getNativeFrequencyWaveform(sample.path, canvasSize.width);
        const data: WaveformData = { peaks: nativeResult.peaks, duration: nativeResult.duration };

        const elapsed = performance.now() - startTime;
        console.log(`[Native] Frequency waveform loaded in ${elapsed.toFixed(1)}ms`);

        // Cache the result
        waveformCache.set(cacheKey, data);
        frequencyWaveformCache.set(cacheKey, nativeResult);

        if (!cancelled) {
          setWaveform(data);
          setFrequencyData(nativeResult);
          setLoadTime(elapsed);
        }
      } catch (err) {
        console.error("[Native] Failed to load frequency waveform:", err);
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
  }, [sample.id, sample.path, canvasSize.width]);

  // Fetch spectrogram data when mode changes
  useEffect(() => {
    if (viewMode !== "spectrogram" || canvasSize.width <= 0) return;

    let cancelled = false;

    async function fetchSpectrogram() {
      const cacheKey = getCacheKey(sample.path, canvasSize.width, canvasSize.height, spectrogramScale);

      // Check cache first
      const cached = spectrogramCache.get(cacheKey);
      if (cached) {
        console.log("[Native] Spectrogram cache hit");
        setSpectrogram(cached);
        setLoadTime(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadTime(null);
      const startTime = performance.now();

      try {
        console.log("[Native] Fetching spectrogram for:", sample.path, "scale:", spectrogramScale);
        const nativeResult = await getNativeSpectrogram(sample.path, canvasSize.width, canvasSize.height, spectrogramScale);
        const data: SpectrogramData = {
          spectrogram: nativeResult.spectrogram,
          duration: nativeResult.duration,
          width: nativeResult.width,
          height: nativeResult.height,
        };

        const elapsed = performance.now() - startTime;
        console.log(`[Native] Spectrogram loaded in ${elapsed.toFixed(1)}ms`);

        // Cache the result
        spectrogramCache.set(cacheKey, data);

        if (!cancelled) {
          setSpectrogram(data);
          setLoadTime(elapsed);
        }
      } catch (err) {
        console.error("[Native] Failed to load spectrogram:", err);
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
  }, [sample.id, sample.path, viewMode, canvasSize.width, canvasSize.height, spectrogramScale]);

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

      // Draw waveform bars with frequency-based coloring
      for (let i = 0; i < peaks.length; i++) {
        const x = i * barWidth;
        const barHeight = Math.max(1, peaks[i] * midY * 0.9);

        // Color based on spectral centroid
        if (frequencyData && frequencyData.centroids[i] !== undefined) {
          const centroid = frequencyData.centroids[i];
          // Map frequency to HSL hue: low freq = warm (red/orange), high freq = cool (blue)
          // <200Hz = red (0), 200-1000Hz = orange-yellow (30-60), 1000-4000Hz = cyan (180), >4000Hz = blue (240)
          let hue: number;
          if (centroid < 200) {
            hue = 0; // red
          } else if (centroid < 1000) {
            hue = 30 + ((centroid - 200) / 800) * 30; // orange to yellow
          } else if (centroid < 4000) {
            hue = 60 + ((centroid - 1000) / 3000) * 120; // yellow to cyan
          } else {
            hue = 240; // blue
          }
          ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;
        } else {
          ctx.fillStyle = "#646cff";
        }

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
  }, [waveform, spectrogram, frequencyData, viewMode, isPlaying, progress, canvasSize]);

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
          {viewMode === "spectrogram" && (
            <div className="flex bg-surface border border-surface-border rounded overflow-hidden">
              <button
                onClick={() => setSpectrogramScale("mel")}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  spectrogramScale === "mel"
                    ? "bg-accent text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Mel
              </button>
              <button
                onClick={() => setSpectrogramScale("linear")}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  spectrogramScale === "linear"
                    ? "bg-accent text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Lin
              </button>
            </div>
          )}
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
      <div className="flex-1 relative min-h-[72px] max-h-[240px]" ref={containerRef}>
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
      <div className="flex gap-4 mt-2 text-xs text-gray-400 overflow-hidden">
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
