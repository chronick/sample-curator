import { describe, it, expect, beforeEach } from 'vitest';
import { useRecorderStore } from './recorderStore';
import type { AudioDevice, RecordingInfo, SaveResult } from '../types/recorder';

// Helper to create a mock audio device
function makeDevice(overrides: Partial<AudioDevice> = {}): AudioDevice {
  return {
    id: 'device-1',
    name: 'Built-in Microphone',
    is_default: false,
    max_channels: 2,
    default_sample_rate: 48000,
    ...overrides,
  };
}

// Helper to create a mock recording info
function makeRecording(overrides: Partial<RecordingInfo> = {}): RecordingInfo {
  return {
    path: '/recordings/session-001.wav',
    duration_secs: 120,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    ...overrides,
  };
}

describe('useRecorderStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useRecorderStore.setState({
      devices: [],
      selectedDeviceId: null,
      config: {
        sample_rate: 48000,
        bit_depth: 24,
        channels: 2,
        output_dir: '',
        default_device: null,
      },
      isRecording: false,
      isMonitoring: false,
      elapsedTime: 0,
      levels: { channels: [] },
      waveformData: [],
      spectrumData: [],
      recentRecordings: [],
      lastSavedSample: null,
      settingsOpen: false,
    });
  });

  it('has correct initial state', () => {
    const state = useRecorderStore.getState();
    expect(state.devices).toEqual([]);
    expect(state.selectedDeviceId).toBeNull();
    expect(state.config.sample_rate).toBe(48000);
    expect(state.config.bit_depth).toBe(24);
    expect(state.config.channels).toBe(2);
    expect(state.config.output_dir).toBe('');
    expect(state.config.default_device).toBeNull();
    expect(state.isRecording).toBe(false);
    expect(state.isMonitoring).toBe(false);
    expect(state.elapsedTime).toBe(0);
    expect(state.levels).toEqual({ channels: [] });
    expect(state.waveformData).toEqual([]);
    expect(state.spectrumData).toEqual([]);
    expect(state.recentRecordings).toEqual([]);
    expect(state.lastSavedSample).toBeNull();
    expect(state.settingsOpen).toBe(false);
  });

  it('setDevices updates the device list', () => {
    const devices = [
      makeDevice({ id: 'mic-1', name: 'Built-in Microphone', is_default: true }),
      makeDevice({ id: 'usb-1', name: 'USB Audio Interface', max_channels: 8 }),
    ];
    useRecorderStore.getState().setDevices(devices);

    const state = useRecorderStore.getState();
    expect(state.devices).toHaveLength(2);
    expect(state.devices[0].id).toBe('mic-1');
    expect(state.devices[1].name).toBe('USB Audio Interface');
  });

  it('setSelectedDeviceId selects a device', () => {
    useRecorderStore.getState().setSelectedDeviceId('usb-1');
    expect(useRecorderStore.getState().selectedDeviceId).toBe('usb-1');
  });

  it('setSelectedDeviceId clears selection with null', () => {
    useRecorderStore.getState().setSelectedDeviceId('usb-1');
    useRecorderStore.getState().setSelectedDeviceId(null);
    expect(useRecorderStore.getState().selectedDeviceId).toBeNull();
  });

  it('setConfig replaces entire config', () => {
    const newConfig = {
      sample_rate: 96000,
      bit_depth: 32,
      channels: 1,
      output_dir: '/output',
      default_device: 'usb-1',
    };
    useRecorderStore.getState().setConfig(newConfig);

    const state = useRecorderStore.getState();
    expect(state.config.sample_rate).toBe(96000);
    expect(state.config.bit_depth).toBe(32);
    expect(state.config.channels).toBe(1);
    expect(state.config.output_dir).toBe('/output');
    expect(state.config.default_device).toBe('usb-1');
  });

  it('updateConfig merges partial config preserving other fields', () => {
    useRecorderStore.getState().updateConfig({ sample_rate: 96000 });

    const state = useRecorderStore.getState();
    expect(state.config.sample_rate).toBe(96000);
    // Other fields unchanged
    expect(state.config.bit_depth).toBe(24);
    expect(state.config.channels).toBe(2);
    expect(state.config.output_dir).toBe('');
    expect(state.config.default_device).toBeNull();
  });

  it('updateConfig can update multiple fields at once', () => {
    useRecorderStore.getState().updateConfig({
      sample_rate: 44100,
      bit_depth: 16,
      output_dir: '/new-output',
    });

    const state = useRecorderStore.getState();
    expect(state.config.sample_rate).toBe(44100);
    expect(state.config.bit_depth).toBe(16);
    expect(state.config.output_dir).toBe('/new-output');
    // Untouched fields
    expect(state.config.channels).toBe(2);
    expect(state.config.default_device).toBeNull();
  });

  it('setRecordingState starts recording', () => {
    useRecorderStore.getState().setRecordingState(true);
    expect(useRecorderStore.getState().isRecording).toBe(true);
  });

  it('setRecordingState stops recording', () => {
    useRecorderStore.getState().setRecordingState(true);
    useRecorderStore.getState().setRecordingState(false);
    expect(useRecorderStore.getState().isRecording).toBe(false);
  });

  it('setMonitoringState starts monitoring', () => {
    useRecorderStore.getState().setMonitoringState(true);
    expect(useRecorderStore.getState().isMonitoring).toBe(true);
  });

  it('setMonitoringState stops monitoring', () => {
    useRecorderStore.getState().setMonitoringState(true);
    useRecorderStore.getState().setMonitoringState(false);
    expect(useRecorderStore.getState().isMonitoring).toBe(false);
  });

  it('setElapsedTime updates elapsed time', () => {
    useRecorderStore.getState().setElapsedTime(42.5);
    expect(useRecorderStore.getState().elapsedTime).toBe(42.5);
  });

  it('setLevels updates channel levels', () => {
    const levels = {
      channels: [
        { rms_db: -12.5, peak_db: -3.0 },
        { rms_db: -14.0, peak_db: -5.0 },
      ],
    };
    useRecorderStore.getState().setLevels(levels);

    const state = useRecorderStore.getState();
    expect(state.levels.channels).toHaveLength(2);
    expect(state.levels.channels[0].rms_db).toBe(-12.5);
    expect(state.levels.channels[1].peak_db).toBe(-5.0);
  });

  it('setWaveformData updates waveform data', () => {
    const waveform = [0.1, -0.3, 0.5, -0.2, 0.8];
    useRecorderStore.getState().setWaveformData(waveform);
    expect(useRecorderStore.getState().waveformData).toEqual(waveform);
  });

  it('setSpectrumData updates spectrum data', () => {
    const spectrum = [0.0, 0.2, 0.8, 0.5, 0.1];
    useRecorderStore.getState().setSpectrumData(spectrum);
    expect(useRecorderStore.getState().spectrumData).toEqual(spectrum);
  });

  it('addRecording prepends recording in LIFO order', () => {
    const rec1 = makeRecording({ path: '/recordings/first.wav' });
    const rec2 = makeRecording({ path: '/recordings/second.wav' });

    useRecorderStore.getState().addRecording(rec1);
    useRecorderStore.getState().addRecording(rec2);

    const state = useRecorderStore.getState();
    expect(state.recentRecordings).toHaveLength(2);
    expect(state.recentRecordings[0].path).toBe('/recordings/second.wav');
    expect(state.recentRecordings[1].path).toBe('/recordings/first.wav');
  });

  it('addRecording caps at 20 recordings', () => {
    // Add 22 recordings
    for (let i = 0; i < 22; i++) {
      useRecorderStore.getState().addRecording(
        makeRecording({ path: `/recordings/session-${i.toString().padStart(3, '0')}.wav` })
      );
    }

    const state = useRecorderStore.getState();
    expect(state.recentRecordings).toHaveLength(20);
    // Most recent should be first (LIFO)
    expect(state.recentRecordings[0].path).toBe('/recordings/session-021.wav');
    // Oldest kept should be session-002 (sessions 000 and 001 were dropped)
    expect(state.recentRecordings[19].path).toBe('/recordings/session-002.wav');
  });

  it('setLastSavedSample sets a save result', () => {
    const result: SaveResult = { sample_id: 42, path: '/library/kick-001.wav' };
    useRecorderStore.getState().setLastSavedSample(result);

    const state = useRecorderStore.getState();
    expect(state.lastSavedSample).not.toBeNull();
    expect(state.lastSavedSample!.sample_id).toBe(42);
    expect(state.lastSavedSample!.path).toBe('/library/kick-001.wav');
  });

  it('setLastSavedSample clears with null', () => {
    const result: SaveResult = { sample_id: 42, path: '/library/kick-001.wav' };
    useRecorderStore.getState().setLastSavedSample(result);
    useRecorderStore.getState().setLastSavedSample(null);
    expect(useRecorderStore.getState().lastSavedSample).toBeNull();
  });

  it('setSettingsOpen opens settings dialog', () => {
    useRecorderStore.getState().setSettingsOpen(true);
    expect(useRecorderStore.getState().settingsOpen).toBe(true);
  });

  it('setSettingsOpen closes settings dialog', () => {
    useRecorderStore.getState().setSettingsOpen(true);
    useRecorderStore.getState().setSettingsOpen(false);
    expect(useRecorderStore.getState().settingsOpen).toBe(false);
  });
});
