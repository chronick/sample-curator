/**
 * Hook for native Rust audio analysis.
 *
 * These functions call directly into the Rust sample-analysis-core library
 * via Tauri commands for fast audio analysis.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

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

export interface NativeFrequencyWaveformResponse {
  peaks: number[];
  centroids: number[];
  duration: number;
}

/**
 * Get waveform data using native Rust analyzer.
 */
export async function getNativeWaveform(
  path: string,
  width: number = 800
): Promise<NativeWaveformResponse> {
  return invoke<NativeWaveformResponse>("native_waveform", { path, width });
}

/**
 * Get spectrogram data using native Rust analyzer.
 */
export async function getNativeSpectrogram(
  path: string,
  width: number = 800,
  height: number = 128,
  scale?: "mel" | "linear"
): Promise<NativeSpectrogramResponse> {
  return invoke<NativeSpectrogramResponse>("native_spectrogram", { path, width, height, scale });
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
 * Get frequency-colored waveform data using native Rust analyzer.
 */
export async function getNativeFrequencyWaveform(
  path: string,
  width: number = 800
): Promise<NativeFrequencyWaveformResponse> {
  return invoke<NativeFrequencyWaveformResponse>("native_frequency_waveform", { path, width });
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

export default {
  getNativeWaveform,
  getNativeSpectrogram,
  getNativeQuality,
  getNativeAudioInfo,
  getNativeFrequencyWaveform,
  useNativeWaveform,
  useNativeSpectrogram,
  useNativeQuality,
  benchmark,
};
