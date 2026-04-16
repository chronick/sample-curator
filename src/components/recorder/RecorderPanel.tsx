import { DeviceSelector } from "./DeviceSelector";
import { ConfigBar } from "./ConfigBar";
import { WaveformDisplay } from "./WaveformDisplay";
import { SpectrumDisplay } from "./SpectrumDisplay";
import { LevelMeter } from "./LevelMeter";
import { RecordButton } from "./RecordButton";
import { RecordingsList } from "./RecordingsList";
import { RecorderSettingsDialog } from "./RecorderSettingsDialog";
import { ArmControls } from "./ArmControls";
import { useRecorderStore } from "../../store/recorderStore";
import { useRecorder } from "../../hooks/useRecorder";
import { useStore } from "../../store";

export function RecorderPanel() {
  const setSettingsOpen = useRecorderStore((s) => s.setSettingsOpen);
  const config = useRecorderStore((s) => s.config);
  const lastSaved = useRecorderStore((s) => s.lastSavedSample);
  const { openRecordingsDir } = useRecorder();
  const setActiveView = useStore((s) => s.setActiveView);
  const setFilters = useStore((s) => s.setFilters);
  const setSort = useStore((s) => s.setSort);

  const viewInBrowser = () => {
    setFilters({ tags: ["recorded"], offset: 0 });
    setSort("created_at", "desc");
    setActiveView("browse");
  };

  const formatRate = (rate: number) =>
    rate === 44100 ? "44.1kHz" : `${rate / 1000}kHz`;

  const formatChannels = (n: number) => {
    if (n === 1) return "Mono";
    if (n === 2) return "Stereo";
    return `${n}ch`;
  };

  return (
    <div className="h-full flex flex-col bg-surface text-white">
      {/* Config bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-border">
        <DeviceSelector />
        <div className="flex items-center gap-4">
          <ConfigBar />
          <span className="text-xs text-gray-500">
            {formatRate(config.sample_rate)} · {config.bit_depth}-bit ·{" "}
            {formatChannels(config.channels)}
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-gray-400 hover:text-white text-sm"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Arm-mode controls */}
      <ArmControls />

      {/* Auto-import notification */}
      {lastSaved && (
        <div className="px-4 py-1.5 bg-green-900/20 border-b border-green-700/30 text-xs text-green-400 flex items-center gap-2">
          <span>Saved to library</span>
          {lastSaved.analyzed && <span className="text-green-600">Analyzed</span>}
          {lastSaved.pack_name && (
            <span className="text-green-600">{lastSaved.pack_name}</span>
          )}
          <span className="text-green-600">#{lastSaved.sample_id}</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col gap-4 px-4 py-4 overflow-auto">
        <WaveformDisplay />
        <SpectrumDisplay />
        <LevelMeter />
        <div className="flex justify-center py-4">
          <RecordButton />
        </div>
      </div>

      {/* Footer: Recent recordings */}
      <div className="px-4 py-2 border-t border-surface-border">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-gray-500">Recent</div>
          <div className="flex items-center gap-3">
            <button
              onClick={viewInBrowser}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              title="View recordings in sample browser"
            >
              View in Browser
            </button>
            <button
              onClick={openRecordingsDir}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              title="Open recordings folder"
            >
              Open folder
            </button>
          </div>
        </div>
        <RecordingsList />
      </div>

      {/* Settings modal */}
      <RecorderSettingsDialog />
    </div>
  );
}
