import { useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../../store/recorderStore";

// Meter range. Keep in sync with ArmControls slider range so the marker
// can't be dragged past what the slider can express.
const METER_MIN_DB = -60;
const METER_MAX_DB = 0;
const ARM_MIN_DB = -60;
const ARM_MAX_DB = -6;

function dbToPercent(db: number): number {
  // Map METER_MIN_DB..METER_MAX_DB to 0..100%
  const clamped = Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, db));
  return ((clamped - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
}

function percentToDb(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct));
  return METER_MIN_DB + (clamped / 100) * (METER_MAX_DB - METER_MIN_DB);
}

interface BarElements {
  green: HTMLDivElement | null;
  yellow: HTMLDivElement | null;
  red: HTMLDivElement | null;
  peak: HTMLDivElement | null;
  text: HTMLSpanElement | null;
  threshold: HTMLDivElement | null;
}

function MeterBar({
  label,
  barRef,
  onBarMouseDown,
}: {
  label: string;
  barRef: React.RefObject<BarElements | null>;
  onBarMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-3 text-right">{label}</span>
      <div
        className="flex-1 h-4 bg-surface rounded relative overflow-hidden"
        onMouseDown={onBarMouseDown}
        style={onBarMouseDown ? { cursor: "ew-resize" } : undefined}
      >
        {/* Segmented color bar */}
        <div className="absolute inset-0 flex">
          <div
            ref={(el) => { if (barRef.current) barRef.current.green = el; }}
            className="h-full"
            style={{ width: "0%", backgroundColor: "#22c55e" }}
          />
          <div
            ref={(el) => { if (barRef.current) barRef.current.yellow = el; }}
            className="h-full"
            style={{ width: "0%", backgroundColor: "#eab308", display: "none" }}
          />
          <div
            ref={(el) => { if (barRef.current) barRef.current.red = el; }}
            className="h-full"
            style={{ width: "0%", backgroundColor: "#ef4444", display: "none" }}
          />
        </div>
        {/* Peak marker */}
        <div
          ref={(el) => { if (barRef.current) barRef.current.peak = el; }}
          className="absolute top-0 bottom-0 w-0.5 bg-white"
          style={{ left: "0%" }}
        />
        {/* Static zone separators (yellow at -20dB, red at -10dB) */}
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "66.7%" }} />
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "83.3%" }} />
        {/* Arm threshold marker — colors + opacity set by the container via
            inline style to reflect armed state. */}
        <div
          ref={(el) => { if (barRef.current) barRef.current.threshold = el; }}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: "0%", width: "2px", display: "none" }}
          data-testid={`arm-threshold-marker-${label.toLowerCase()}`}
        />
      </div>
      <span
        ref={(el) => { if (barRef.current) barRef.current.text = el; }}
        className="text-xs text-gray-400 w-16 text-right font-mono tabular-nums"
      >
        -∞ dB
      </span>
    </div>
  );
}

function updateBar(r: BarElements | null, rmsDb: number, peakDb: number) {
  if (!r) return;
  const rmsPercent = dbToPercent(rmsDb);
  const peakPercent = dbToPercent(peakDb);

  if (r.green) r.green.style.width = `${Math.min(rmsPercent, 66.7)}%`;
  if (r.yellow) {
    if (rmsPercent > 66.7) {
      r.yellow.style.display = "";
      r.yellow.style.width = `${Math.min(rmsPercent - 66.7, 16.6)}%`;
    } else {
      r.yellow.style.display = "none";
    }
  }
  if (r.red) {
    if (rmsPercent > 83.3) {
      r.red.style.display = "";
      r.red.style.width = `${rmsPercent - 83.3}%`;
    } else {
      r.red.style.display = "none";
    }
  }
  if (r.peak) r.peak.style.left = `${peakPercent}%`;
  if (r.text) r.text.textContent = rmsDb > -96 ? `${rmsDb.toFixed(1)} dB` : "-\u221E dB";
}

