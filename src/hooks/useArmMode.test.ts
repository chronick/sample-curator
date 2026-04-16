import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useArmMode } from "./useArmMode";
import { useRecorderStore } from "../store/recorderStore";
import type { LevelData } from "../types/recorder";

function setLevels(peak_db: number) {
  const levels: LevelData = {
    channels: [{ rms_db: peak_db, peak_db }],
  };
  useRecorderStore.getState().setLevels(levels);
}

describe("useArmMode", () => {
  let startRecording: ReturnType<typeof vi.fn>;
  let stopRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    startRecording = vi.fn().mockResolvedValue(undefined);
    stopRecording = vi.fn().mockResolvedValue(undefined);
    // Reset store: disarmed, not recording, silent, defaults.
    useRecorderStore.setState({
      isArmed: false,
      isRecording: false,
      levels: { channels: [] },
      config: {
        sample_rate: 48000,
        bit_depth: 24,
        channels: 2,
        output_dir: "",
        default_device: null,
        arm_threshold_db: -40,
        arm_silence_ms: 2000,
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when disarmed", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));
    act(() => setLevels(-10)); // well above threshold
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("starts recording when armed and peak crosses threshold", async () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));

    act(() => {
      useRecorderStore.getState().setIsArmed(true);
    });
    act(() => setLevels(-60)); // below -40 threshold, no start
    expect(startRecording).not.toHaveBeenCalled();

    act(() => setLevels(-20)); // above threshold
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("does not start twice while recording is in flight", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));

    act(() => {
      useRecorderStore.getState().setIsArmed(true);
    });
    act(() => setLevels(-20));
    act(() => setLevels(-15)); // another above-threshold tick before state flips
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("stops recording after silence_ms continuous silence", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));

    // Simulate: armed + actively recording.
    act(() => {
      useRecorderStore.setState({ isArmed: true, isRecording: true });
    });

    // First silent tick: starts timer, no stop yet.
    act(() => setLevels(-70));
    expect(stopRecording).not.toHaveBeenCalled();

    // Advance <silence_ms and push another silent tick: still no stop.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => setLevels(-70));
    expect(stopRecording).not.toHaveBeenCalled();

    // Advance past silence_ms and push another silent tick: triggers stop.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => setLevels(-70));
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it("resets silence timer when audio returns above threshold mid-recording", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));
    act(() => {
      useRecorderStore.setState({ isArmed: true, isRecording: true });
    });

    // Start silence
    act(() => setLevels(-70));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Audio returns
    act(() => setLevels(-10));
    // Now go silent again
    act(() => setLevels(-70));
    // Only 500ms more — less than 2000ms since the *new* silence started
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => setLevels(-70));
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it("stays armed after auto-stop so a new transient re-triggers", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));
    act(() => {
      useRecorderStore.setState({ isArmed: true, isRecording: true });
    });
    // Trigger stop
    act(() => setLevels(-70));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => setLevels(-70));
    expect(stopRecording).toHaveBeenCalledTimes(1);

    // Simulate backend flipping isRecording to false
    act(() => {
      useRecorderStore.setState({ isRecording: false });
    });

    // Hook should still be armed and ready to start on a new transient
    expect(useRecorderStore.getState().isArmed).toBe(true);
    act(() => setLevels(-20));
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("clears silence timer when user disarms mid-silence", () => {
    renderHook(() => useArmMode({ startRecording, stopRecording }));
    act(() => {
      useRecorderStore.setState({ isArmed: true, isRecording: true });
    });
    act(() => setLevels(-70));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      useRecorderStore.getState().setIsArmed(false);
    });
    // Re-arm and go silent again — timer should start fresh
    act(() => {
      useRecorderStore.getState().setIsArmed(true);
    });
    act(() => setLevels(-70));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => setLevels(-70));
    expect(stopRecording).not.toHaveBeenCalled();
  });
});
