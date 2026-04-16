import { useEffect, useRef } from "react";
import { useRecorderStore } from "../store/recorderStore";
import type { LevelData } from "../types/recorder";

/**
 * Peak dB across all channels in a LevelData snapshot. Silent or empty
 * data returns -Infinity so it reliably falls below any threshold.
 */
function peakDb(levels: LevelData): number {
  if (!levels.channels || levels.channels.length === 0) return -Infinity;
  let max = -Infinity;
  for (const ch of levels.channels) {
    if (ch.peak_db > max) max = ch.peak_db;
  }
  return max;
}

/**
 * Arm-mode state machine. When the recorder is armed, watches the polled
 * level stream and:
 *   - starts recording when peak dB rises above `arm_threshold_db`
 *   - stops recording after the peak stays below threshold for `arm_silence_ms`
 *
 * Stays armed after auto-stop so the user can capture multiple takes in one
 * armed session (re-trigger). Disarming resets the silence timer.
 *
 * Detection runs at the level-polling rate (~60Hz during monitoring). Start
 * latency is bounded by one poll tick plus one IPC round-trip, which is
 * typically within ~20-50ms. If you need sub-frame precision, move the
 * detection into the audio callback on the Rust side.
 */
export function useArmMode(args: {
  startRecording: () => Promise<void> | void;
  stopRecording: () => Promise<unknown> | void;
}) {
  const { startRecording, stopRecording } = args;
  const isArmed = useRecorderStore((s) => s.isArmed);
  const isRecording = useRecorderStore((s) => s.isRecording);
  const levels = useRecorderStore((s) => s.levels);
  const thresholdDb = useRecorderStore((s) => s.config.arm_threshold_db);
  const silenceMs = useRecorderStore((s) => s.config.arm_silence_ms);

  // Tracks when the current silence run started (ms, perf.now). null = not silent.
  const silenceStartRef = useRef<number | null>(null);
  // Prevents double-invoking start/stop when multiple level updates land before
  // the store's isRecording flag has flipped (IPC + polling round-trip).
  const inFlightRef = useRef<"starting" | "stopping" | null>(null);

  // Reset silence tracking whenever we toggle arm/record state, so a new
  // armed session doesn't start with a stale silence timer.
  useEffect(() => {
    silenceStartRef.current = null;
    if (!isArmed) {
      inFlightRef.current = null;
    }
  }, [isArmed, isRecording]);

  useEffect(() => {
    if (!isArmed) return;

    const peak = peakDb(levels);
    const now = performance.now();

    if (peak > thresholdDb) {
      // Signal present — clear silence timer.
      silenceStartRef.current = null;

      if (!isRecording && inFlightRef.current !== "starting") {
        inFlightRef.current = "starting";
        Promise.resolve(startRecording())
          .catch((e) => console.warn("Arm: start failed", e))
          .finally(() => {
            inFlightRef.current = null;
          });
      }
      return;
    }

    // Peak below threshold.
    if (!isRecording) {
      // Waiting for audio; no silence timer needed until we're actually recording.
      silenceStartRef.current = null;
      return;
    }

    if (silenceStartRef.current === null) {
      silenceStartRef.current = now;
      return;
    }

    if (now - silenceStartRef.current >= silenceMs && inFlightRef.current !== "stopping") {
      inFlightRef.current = "stopping";
      silenceStartRef.current = null;
      Promise.resolve(stopRecording())
        .catch((e) => console.warn("Arm: stop failed", e))
        .finally(() => {
          inFlightRef.current = null;
          // Stay armed — next transient above threshold starts a new take.
        });
    }
  }, [levels, isArmed, isRecording, thresholdDb, silenceMs, startRecording, stopRecording]);
}