function updateThresholdMarker(
  r: BarElements | null,
  thresholdDb: number,
  isArmed: boolean,
  isRecording: boolean
) {
  if (!r?.threshold) return;
  const pct = dbToPercent(thresholdDb);
  r.threshold.style.left = `${pct}%`;
  r.threshold.style.display = "";
  // Bright yellow when armed-waiting (input below threshold → that's the
  // line it needs to cross). Red when armed-recording (silence below this
  // line for N ms triggers auto-stop). Dim amber when disarmed so the user
  // can still see where the trigger *would* land.
  if (isArmed && isRecording) {
    r.threshold.style.backgroundColor = "#ef4444";
    r.threshold.style.opacity = "0.9";
    r.threshold.style.boxShadow = "0 0 4px rgba(239, 68, 68, 0.7)";
  } else if (isArmed) {
    r.threshold.style.backgroundColor = "#eab308";
    r.threshold.style.opacity = "1";
    r.threshold.style.boxShadow = "0 0 4px rgba(234, 179, 8, 0.6)";
  } else {
    r.threshold.style.backgroundColor = "#eab308";
    r.threshold.style.opacity = "0.35";
    r.threshold.style.boxShadow = "none";
  }
}

/**
 * Level meter that bypasses React re-renders entirely.
 * Runs its own rAF loop, reads levels from the Zustand store via getState(),
 * and updates DOM elements directly through refs.
 *
 * Also renders a draggable arm-threshold marker: drag horizontally anywhere
 * on the meter to set the threshold dB. Persists to backend config on drop.
 */
export function LevelMeter() {
  const leftRef = useRef<BarElements>({
    green: null, yellow: null, red: null, peak: null, text: null, threshold: null,
  });
  const rightRef = useRef<BarElements>({
    green: null, yellow: null, red: null, peak: null, text: null, threshold: null,
  });

  const updateConfig = useRecorderStore((s) => s.updateConfig);

  // Convert a mouse event's clientX relative to the bar element into a dB
  // value, clamped to the arm slider's allowed range.
  const mouseEventToDb = useCallback((e: MouseEvent | React.MouseEvent, bar: HTMLElement) => {
    const rect = bar.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const db = percentToDb(pct);
    return Math.max(ARM_MIN_DB, Math.min(ARM_MAX_DB, db));
  }, []);

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const bar = e.currentTarget;
      // Apply immediately on click — lets a user tap a spot to set threshold.
      const initialDb = mouseEventToDb(e, bar);
      updateConfig({ arm_threshold_db: initialDb });

      const onMove = (moveEvt: MouseEvent) => {
        const db = mouseEventToDb(moveEvt, bar);
        // Fast-path: update store only; debounce backend persist until mouseup
        // so we don't spam the IPC with 60 writes per second.
        useRecorderStore.getState().updateConfig({ arm_threshold_db: db });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Persist the final value once to the backend.
        const finalCfg = useRecorderStore.getState().config;
        invoke("recorder_set_config", { config: finalCfg }).catch((err) =>
          console.warn("Failed to persist threshold on drag end:", err)
        );
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [mouseEventToDb, updateConfig]
  );

  useEffect(() => {
    let animFrame: number;
    const draw = () => {
      const state = useRecorderStore.getState();
      const ch = state.levels.channels;
      const thresholdDb = state.config.arm_threshold_db;
      const isArmed = state.isArmed;
      const isRecording = state.isRecording;

      if (ch.length >= 2) {
        updateBar(leftRef.current, ch[0].rms_db, ch[0].peak_db);
        updateBar(rightRef.current, ch[1].rms_db, ch[1].peak_db);
      } else if (ch.length === 1) {
        updateBar(leftRef.current, ch[0].rms_db, ch[0].peak_db);
        updateBar(rightRef.current, ch[0].rms_db, ch[0].peak_db);
      } else {
        updateBar(leftRef.current, -96, -96);
        updateBar(rightRef.current, -96, -96);
      }

      updateThresholdMarker(leftRef.current, thresholdDb, isArmed, isRecording);
      updateThresholdMarker(rightRef.current, thresholdDb, isArmed, isRecording);

      animFrame = requestAnimationFrame(draw);
    };
    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  return (
    <div className="space-y-1.5">
      <MeterBar label="L" barRef={leftRef} onBarMouseDown={handleBarMouseDown} />
      <MeterBar label="R" barRef={rightRef} onBarMouseDown={handleBarMouseDown} />
      {/* dB scale */}
      <div className="flex justify-between text-[10px] text-gray-600 px-5">
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>-10</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}
