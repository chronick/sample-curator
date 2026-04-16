import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../../store/recorderStore";

const SAMPLE_RATES = [44100, 48000, 96000];
const BIT_DEPTHS = [16, 24, 32];

// Cap channel picker so pathological devices (e.g. 32-channel aggregates)
// don't render a giant bar. Users rarely record > 8 channels at once.
const MAX_CHANNEL_OPTIONS = 8;

function channelLabel(n: number): string {
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return `${n}ch`;
}

function SegmentedButton({
  options,
  value,
  onChange,
}: {
  options: { value: number; label: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex rounded overflow-hidden border border-surface-border">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs transition-colors ${
            value === opt.value
              ? "bg-accent text-white"
              : "bg-surface-raised text-gray-400 hover:bg-surface-hover"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ConfigBar() {
  const config = useRecorderStore((s) => s.config);
  const updateConfig = useRecorderStore((s) => s.updateConfig);
  const devices = useRecorderStore((s) => s.devices);
  const selectedDeviceId = useRecorderStore((s) => s.selectedDeviceId);

  const maxChannels = useMemo(() => {
    const dev = devices.find((d) => d.id === selectedDeviceId);
    const n = dev?.max_channels ?? 2;
    return Math.max(1, Math.min(MAX_CHANNEL_OPTIONS, n));
  }, [devices, selectedDeviceId]);

  const channelOptions = useMemo(
    () =>
      Array.from({ length: maxChannels }, (_, i) => ({
        value: i + 1,
        label: channelLabel(i + 1),
      })),
    [maxChannels]
  );

  // If the selected device supports fewer channels than the current config,
  // clamp down so the UI and persisted config stay valid.
  useEffect(() => {
    if (config.channels > maxChannels) {
      const next = { ...config, channels: maxChannels };
      updateConfig({ channels: maxChannels });
      invoke("recorder_set_config", { config: next }).catch((e) =>
        console.warn("Failed to persist channel clamp:", e)
      );
    }
  }, [maxChannels, config, updateConfig]);

  const persistConfig = (patch: Partial<typeof config>) => {
    const next = { ...config, ...patch };
    updateConfig(patch);
    invoke("recorder_set_config", { config: next }).catch((e) =>
      console.warn("Failed to persist recorder config:", e)
    );
  };

  return (
    <div className="flex items-center gap-4 text-xs text-gray-400">
      <SegmentedButton
        options={SAMPLE_RATES.map((r) => ({
          value: r,
          label: r === 44100 ? "44.1k" : `${r / 1000}k`,
        }))}
        value={config.sample_rate}
        onChange={(v) => persistConfig({ sample_rate: v })}
      />
      <SegmentedButton
        options={BIT_DEPTHS.map((b) => ({
          value: b,
          label: `${b}-bit`,
        }))}
        value={config.bit_depth}
        onChange={(v) => persistConfig({ bit_depth: v })}
      />
      <SegmentedButton
        options={channelOptions}
        value={Math.min(config.channels, maxChannels)}
        onChange={(v) => persistConfig({ channels: v })}
      />
    </div>
  );
}
