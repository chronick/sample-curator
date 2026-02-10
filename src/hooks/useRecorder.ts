import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../store/recorderStore";
import type { AudioDevice, RecordingInfo, RecorderConfig, SaveResult } from "../types/recorder";

export function useRecorder() {
  const store = useRecorderStore();
  const animFrameRef = useRef<number>(0);
  const pollingRef = useRef(false);
  const initializedRef = useRef(false);

  // Load devices and config on mount (only once across all hook instances)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    refreshDevices();
    invoke<RecorderConfig>("recorder_get_config")
      .then((config) => {
        store.setConfig(config);
        if (config.default_device) {
          selectDevice(config.default_device);
        }
      })
      .catch((e) => console.warn("Failed to load recorder config:", e));

    return () => {
      pollingRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await invoke<AudioDevice[]>("recorder_list_audio_devices");
      store.setDevices(devices);
      return devices;
    } catch (e) {
      console.warn("Failed to list audio devices:", e);
      return [];
    }
  }, []);

  // Polling loop for visualization data
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    const poll = async () => {
      if (!pollingRef.current) return;

      try {
        const [levels, waveform, spectrum, status] = await Promise.all([
          invoke<{ channels: Array<{ rms_db: number; peak_db: number }> }>("recorder_get_audio_levels"),
          invoke<number[]>("recorder_get_waveform_data", { numSamples: 1024 }),
          invoke<number[]>("recorder_get_spectrum_data", { numBins: 128 }),
          invoke<{ is_recording: boolean; is_monitoring: boolean; elapsed_secs: number }>(
            "recorder_get_recording_status"
          ),
        ]);

        store.setLevels(levels);
        store.setWaveformData(waveform);
        store.setSpectrumData(spectrum);

        // Only update boolean states when they actually change to avoid re-renders
        const currentState = useRecorderStore.getState();
        if (currentState.isRecording !== status.is_recording) {
          store.setRecordingState(status.is_recording);
        }
        if (currentState.isMonitoring !== status.is_monitoring) {
          store.setMonitoringState(status.is_monitoring);
        }
        if (status.is_recording) {
          store.setElapsedTime(status.elapsed_secs);
        }
      } catch (e) {
        console.error("Recorder polling error:", e);
      }

      animFrameRef.current = requestAnimationFrame(poll);
    };

    animFrameRef.current = requestAnimationFrame(poll);
  }, []);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      try {
        await invoke("recorder_select_device", { deviceId });
        store.setSelectedDeviceId(deviceId);
        store.setMonitoringState(true);
        startPolling();
      } catch (e) {
        console.error("Failed to select device:", e);
      }
    },
    [startPolling]
  );

  const startRecording = useCallback(async () => {
    const { config } = useRecorderStore.getState();
    try {
      await invoke("recorder_start_recording", {
        config: {
          sample_rate: config.sample_rate,
          bit_depth: config.bit_depth,
          channels: config.channels,
          output_dir: config.output_dir || null,
          session_name: null,
        },
      });
      store.setRecordingState(true);
      store.setElapsedTime(0);
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      const info = await invoke<RecordingInfo>("recorder_stop_recording");
      store.setRecordingState(false);
      store.setElapsedTime(0);
      store.addRecording(info);

      // Auto-save to library
      try {
        const result = await invoke<SaveResult>("recorder_save_to_library", {
          path: info.path,
          tags: ["recorded"],
        });
        store.setLastSavedSample(result);
        // Clear notification after 3 seconds
        setTimeout(() => {
          useRecorderStore.getState().setLastSavedSample(null);
        }, 3000);
      } catch (e) {
        console.warn("Recording saved locally but failed to import to library:", e);
      }

      return info;
    } catch (e) {
      console.error("Failed to stop recording:", e);
      return null;
    }
  }, []);

  const openRecordingsDir = useCallback(async () => {
    try {
      await invoke("recorder_open_recordings_dir");
    } catch (e) {
      console.error("Failed to open recordings directory:", e);
    }
  }, []);

  return {
    selectDevice,
    startRecording,
    stopRecording,
    startPolling,
    stopPolling,
    refreshDevices,
    openRecordingsDir,
  };
}
