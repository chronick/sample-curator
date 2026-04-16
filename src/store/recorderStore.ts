import { create } from "zustand";
import type {
  AudioDevice,
  LevelData,
  RecordingInfo,
  RecordingEntry,
  RecorderConfig,
  RecordingWaveformData,
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
  recentRecordings: RecordingEntry[];
  addRecording: (recording: RecordingInfo) => void;
  updateRecordingSampleId: (path: string, sampleId: number) => void;
  /**
   * Replace a pending recording's metadata after `recorder_save_to_library`
   * returns. Matches by `originalPath`, swaps in the post-rename path,
   * sample_id, ML tags, and naming method. Called from useRecorder's save
   * callback so the Recent list reflects the real filename + tags live.
   */
  updateRecordingAfterSave: (
    originalPath: string,
    patch: {
      newPath: string;
      sampleId: number;
      namingTags: string[];
      namingMethod: string;
      namingAlternative?: string;
      namingAlternativeMethod?: string;
    }
  ) => void;

  // Expanded recording
  expandedRecordingIndex: number | null;
  setExpandedRecordingIndex: (index: number | null) => void;

  // Recording waveform
  recordingWaveform: RecordingWaveformData | null;
  setRecordingWaveform: (data: RecordingWaveformData | null) => void;

  // Auto-import feedback
  lastSavedSample: SaveResult | null;
  setLastSavedSample: (result: SaveResult | null) => void;

  // Settings dialog
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // Arm mode (ephemeral — not persisted; threshold/silence live in config)
  isArmed: boolean;
  setIsArmed: (armed: boolean) => void;
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
    arm_threshold_db: -40,
    arm_silence_ms: 2000,
    llm_ab_test: false,
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
      // Mark the entry as `saving: true` — the backend will rename the file
      // and insert into the library asynchronously. updateRecordingAfterSave
      // (or the catch path) clears this flag once the IPC completes.
      recentRecordings: [
        { ...recording, saving: true },
        ...state.recentRecordings,
      ].slice(0, 20),
    })),
  updateRecordingSampleId: (path, sampleId) =>
    set((state) => ({
      recentRecordings: state.recentRecordings.map((rec) =>
        rec.path === path ? { ...rec, sample_id: sampleId } : rec
      ),
    })),
  updateRecordingAfterSave: (originalPath, patch) =>
    set((state) => ({
      recentRecordings: state.recentRecordings.map((rec) =>
        rec.path === originalPath
          ? {
              ...rec,
              path: patch.newPath,
              sample_id: patch.sampleId,
              naming_tags: patch.namingTags,
              naming_method: patch.namingMethod,
              naming_alternative: patch.namingAlternative,
              naming_alternative_method: patch.namingAlternativeMethod,
              saving: false,
            }
          : rec
      ),
    })),

  // Expanded recording
  expandedRecordingIndex: null,
  setExpandedRecordingIndex: (expandedRecordingIndex) => set({ expandedRecordingIndex }),

  // Recording waveform
  recordingWaveform: null,
  setRecordingWaveform: (recordingWaveform) => set({ recordingWaveform }),

  // Auto-import
  lastSavedSample: null,
  setLastSavedSample: (lastSavedSample) => set({ lastSavedSample }),

  // Settings
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  // Arm mode
  isArmed: false,
  setIsArmed: (isArmed) => set({ isArmed }),
}));
