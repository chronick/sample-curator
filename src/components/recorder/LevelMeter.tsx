import { useRecorderStore } from "../../store/recorderStore";

function dbToPercent(db: number): number {
  // Map -60..0 dB to 0..100%
  const clamped = Math.max(-60, Math.min(0, db));
  return ((clamped + 60) / 60) * 100;
}

function MeterBar({ rmsDb, peakDb, label }: { rmsDb: number; peakDb: number; label: string }) {
  const rmsPercent = dbToPercent(rmsDb);
  const peakPercent = dbToPercent(peakDb);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-3 text-right">{label}</span>
      <div className="flex-1 h-4 bg-surface rounded relative overflow-hidden">
        {/* Segmented color bar */}
        <div className="absolute inset-0 flex">
          <div
            className="h-full transition-all duration-75"
            style={{
              width: `${Math.min(rmsPercent, 66.7)}%`,
              backgroundColor: "#22c55e",
            }}
          />
          {rmsPercent > 66.7 && (
            <div
              className="h-full transition-all duration-75"
              style={{
                width: `${Math.min(rmsPercent - 66.7, 16.6)}%`,
                backgroundColor: "#eab308",
              }}
            />
          )}
          {rmsPercent > 83.3 && (
            <div
              className="h-full transition-all duration-75"
              style={{
                width: `${rmsPercent - 83.3}%`,
                backgroundColor: "#ef4444",
              }}
            />
          )}
        </div>
        {/* Peak marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white transition-all duration-75"
          style={{ left: `${peakPercent}%` }}
        />
        {/* Threshold markers */}
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "66.7%" }} />
        <div className="absolute top-0 bottom-0 w-px bg-surface-border" style={{ left: "83.3%" }} />
      </div>
      <span className="text-xs text-gray-400 w-16 text-right font-mono tabular-nums">
        {rmsDb > -96 ? `${rmsDb.toFixed(1)} dB` : "-\u221E dB"}
      </span>
    </div>
  );
}

export function LevelMeter() {
  const levels = useRecorderStore((s) => s.levels);

  if (levels.channels.length === 0) {
    return (
      <div className="space-y-1.5">
        <MeterBar rmsDb={-96} peakDb={-96} label="L" />
        <MeterBar rmsDb={-96} peakDb={-96} label="R" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {levels.channels.map((ch, i) => (
        <MeterBar
          key={i}
          rmsDb={ch.rms_db}
          peakDb={ch.peak_db}
          label={levels.channels.length === 1 ? "M" : i === 0 ? "L" : "R"}
        />
      ))}
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
