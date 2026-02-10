import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayer } from "./usePlayer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("usePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => usePlayer());

    expect(result.current.currentSample).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.duration).toBe(0);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.progress).toBe(0);
  });

  it("play() calls invoke with audio_play and sets isPlaying", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // duration
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_play", {
      path: "/samples/kick.wav",
    });
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.currentSample).toBe("/samples/kick.wav");
    expect(result.current.duration).toBe(2.5);
  });

  it("pause() calls invoke with audio_pause and stops playing", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // play
    mockInvoke.mockResolvedValueOnce(undefined); // pause
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });
    await act(async () => {
      await result.current.pause();
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_pause");
    expect(result.current.isPlaying).toBe(false);
  });

  it("resume() calls invoke with audio_resume and sets isPlaying", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // play
    mockInvoke.mockResolvedValueOnce(undefined); // pause
    mockInvoke.mockResolvedValueOnce(undefined); // resume
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });
    await act(async () => {
      await result.current.pause();
    });
    await act(async () => {
      await result.current.resume();
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_resume");
    expect(result.current.isPlaying).toBe(true);
  });

  it("stop() calls invoke with audio_stop and resets playing", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // play
    mockInvoke.mockResolvedValueOnce(undefined); // stop
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_stop");
    expect(result.current.isPlaying).toBe(false);
  });

  it("toggle() pauses when playing", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // play
    mockInvoke.mockResolvedValueOnce(undefined); // pause (from toggle)
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });
    await act(async () => {
      await result.current.toggle();
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_pause");
    expect(result.current.isPlaying).toBe(false);
  });

  it("toggle() resumes when paused with existing sample", async () => {
    mockInvoke.mockResolvedValueOnce(2.5); // play
    mockInvoke.mockResolvedValueOnce(undefined); // pause
    mockInvoke.mockResolvedValueOnce(undefined); // resume (from toggle)
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });
    await act(async () => {
      await result.current.pause();
    });
    await act(async () => {
      await result.current.toggle();
    });

    expect(mockInvoke).toHaveBeenCalledWith("audio_resume");
  });

  it("setVolume() clamps to [0,1] and calls invoke", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.setVolume(0.5);
    });
    expect(mockInvoke).toHaveBeenCalledWith("audio_set_volume", {
      volume: 0.5,
    });

    await act(async () => {
      await result.current.setVolume(-0.5);
    });
    expect(mockInvoke).toHaveBeenCalledWith("audio_set_volume", {
      volume: 0,
    });

    await act(async () => {
      await result.current.setVolume(1.5);
    });
    expect(mockInvoke).toHaveBeenCalledWith("audio_set_volume", {
      volume: 1,
    });
  });

  it("play() handles invoke rejection gracefully", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("file not found"));
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/missing.wav");
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it("progress is position/duration ratio", async () => {
    mockInvoke.mockResolvedValueOnce(4.0); // play returns duration
    const { result } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });

    // Duration is set, position starts at 0
    expect(result.current.duration).toBe(4.0);
    expect(result.current.progress).toBe(0);
  });

  it("cleans up polling on unmount", async () => {
    mockInvoke.mockResolvedValueOnce(2.5);
    const { result, unmount } = renderHook(() => usePlayer());

    await act(async () => {
      await result.current.play("/samples/kick.wav");
    });

    // Unmount should not throw
    unmount();
  });
});
