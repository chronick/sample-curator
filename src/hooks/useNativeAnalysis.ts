/**
 * Hook for native Rust audio analysis (bypasses Python sidecar for speed).
 *
 * These functions call directly into the Rust sample-analysis-core library
 * via Tauri commands, providing much faster analysis than the sidecar route.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";

// Response types matching Rust structs in src-tauri/src/analysis.rs

export interface NativeSpectrogramResponse {
  spectrogram: number[][];
  duration: number;
  width: number;
  height: number;
}

export interface NativeWaveformResponse {
  data: number[];
  duration: number;
}

export interface NativeQualityResponse {
  rms_db: number;
  peak_db: number;
  crest_factor: number;
  dynamic_range: number;
  clipping_detected: boolean;
  clipping_ratio: number;
  dc_offset: number;
}

export interface NativeAudioInfoResponse {
  path: string;
  duration_sec: number;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  format: string;
}

/**
 * Get waveform data using native Rust analyzer.
 * Much faster than going through Python sidecar.
 */
export async function getNativeWaveform(
  path: string,
  width: number = 800
): Promise<NativeWaveformResponse> {
  return invoke<NativeWaveformResponse>("native_waveform", { path, width });
}

/**
 * Get spectrogram data using native Rust analyzer.
 * Much faster than going through Python sidecar.
 */
export async function getNativeSpectrogram(
  path: string,
  width: number = 800,
  height: number = 128
): Promise<NativeSpectrogramResponse> {
  return invoke<NativeSpectrogramResponse>("native_spectrogram", { path, width, height });
}

/**
 * Get audio quality metrics using native Rust analyzer.
 */
export async function getNativeQuality(path: string): Promise<NativeQualityResponse> {
  return invoke<NativeQualityResponse>("native_quality", { path });
}

/**
 * Get audio file info using native Rust analyzer.
 */
export async function getNativeAudioInfo(path: string): Promise<NativeAudioInfoResponse> {
  return invoke<NativeAudioInfoResponse>("native_audio_info", { path });
}

/**
 * Hook for native waveform fetching with loading state.
 */
export function useNativeWaveform() {
  const [data, setData] = useState<NativeWaveformResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWaveform = useCallback(async (path: string, width: number = 800) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNativeWaveform(path, width);
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Native waveform error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, fetchWaveform, reset };
}

/**
 * Hook for native spectrogram fetching with loading state.
 */
export function useNativeSpectrogram() {
  const [data, setData] = useState<NativeSpectrogramResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSpectrogram = useCallback(
    async (path: string, width: number = 800, height: number = 128) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getNativeSpectrogram(path, width, height);
        setData(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        console.error("Native spectrogram error:", message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, fetchSpectrogram, reset };
}

/**
 * Hook for native quality analysis with loading state.
 */
export function useNativeQuality() {
  const [data, setData] = useState<NativeQualityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeQuality = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNativeQuality(path);
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Native quality error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, analyzeQuality, reset };
}

/**
 * Benchmark helper: measure execution time of a function.
 */
export async function benchmark<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  console.log(`[Benchmark] ${name}: ${durationMs.toFixed(2)}ms`);
  return { result, durationMs };
}

/**
 * Compare native vs sidecar performance for waveform generation.
 */
export async function benchmarkWaveform(
  path: string,
  sampleId: number,
  width: number = 800
): Promise<{ native: number; sidecar: number; speedup: number }> {
  const { api } = await import("../api");

  // Warm up
  await getNativeWaveform(path, width);
  await api.getWaveform(sampleId, width);

  // Benchmark native
  const nativeStart = performance.now();
  await getNativeWaveform(path, width);
  const nativeTime = performance.now() - nativeStart;

  // Benchmark sidecar
  const sidecarStart = performance.now();
  await api.getWaveform(sampleId, width);
  const sidecarTime = performance.now() - sidecarStart;

  const speedup = sidecarTime / nativeTime;

  console.log(`[Waveform Benchmark]`);
  console.log(`  Native:  ${nativeTime.toFixed(2)}ms`);
  console.log(`  Sidecar: ${sidecarTime.toFixed(2)}ms`);
  console.log(`  Speedup: ${speedup.toFixed(1)}x`);

  return { native: nativeTime, sidecar: sidecarTime, speedup };
}

/**
 * Compare native vs sidecar performance for spectrogram generation.
 */
export async function benchmarkSpectrogram(
  path: string,
  sampleId: number,
  width: number = 800,
  height: number = 128
): Promise<{ native: number; sidecar: number; speedup: number }> {
  const { api } = await import("../api");

  // Warm up
  await getNativeSpectrogram(path, width, height);
  await api.getSpectrogram(sampleId, width, height);

  // Benchmark native
  const nativeStart = performance.now();
  await getNativeSpectrogram(path, width, height);
  const nativeTime = performance.now() - nativeStart;

  // Benchmark sidecar
  const sidecarStart = performance.now();
  await api.getSpectrogram(sampleId, width, height);
  const sidecarTime = performance.now() - sidecarStart;

  const speedup = sidecarTime / nativeTime;

  console.log(`[Spectrogram Benchmark]`);
  console.log(`  Native:  ${nativeTime.toFixed(2)}ms`);
  console.log(`  Sidecar: ${sidecarTime.toFixed(2)}ms`);
  console.log(`  Speedup: ${speedup.toFixed(1)}x`);

  return { native: nativeTime, sidecar: sidecarTime, speedup };
}

export default {
  getNativeWaveform,
  getNativeSpectrogram,
  getNativeQuality,
  getNativeAudioInfo,
  useNativeWaveform,
  useNativeSpectrogram,
  useNativeQuality,
  benchmark,
  benchmarkWaveform,
  benchmarkSpectrogram,
};
