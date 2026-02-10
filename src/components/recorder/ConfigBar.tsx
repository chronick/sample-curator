import { useRecorderStore } from "../../store/recorderStore";

const SAMPLE_RATES = [44100, 48000, 96000];
const BIT_DEPTHS = [16, 24, 32];
const CHANNEL_OPTIONS = [
  { value: 1, label: "Mono" },
  { value: 2, label: "Stereo" },
];

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

  return (
    <div className="flex items-center gap-4 text-xs text-gray-400">
      <SegmentedButton
        options={SAMPLE_RATES.map((r) => ({
          value: r,
          label: r === 44100 ? "44.1k" : `${r / 1000}k`,
        }))}
        value={config.sample_rate}
        onChange={(v) => updateConfig({ sample_rate: v })}
      />
      <SegmentedButton
        options={BIT_DEPTHS.map((b) => ({
          value: b,
          label: `${b}-bit`,
        }))}
        value={config.bit_depth}
        onChange={(v) => updateConfig({ bit_depth: v })}
      />
      <SegmentedButton
        options={CHANNEL_OPTIONS}
        value={config.channels}
        onChange={(v) => updateConfig({ channels: v })}
      />
    </div>
  );
}
