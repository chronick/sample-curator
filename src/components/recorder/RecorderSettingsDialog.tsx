import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useRecorderStore } from "../../store/recorderStore";
import type { RecorderConfig } from "../../types/recorder";

export function RecorderSettingsDialog() {
  const settingsOpen = useRecorderStore((s) => s.settingsOpen);
  const setSettingsOpen = useRecorderStore((s) => s.setSettingsOpen);
  const config = useRecorderStore((s) => s.config);
  const setConfig = useRecorderStore((s) => s.setConfig);

  const [localConfig, setLocalConfig] = useState<RecorderConfig>(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  if (!settingsOpen) return null;

  const handleSave = async () => {
    try {
      await invoke("recorder_set_config", { config: localConfig });
      setConfig(localConfig);
      setSettingsOpen(false);
    } catch (e) {
      console.error("Failed to save recorder config:", e);
    }
  };

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      title: "Select output directory",
    });
    if (selected && typeof selected === "string") {
      setLocalConfig({ ...localConfig, output_dir: selected });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-raised border border-surface-border rounded-lg w-[480px] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4">Recorder Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Output Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localConfig.output_dir}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, output_dir: e.target.value })
                }
                className="flex-1 bg-surface border border-surface-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleBrowse}
                className="px-3 py-1.5 bg-surface border border-surface-border rounded text-sm text-gray-300 hover:bg-surface-hover"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Default Sample Rate
            </label>
            <select
              value={localConfig.sample_rate}
              onChange={(e) =>
                setLocalConfig({
                  ...localConfig,
                  sample_rate: parseInt(e.target.value),
                })
              }
              className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
            >
              <option value={44100}>44,100 Hz</option>
              <option value={48000}>48,000 Hz</option>
              <option value={96000}>96,000 Hz</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Default Bit Depth
            </label>
            <select
              value={localConfig.bit_depth}
              onChange={(e) =>
                setLocalConfig({
                  ...localConfig,
                  bit_depth: parseInt(e.target.value),
                })
              }
              className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
            >
              <option value={16}>16-bit</option>
              <option value={24}>24-bit</option>
              <option value={32}>32-bit float</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded text-sm bg-accent text-white hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
