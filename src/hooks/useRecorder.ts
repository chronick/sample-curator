import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../store/recorderStore";
import { useArmMode } from "./useArmMode";
import type { AudioDevice, RecordingInfo, RecorderConfig, RecordingWaveformData, SaveResult } from "../types/recorder";

export function useRecorder() {
  const store = useRecorderStore();
  const animFrameRef = useRef<number>(0);
  const pollingRef = useRef(false);
  const initializedRef = useRef(false);
  const waveformPollRef = useRef<number>(0);
  const waveformPollActiveRef = useRef(false);

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
      waveformPollActiveRef.current = false;
      if (waveformPollRef.current) {
        window.clearTimeout(waveformPollRef.current);
        waveformPollRef.current = 0;
      }
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

  // Polling loop for visualization data.
  // During recording: throttled to ~20fps via setTimeout (only levels + status needed).
  // When idle: full 60fps via rAF (levels + waveform + spectrum).
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    const poll = async () => {
      if (!pollingRef.current) return;

      try {
        const isRec = useRecorderStore.getState().isRecording;

        // During recording, skip live waveform (recording waveform replaces it)
        // but keep spectrum/FFT active so the user can see frequency content.
        const [levels, status, waveform, spectrum] = await Promise.all([
          invoke<{ channels: Array<{ rms_db: number; peak_db: number }> }>("recorder_get_audio_levels"),
          invoke<{ is_recording: boolean; is_monitoring: boolean; elapsed_secs: number }>(
            "recorder_get_recording_status"
          ),
          isRec ? Promise.resolve(null) : invoke<number[]>("recorder_get_waveform_data", { numSamples: 1024 }),
          invoke<number[]>("recorder_get_spectrum_data", { numBins: 128 }),
        ]);

        store.setLevels(levels);
        if (waveform) store.setWaveformData(waveform);
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

      if (!pollingRef.current) return;
      animFrameRef.current = requestAnimationFrame(poll);
    };

    animFrameRef.current = requestAnimationFrame(poll);
  }, []);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    waveformPollActiveRef.current = false;
    if (waveformPollRef.current) {
      window.clearTimeout(waveformPollRef.current);
      waveformPollRef.current = 0;
    }
  }, []);

  // Non-overlapping recording waveform poll (~10Hz).
  // Uses setTimeout so the next poll only fires after the previous IPC completes.
  const startWaveformPoll = useCallback(() => {
    if (waveformPollActiveRef.current) return;
    waveformPollActiveRef.current = true;

    const poll = async () => {
      if (!waveformPollActiveRef.current) return;
      try {
        const recWaveform = await invoke<RecordingWaveformData>(
          "recorder_get_recording_waveform",
          { numBars: 800 }
        );
        if (waveformPollActiveRef.current) {
          useRecorderStore.getState().setRecordingWaveform(recWaveform);
        }
      } catch {
        // Ignore — not critical
      }
      if (waveformPollActiveRef.current) {
        waveformPollRef.current = window.setTimeout(poll, 100);
      }
    };
    poll();
  }, []);

  const stopWaveformPoll = useCallback(() => {
    waveformPollActiveRef.current = false;
    if (waveformPollRef.current) {
      window.clearTimeout(waveformPollRef.current);
      waveformPollRef.current = 0;
    }
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
      store.setRecordingWaveform(null);
      startWaveformPoll();
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }, [startWaveformPoll]);

  const stopRecording = useCallback(async () => {
    try {
      stopWaveformPoll();
      const info = await invoke<RecordingInfo>("recorder_stop_recording");
      store.setRecordingState(false);
      store.setElapsedTime(0);
      store.addRecording(info);

      // Fire-and-forget: save + analyze in background — don't block the UI.
      // The backend auto-renames the file (CLAP / heuristic / heroku) before
      // inserting into the library. We swap the Recent list entry in place
      // with the post-rename path + ML tags + method so the user sees the
      // final filename + badge as soon as save completes.
      invoke<SaveResult>("recorder_save_to_library", {
        path: info.path,
        tags: ["recorded"],
      })
        .then((result) => {
          const s = useRecorderStore.getState();
          s.setLastSavedSample(result);
          s.updateRecordingAfterSave(result.original_path ?? info.path, {
            newPath: result.path,
            sampleId: result.sample_id,
            namingTags: result.naming_tags ?? [],
            namingMethod: result.naming_method ?? "unknown",
            namingAlternative: result.naming_alternative,
            namingAlternativeMethod: result.naming_alternative_method,
          });
          setTimeout(() => {
            useRecorderStore.getState().setLastSavedSample(null);
          }, 3000);
        })
        .catch((e) => {
          console.warn("Recording saved locally but failed to import to library:", e);
          // Clear the pending flag even on failure so the user can at least
          // attempt playback (if the file happens to exist under its original
          // name) or delete the entry manually.
          useRecorderStore.setState((state) => ({
            recentRecordings: state.recentRecordings.map((rec) =>
              rec.path === info.path ? { ...rec, saving: false } : rec
            ),
          }));
        });

      return info;
    } catch (e) {
      console.error("Failed to stop recording:", e);
      return null;
    }
  }, [stopWaveformPoll]);

  const openRecordingsDir = useCallback(async () => {
    try {
      await invoke("recorder_open_recordings_dir");
    } catch (e) {
      console.error("Failed to open recordings directory:", e);
    }
  }, []);

  // Arm-mode state machine: watches polled levels and drives start/stop.
  // Safe to wire unconditionally — it no-ops unless the user arms recording.
  useArmMode({ startRecording, stopRecording });

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
