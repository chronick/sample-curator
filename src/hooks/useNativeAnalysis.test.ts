import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useNativeWaveform,
  useNativeSpectrogram,
  useNativeQuality,
  getNativeWaveform,
  getNativeSpectrogram,
  getNativeQuality,
  getNativeAudioInfo,
  getNativeFrequencyWaveform,
  benchmark,
} from "./useNativeAnalysis";
import type {
  NativeWaveformResponse,
  NativeSpectrogramResponse,
  NativeQualityResponse,
} from "./useNativeAnalysis";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockWaveform: NativeWaveformResponse = {
  data: [0.1, 0.5, 0.3, -0.2],
  duration: 1.5,
};

const mockSpectrogram: NativeSpectrogramResponse = {
  spectrogram: [[0.1, 0.2], [0.3, 0.4]],
  duration: 1.5,
  width: 800,
  height: 128,
};

const mockQuality: NativeQualityResponse = {
  rms_db: -20,
  peak_db: -3,
  crest_factor: 12,
  dynamic_range: 17,
  clipping_detected: false,
  clipping_ratio: 0,
  dc_offset: 0.001,
};

describe("useNativeWaveform", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useNativeWaveform());
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches waveform successfully", async () => {
    mockInvoke.mockResolvedValueOnce(mockWaveform);
    const { result } = renderHook(() => useNativeWaveform());

    await act(async () => {
      await result.current.fetchWaveform("/samples/kick.wav");
    });

    expect(result.current.data).toEqual(mockWaveform);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("native_waveform", {
      path: "/samples/kick.wav",
      width: 800,
    });
  });

  it("handles fetch error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("decode failed"));
    const { result } = renderHook(() => useNativeWaveform());

    await act(async () => {
      await result.current.fetchWaveform("/samples/bad.wav");
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("decode failed");
  });

  it("handles non-Error rejection", async () => {
    mockInvoke.mockRejectedValueOnce("string error");
    const { result } = renderHook(() => useNativeWaveform());

    await act(async () => {
      await result.current.fetchWaveform("/samples/bad.wav");
    });

    expect(result.current.error).toBe("string error");
  });

  it("reset() clears data and error", async () => {
    mockInvoke.mockResolvedValueOnce(mockWaveform);
    const { result } = renderHook(() => useNativeWaveform());

    await act(async () => {
      await result.current.fetchWaveform("/samples/kick.wav");
    });
    expect(result.current.data).not.toBeNull();

    act(() => {
      result.current.reset();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("passes custom width parameter", async () => {
    mockInvoke.mockResolvedValueOnce(mockWaveform);
    const { result } = renderHook(() => useNativeWaveform());

    await act(async () => {
      await result.current.fetchWaveform("/samples/kick.wav", 400);
    });

    expect(mockInvoke).toHaveBeenCalledWith("native_waveform", {
      path: "/samples/kick.wav",
      width: 400,
    });
  });
});

describe("useNativeSpectrogram", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useNativeSpectrogram());
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches spectrogram successfully", async () => {
    mockInvoke.mockResolvedValueOnce(mockSpectrogram);
    const { result } = renderHook(() => useNativeSpectrogram());

    await act(async () => {
      await result.current.fetchSpectrogram("/samples/kick.wav");
    });

    expect(result.current.data).toEqual(mockSpectrogram);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("handles fetch error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("analysis failed"));
    const { result } = renderHook(() => useNativeSpectrogram());

    await act(async () => {
      await result.current.fetchSpectrogram("/samples/bad.wav");
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("analysis failed");
  });

  it("reset() clears data and error", async () => {
    mockInvoke.mockResolvedValueOnce(mockSpectrogram);
    const { result } = renderHook(() => useNativeSpectrogram());

    await act(async () => {
      await result.current.fetchSpectrogram("/samples/kick.wav");
    });

    act(() => {
      result.current.reset();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("passes custom dimensions", async () => {
    mockInvoke.mockResolvedValueOnce(mockSpectrogram);
    const { result } = renderHook(() => useNativeSpectrogram());

    await act(async () => {
      await result.current.fetchSpectrogram("/samples/kick.wav", 400, 64);
    });

    expect(mockInvoke).toHaveBeenCalledWith("native_spectrogram", {
      path: "/samples/kick.wav",
      width: 400,
      height: 64,
      scale: undefined,
    });
  });
});

describe("useNativeQuality", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useNativeQuality());
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("analyzes quality successfully", async () => {
    mockInvoke.mockResolvedValueOnce(mockQuality);
    const { result } = renderHook(() => useNativeQuality());

    await act(async () => {
      await result.current.analyzeQuality("/samples/kick.wav");
    });

    expect(result.current.data).toEqual(mockQuality);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("native_quality", {
      path: "/samples/kick.wav",
    });
  });

  it("handles analysis error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("corrupt file"));
    const { result } = renderHook(() => useNativeQuality());

    await act(async () => {
      await result.current.analyzeQuality("/samples/bad.wav");
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("corrupt file");
  });

  it("reset() clears data and error", async () => {
    mockInvoke.mockResolvedValueOnce(mockQuality);
    const { result } = renderHook(() => useNativeQuality());

    await act(async () => {
      await result.current.analyzeQuality("/samples/kick.wav");
    });

    act(() => {
      result.current.reset();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("standalone functions", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("getNativeWaveform calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValueOnce(mockWaveform);
    const result = await getNativeWaveform("/path.wav", 600);
    expect(mockInvoke).toHaveBeenCalledWith("native_waveform", {
      path: "/path.wav",
      width: 600,
    });
    expect(result).toEqual(mockWaveform);
  });

  it("getNativeWaveform uses default width of 800", async () => {
    mockInvoke.mockResolvedValueOnce(mockWaveform);
    await getNativeWaveform("/path.wav");
    expect(mockInvoke).toHaveBeenCalledWith("native_waveform", {
      path: "/path.wav",
      width: 800,
    });
  });

  it("getNativeSpectrogram calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValueOnce(mockSpectrogram);
    const result = await getNativeSpectrogram("/path.wav", 400, 64, "mel");
    expect(mockInvoke).toHaveBeenCalledWith("native_spectrogram", {
      path: "/path.wav",
      width: 400,
      height: 64,
      scale: "mel",
    });
    expect(result).toEqual(mockSpectrogram);
  });

  it("getNativeQuality calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValueOnce(mockQuality);
    const result = await getNativeQuality("/path.wav");
    expect(mockInvoke).toHaveBeenCalledWith("native_quality", {
      path: "/path.wav",
    });
    expect(result).toEqual(mockQuality);
  });

  it("getNativeAudioInfo calls invoke with correct args", async () => {
    const mockInfo = {
      path: "/path.wav",
      duration_sec: 1.5,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      format: "wav",
    };
    mockInvoke.mockResolvedValueOnce(mockInfo);
    const result = await getNativeAudioInfo("/path.wav");
    expect(mockInvoke).toHaveBeenCalledWith("native_audio_info", {
      path: "/path.wav",
    });
    expect(result).toEqual(mockInfo);
  });

  it("getNativeFrequencyWaveform calls invoke with correct args", async () => {
    const mockFreq = { peaks: [0.1], centroids: [500], duration: 1.0 };
    mockInvoke.mockResolvedValueOnce(mockFreq);
    const result = await getNativeFrequencyWaveform("/path.wav", 600);
    expect(mockInvoke).toHaveBeenCalledWith("native_frequency_waveform", {
      path: "/path.wav",
      width: 600,
    });
    expect(result).toEqual(mockFreq);
  });
});

describe("benchmark", () => {
  it("returns result and timing", async () => {
    const { result, durationMs } = await benchmark("test", async () => 42);
    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof durationMs).toBe("number");
  });

  it("propagates errors from fn", async () => {
    await expect(
      benchmark("fail", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
