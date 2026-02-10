import { create } from "zustand";
import type {
  AudioDevice,
  LevelData,
  RecordingInfo,
  RecorderConfig,
  SaveResult,
} from "../types/recorder";

interface RecorderStore {
  // Devices
  devices: AudioDevice[];
  selectedDeviceId: string | null;
  setDevices: (devices: AudioDevice[]) => void;
  setSelectedDeviceId: (id: string | null) => void;

  // Config
  config: RecorderConfig;
  setConfig: (config: RecorderConfig) => void;
  updateConfig: (partial: Partial<RecorderConfig>) => void;

  // Recording state
  isRecording: boolean;
  isMonitoring: boolean;
  elapsedTime: number;
  setRecordingState: (recording: boolean) => void;
  setMonitoringState: (monitoring: boolean) => void;
  setElapsedTime: (time: number) => void;

  // Visualization data
  levels: LevelData;
  waveformData: number[];
  spectrumData: number[];
  setLevels: (levels: LevelData) => void;
  setWaveformData: (data: number[]) => void;
  setSpectrumData: (data: number[]) => void;

  // Recent recordings
  recentRecordings: RecordingInfo[];
  addRecording: (recording: RecordingInfo) => void;

  // Auto-import feedback
  lastSavedSample: SaveResult | null;
  setLastSavedSample: (result: SaveResult | null) => void;

  // Settings dialog
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useRecorderStore = create<RecorderStore>((set) => ({
  // Devices
  devices: [],
  selectedDeviceId: null,
  setDevices: (devices) => set({ devices }),
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),

  // Config
  config: {
    sample_rate: 48000,
    bit_depth: 24,
    channels: 2,
    output_dir: "",
    default_device: null,
  },
  setConfig: (config) => set({ config }),
  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),

  // Recording state
  isRecording: false,
  isMonitoring: false,
  elapsedTime: 0,
  setRecordingState: (isRecording) => set({ isRecording }),
  setMonitoringState: (isMonitoring) => set({ isMonitoring }),
  setElapsedTime: (elapsedTime) => set({ elapsedTime }),

  // Visualization data
  levels: { channels: [] },
  waveformData: [],
  spectrumData: [],
  setLevels: (levels) => set({ levels }),
  setWaveformData: (waveformData) => set({ waveformData }),
  setSpectrumData: (spectrumData) => set({ spectrumData }),

  // Recent recordings
  recentRecordings: [],
  addRecording: (recording) =>
    set((state) => ({
      recentRecordings: [recording, ...state.recentRecordings].slice(0, 20),
    })),

  // Auto-import
  lastSavedSample: null,
  setLastSavedSample: (lastSavedSample) => set({ lastSavedSample }),

  // Settings
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
