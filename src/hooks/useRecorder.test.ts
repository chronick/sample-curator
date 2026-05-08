import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../store/recorderStore", () => {
  const store: Record<string, any> = {
    setDevices: vi.fn(),
    setSelectedDeviceId: vi.fn(),
    setMonitoringState: vi.fn(),
    setRecordingState: vi.fn(),
    setElapsedTime: vi.fn(),
    setLevels: vi.fn(),
    setWaveformData: vi.fn(),
    setSpectrumData: vi.fn(),
    setConfig: vi.fn(),
    addRecording: vi.fn(),
    updateRecordingSampleId: vi.fn(),
    updateRecordingAfterSave: vi.fn(),
    setLastSavedSample: vi.fn(),
    setRecordingWaveform: vi.fn(),
    levels: { channels: [] },
    config: {
      sample_rate: 48000,
      bit_depth: 24,
      channels: 2,
      output_dir: "",
      default_device: null,
      arm_threshold_db: -40,
      arm_silence_ms: 2000,
      llm_ab_test: false,
    auto_stem_separation: false,    },
    isArmed: false,
    setIsArmed: vi.fn(),
    isRecording: false,
    isMonitoring: false,
  };
  return {
    useRecorderStore: Object.assign(
      (selector?: any) => (selector ? selector(store) : store),
      { getState: () => store, setState: vi.fn() }
    ),
  };
});

const mockInvoke = vi.mocked(invoke);

// Import after mocks are set up
import { useRecorder } from "./useRecorder";
import { useRecorderStore } from "../store/recorderStore";

