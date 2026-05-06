import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AudioDevice } from "../../types/recorder";
import { Section, Row, Button } from "./shared";

export function AudioTab() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await invoke<AudioDevice[]>("recorder_list_audio_devices");
      setDevices(list);
      const def = list.find((d) => d.is_default);
      setSelectedId((prev) => prev ?? def?.id ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    setError(null);
    try {
      await invoke("recorder_select_device", { deviceId: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <Section
        title="Input device"
        action={
          <Button onClick={() => void refresh()} disabled={busy} testId="audio-refresh">
            {busy ? "…" : "Refresh"}
          </Button>
        }
      >
        <div className="space-y-3">
          <select
            value={selectedId ?? ""}
            onChange={(e) => void handleSelect(e.target.value)}
            data-testid="audio-device-picker"
            className="w-full bg-surface border border-surface-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          >
            <option value="" disabled>
              Select input device…
            </option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.is_default ? " (system default)" : ""}
              </option>
            ))}
          </select>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {selected && (
            <div className="space-y-1 pt-1">
              <Row label="Channels" value={String(selected.max_channels)} />
              <Row label="Default sample rate" value={`${selected.default_sample_rate.toLocaleString()} Hz`} />
            </div>
          )}
          <p className="text-[11px] text-gray-500">
            Selecting a device here is the same as the picker in the recorder panel — they share state.
          </p>
        </div>
      </Section>
    </div>
  );
}
