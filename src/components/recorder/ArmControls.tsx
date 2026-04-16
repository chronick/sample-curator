import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../../store/recorderStore";

/**
 * Arm-mode controls: toggle, threshold slider, silence duration input.
 * Persists threshold/silence to the backend recorder config so selections
 * survive restarts. Arm state itself is ephemeral.
 */
export function ArmControls() {
  const isArmed = useRecorderStore((s) => s.isArmed);
  const setIsArmed = useRecorderStore((s) => s.setIsArmed);
  const isRecording = useRecorderStore((s) => s.isRecording);
  const isMonitoring = useRecorderStore((s) => s.isMonitoring);
  const config = useRecorderStore((s) => s.config);
  const updateConfig = useRecorderStore((s) => s.updateConfig);

  const persistConfig = (patch: Partial<typeof config>) => {
    const next = { ...config, ...patch };
    updateConfig(patch);
    invoke("recorder_set_config", { config: next }).catch((e) =>
      console.warn("Failed to persist arm config:", e)
    );
  };

  const handleThreshold = (v: number) => persistConfig({ arm_threshold_db: v });
  const handleSilence = (v: number) => persistConfig({ arm_silence_ms: v });

  const toggleArmed = () => setIsArmed(!isArmed);

  const statusLabel = !isArmed
    ? "Disarmed"
    : isRecording
      ? "Recording"
      : "Waiting…";

  const statusColor = !isArmed
    ? "text-gray-500"
    : isRecording
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs border-b border-surface-border bg-surface-raised/50"
      data-testid="arm-controls"
    >
      <button
        onClick={toggleArmed}
        disabled={!isMonitoring}
        className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
          isArmed
            ? "bg-yellow-600/30 border-yellow-600 text-yellow-200 hover:bg-yellow-600/40"
            : "bg-surface border-surface-border text-gray-300 hover:bg-surface-hover"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title={
          isMonitoring
            ? "Arm: auto-record when input exceeds threshold"
            : "Select a device to arm"
        }
      >
        {isArmed ? "Armed" : "Arm"}
      </button>

      <span className={`text-xs ${statusColor}`} data-testid="arm-status">
        {statusLabel}
      </span>

      <label className="flex items-center gap-2 text-gray-400">
        <span className="whitespace-nowrap">Threshold</span>
        <input
          type="range"
          min={-60}
          max={-6}
          step={1}
          value={config.arm_threshold_db}
          onChange={(e) => handleThreshold(parseFloat(e.target.value))}
          className="w-24 accent-accent"
          aria-label="Arm threshold (dBFS)"
        />
        <span className="tabular-nums text-gray-300 w-12">
          {config.arm_threshold_db.toFixed(0)} dB
        </span>
      </label>

      <label className="flex items-center gap-2 text-gray-400">
        <span className="whitespace-nowrap">Silence</span>
        <input
          type="number"
          min={250}
          max={10000}
          step={250}
          value={config.arm_silence_ms}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) handleSilence(v);
          }}
          className="w-16 bg-surface border border-surface-border rounded px-1.5 py-0.5 text-xs text-white tabular-nums focus:outline-none focus:border-accent"
          aria-label="Arm silence duration (ms)"
        />
        <span className="text-gray-500">ms</span>
      </label>
    </div>
  );
}