describe("useRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();

    // Reset store mock call counts
    const store = useRecorderStore.getState();
    Object.values(store).forEach((val) => {
      if (typeof val === "function" && "mockClear" in val) {
        (val as ReturnType<typeof vi.fn>).mockClear();
      }
    });

    // Default: mount calls refreshDevices + get_config
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "recorder_list_audio_devices") return Promise.resolve([]);
      if (cmd === "recorder_get_config")
        return Promise.resolve({
          sample_rate: 48000,
          bit_depth: 24,
          channels: 2,
          output_dir: "",
          default_device: null,
        });
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshDevices calls recorder_list_audio_devices and updates store", async () => {
    const { result } = renderHook(() => useRecorder());

    // Wait for mount effects to settle
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Reset after mount calls
    mockInvoke.mockReset();

    const mockDevices = [
      { id: "dev-1", name: "Built-in Mic", is_default: true, max_channels: 2, default_sample_rate: 44100 },
      { id: "dev-2", name: "USB Audio", is_default: false, max_channels: 4, default_sample_rate: 48000 },
    ];
    mockInvoke.mockResolvedValueOnce(mockDevices);

    const store = useRecorderStore.getState();
    (store.setDevices as ReturnType<typeof vi.fn>).mockClear();

    let devices: any;
    await act(async () => {
      devices = await result.current.refreshDevices();
    });

    expect(mockInvoke).toHaveBeenCalledWith("recorder_list_audio_devices");
    expect(store.setDevices).toHaveBeenCalledWith(mockDevices);
    expect(devices).toEqual(mockDevices);
  });

  it("refreshDevices returns empty array on error", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockRejectedValueOnce(new Error("no audio subsystem"));

    let devices: any;
    await act(async () => {
      devices = await result.current.refreshDevices();
    });

    expect(devices).toEqual([]);
  });

  it("selectDevice calls recorder_select_device and sets monitoring state", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce(undefined); // recorder_select_device

    const store = useRecorderStore.getState();
    (store.setSelectedDeviceId as ReturnType<typeof vi.fn>).mockClear();
    (store.setMonitoringState as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.selectDevice("dev-2");
    });

    expect(mockInvoke).toHaveBeenCalledWith("recorder_select_device", { deviceId: "dev-2" });
    expect(store.setSelectedDeviceId).toHaveBeenCalledWith("dev-2");
    expect(store.setMonitoringState).toHaveBeenCalledWith(true);
  });

  it("selectDevice handles error gracefully", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockRejectedValueOnce(new Error("device not found"));

    const store = useRecorderStore.getState();
    (store.setSelectedDeviceId as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.selectDevice("bad-device");
    });

    // Store should not be updated on error
    expect(store.setSelectedDeviceId).not.toHaveBeenCalled();
  });

  it("startRecording calls recorder_start_recording with config from store", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce(undefined); // recorder_start_recording

    const store = useRecorderStore.getState();
    (store.setRecordingState as ReturnType<typeof vi.fn>).mockClear();
    (store.setElapsedTime as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockInvoke).toHaveBeenCalledWith("recorder_start_recording", {
      config: {
        sample_rate: 48000,
        bit_depth: 24,
        channels: 2,
        output_dir: null,
        session_name: null,
      },
    });
    expect(store.setRecordingState).toHaveBeenCalledWith(true);
    expect(store.setElapsedTime).toHaveBeenCalledWith(0);
  });

  it("startRecording handles error gracefully", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockRejectedValueOnce(new Error("audio stream busy"));

    const store = useRecorderStore.getState();
    (store.setRecordingState as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.startRecording();
    });

    expect(store.setRecordingState).not.toHaveBeenCalled();
  });

  it("stopRecording calls recorder_stop_recording and auto-saves to library", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();

    const mockRecordingInfo = {
      path: "/recordings/session-001.wav",
      duration_secs: 120.5,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      session_tag: "session:00000000-0000-4000-8000-000000000001",
    };
    const mockSaveResult = {
      sample_id: 42,
      original_path: "/recordings/session-001.wav",
      path: "/library/samples/amber-kick_20260415.wav",
      analyzed: true,
      pack_name: "Recordings",
      naming_tags: ["kick"],
      naming_method: "clap",
    };

    mockInvoke.mockResolvedValueOnce(mockRecordingInfo); // recorder_stop_recording
    mockInvoke.mockResolvedValueOnce(mockSaveResult); // recorder_save_to_library

    const store = useRecorderStore.getState();
    (store.setRecordingState as ReturnType<typeof vi.fn>).mockClear();
    (store.setElapsedTime as ReturnType<typeof vi.fn>).mockClear();
    (store.addRecording as ReturnType<typeof vi.fn>).mockClear();
    (store.setLastSavedSample as ReturnType<typeof vi.fn>).mockClear();
    (store.updateRecordingAfterSave as ReturnType<typeof vi.fn>).mockClear();

    let info: any;
    await act(async () => {
      info = await result.current.stopRecording();
    });

    expect(mockInvoke).toHaveBeenCalledWith("recorder_stop_recording");
    // sessionTag from RecordingInfo is forwarded so the backend can apply
    // the session:<UUID> tag even if the user disarms during the
    // writer-finalize → save_to_library window.
    expect(mockInvoke).toHaveBeenCalledWith("recorder_save_to_library", {
      path: "/recordings/session-001.wav",
      tags: ["recorded"],
      sessionTag: "session:00000000-0000-4000-8000-000000000001",
    });
    expect(store.setRecordingState).toHaveBeenCalledWith(false);
    expect(store.setElapsedTime).toHaveBeenCalledWith(0);
    expect(store.addRecording).toHaveBeenCalledWith(mockRecordingInfo);
    expect(store.setLastSavedSample).toHaveBeenCalledWith(mockSaveResult);
    expect(store.updateRecordingAfterSave).toHaveBeenCalledWith(
      "/recordings/session-001.wav",
      {
        newPath: "/library/samples/amber-kick_20260415.wav",
        sampleId: 42,
        namingTags: ["kick"],
        namingMethod: "clap",
      }
    );
    expect(info).toEqual(mockRecordingInfo);
  });

  it("stopRecording handles save_to_library failure gracefully", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();

    const mockRecordingInfo = {
      path: "/recordings/session-002.wav",
      duration_secs: 60.0,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
    };

    mockInvoke.mockResolvedValueOnce(mockRecordingInfo); // recorder_stop_recording
    mockInvoke.mockRejectedValueOnce(new Error("library unavailable")); // recorder_save_to_library fails

    const store = useRecorderStore.getState();
    (store.setRecordingState as ReturnType<typeof vi.fn>).mockClear();
    (store.addRecording as ReturnType<typeof vi.fn>).mockClear();
    (store.setLastSavedSample as ReturnType<typeof vi.fn>).mockClear();

    let info: any;
    await act(async () => {
      info = await result.current.stopRecording();
    });

    // Recording should still be saved locally even if library import fails
    expect(store.setRecordingState).toHaveBeenCalledWith(false);
    expect(store.addRecording).toHaveBeenCalledWith(mockRecordingInfo);
    expect(store.setLastSavedSample).not.toHaveBeenCalled();
    expect(info).toEqual(mockRecordingInfo);
  });

  it("stopRecording returns null when stop itself fails", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockRejectedValueOnce(new Error("nothing to stop"));

    const store = useRecorderStore.getState();
    (store.setRecordingState as ReturnType<typeof vi.fn>).mockClear();
    (store.addRecording as ReturnType<typeof vi.fn>).mockClear();

    let info: any;
    await act(async () => {
      info = await result.current.stopRecording();
    });

    expect(info).toBeNull();
    expect(store.setRecordingState).not.toHaveBeenCalled();
    expect(store.addRecording).not.toHaveBeenCalled();
  });

  it("openRecordingsDir calls recorder_open_recordings_dir", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.openRecordingsDir();
    });

    expect(mockInvoke).toHaveBeenCalledWith("recorder_open_recordings_dir");
  });

  it("openRecordingsDir handles error gracefully", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();
    mockInvoke.mockRejectedValueOnce(new Error("directory not found"));

    // Should not throw
    await act(async () => {
      await result.current.openRecordingsDir();
    });
  });

  it("stopRecording clears lastSavedSample after 3 seconds", async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    mockInvoke.mockReset();

    const mockRecordingInfo = {
      path: "/recordings/session-003.wav",
      duration_secs: 30.0,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
    };
    const mockSaveResult = {
      sample_id: 99,
      original_path: "/recordings/session-003.wav",
      path: "/library/samples/wisp-loop_20260415.wav",
      analyzed: true,
      pack_name: "Recordings",
      naming_tags: [],
      naming_method: "heuristic",
    };

    mockInvoke.mockResolvedValueOnce(mockRecordingInfo);
    mockInvoke.mockResolvedValueOnce(mockSaveResult);

    const store = useRecorderStore.getState();
    (store.setLastSavedSample as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(store.setLastSavedSample).toHaveBeenCalledWith(mockSaveResult);

    // Advance timers by 3 seconds to trigger the setTimeout
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(store.setLastSavedSample).toHaveBeenCalledWith(null);
  });
});
