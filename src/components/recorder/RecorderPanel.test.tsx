import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecorderPanel } from "./RecorderPanel";

vi.mock("./DeviceSelector", () => ({ DeviceSelector: () => <div data-testid="device-selector" /> }));
vi.mock("./ConfigBar", () => ({ ConfigBar: () => <div data-testid="config-bar" /> }));
vi.mock("./WaveformDisplay", () => ({ WaveformDisplay: () => <div data-testid="waveform" /> }));
vi.mock("./SpectrumDisplay", () => ({ SpectrumDisplay: () => <div data-testid="spectrum" /> }));
vi.mock("./LevelMeter", () => ({ LevelMeter: () => <div data-testid="level-meter" /> }));
vi.mock("./RecordButton", () => ({ RecordButton: () => <div data-testid="record-button" /> }));
vi.mock("./RecordingsList", () => ({ RecordingsList: () => <div data-testid="recordings-list" /> }));
vi.mock("./RecorderSettingsDialog", () => ({ RecorderSettingsDialog: () => <div data-testid="settings-dialog" /> }));
vi.mock("./ArmControls", () => ({ ArmControls: () => <div data-testid="arm-controls" /> }));

const mockSetSettingsOpen = vi.fn();
const mockOpenRecordingsDir = vi.fn();

const mockState: Record<string, any> = {
  setSettingsOpen: mockSetSettingsOpen,
  config: { sample_rate: 48000, bit_depth: 24, channels: 2, output_dir: "", default_device: null, arm_threshold_db: -40, arm_silence_ms: 2000 },
  lastSavedSample: null,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("../../store", () => ({
  useStore: (selector: any) => selector({
    setActiveView: vi.fn(),
    setFilters: vi.fn(),
    setSort: vi.fn(),
  }),
}));

vi.mock("../../hooks/useRecorder", () => ({
  useRecorder: () => ({
    selectDevice: vi.fn(),
    refreshDevices: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    openRecordingsDir: mockOpenRecordingsDir,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }),
}));

describe("RecorderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.lastSavedSample = null;
    mockState.config = {
      sample_rate: 48000,
      bit_depth: 24,
      channels: 2,
      output_dir: "",
      default_device: null,
      arm_threshold_db: -40,
      arm_silence_ms: 2000,
    };
  });

  it("renders all sub-components", () => {
    render(<RecorderPanel />);
    expect(screen.getByTestId("device-selector")).toBeInTheDocument();
    expect(screen.getByTestId("config-bar")).toBeInTheDocument();
    expect(screen.getByTestId("waveform")).toBeInTheDocument();
    expect(screen.getByTestId("spectrum")).toBeInTheDocument();
    expect(screen.getByTestId("level-meter")).toBeInTheDocument();
    expect(screen.getByTestId("record-button")).toBeInTheDocument();
    expect(screen.getByTestId("recordings-list")).toBeInTheDocument();
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("arm-controls")).toBeInTheDocument();
  });

  it("shows Settings button and click calls setSettingsOpen(true)", () => {
    render(<RecorderPanel />);
    const btn = screen.getByText("Settings");
    fireEvent.click(btn);
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(true);
  });

  it("shows Open folder button and click calls openRecordingsDir", () => {
    render(<RecorderPanel />);
    const btn = screen.getByText("Open folder");
    fireEvent.click(btn);
    expect(mockOpenRecordingsDir).toHaveBeenCalled();
  });

  it("shows config summary", () => {
    render(<RecorderPanel />);
    expect(screen.getByText(/48kHz/)).toBeInTheDocument();
    expect(screen.getByText(/24-bit/)).toBeInTheDocument();
    expect(screen.getByText(/Stereo/)).toBeInTheDocument();
  });

  it("shows 44.1kHz format for 44100 sample rate", () => {
    mockState.config = { sample_rate: 44100, bit_depth: 16, channels: 1, output_dir: "", default_device: null, arm_threshold_db: -40, arm_silence_ms: 2000 };
    render(<RecorderPanel />);
    expect(screen.getByText(/44\.1kHz/)).toBeInTheDocument();
    expect(screen.getByText(/Mono/)).toBeInTheDocument();
  });

  it("does NOT show Saved to library when lastSavedSample is null", () => {
    render(<RecorderPanel />);
    expect(screen.queryByText("Saved to library")).not.toBeInTheDocument();
  });

  it("shows Saved to library when lastSavedSample is set", () => {
    mockState.lastSavedSample = { sample_id: 42, path: "/test.wav", analyzed: true, pack_name: "Recordings" };
    render(<RecorderPanel />);
    expect(screen.getByText("Saved to library")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("shows Analyzed text when analyzed is true", () => {
    mockState.lastSavedSample = { sample_id: 10, path: "/test.wav", analyzed: true, pack_name: null };
    render(<RecorderPanel />);
    expect(screen.getByText("Analyzed")).toBeInTheDocument();
  });

  it("does NOT show Analyzed text when analyzed is false", () => {
    mockState.lastSavedSample = { sample_id: 10, path: "/test.wav", analyzed: false, pack_name: null };
    render(<RecorderPanel />);
    expect(screen.queryByText("Analyzed")).not.toBeInTheDocument();
  });

  it("shows pack name when pack_name is set", () => {
    mockState.lastSavedSample = { sample_id: 10, path: "/test.wav", analyzed: false, pack_name: "Recordings" };
    render(<RecorderPanel />);
    expect(screen.getByText("Recordings")).toBeInTheDocument();
  });

  it("does NOT show pack name when pack_name is null", () => {
    mockState.lastSavedSample = { sample_id: 10, path: "/test.wav", analyzed: true, pack_name: null };
    render(<RecorderPanel />);
    expect(screen.queryByText("Recordings")).not.toBeInTheDocument();
  });
});
