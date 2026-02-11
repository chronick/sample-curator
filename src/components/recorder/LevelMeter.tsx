import { useRef, useEffect } from "react";
import { useRecorderStore } from "../../store/recorderStore";

function dbToPercent(db: number): number {
  // Map -60..0 dB to 0..100%
  const clamped = Math.max(-60, Math.min(0, db));
  return ((clamped + 60) / 60) * 100;
}

interface BarElements {
  green: HTMLDivElement | null;
  yellow: HTMLDivElement | null;
  red: HTMLDivElement | null;
  peak: HTMLDivElement | null;
  text: HTMLSpanElement | null;
}

function MeterBar({ label, barRef }: { label: string; barRef: React.RefObject<BarElements | null> }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-3 text-right">{label}</span>
      <div className="flex-1 h-4 bg-surface rounded relative overflow-hidden">
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
        {/* Threshold markers */}
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "66.7%" }} />
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "83.3%" }} />
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

/**
 * Level meter that bypasses React re-renders entirely.
 * Runs its own rAF loop, reads levels from the Zustand store via getState(),
 * and updates DOM elements directly through refs.
 */
export function LevelMeter() {
  const leftRef = useRef<BarElements>({ green: null, yellow: null, red: null, peak: null, text: null });
  const rightRef = useRef<BarElements>({ green: null, yellow: null, red: null, peak: null, text: null });

  useEffect(() => {
    let animFrame: number;
    const draw = () => {
      const { levels } = useRecorderStore.getState();
      const ch = levels.channels;

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

      animFrame = requestAnimationFrame(draw);
    };
    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  return (
    <div className="space-y-1.5">
      <MeterBar label="L" barRef={leftRef} />
      <MeterBar label="R" barRef={rightRef} />
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
