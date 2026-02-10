import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordButton } from "./RecordButton";

const mockStartRecording = vi.fn();
const mockStopRecording = vi.fn();

const mockState: Record<string, any> = {
  isRecording: false,
  isMonitoring: false,
  elapsedTime: 0,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("../../store", () => ({
  useStore: (selector: any) => selector({ activeView: "record" }),
}));

vi.mock("../../hooks/useRecorder", () => ({
  useRecorder: () => ({
    selectDevice: vi.fn(),
    refreshDevices: vi.fn(),
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
    openRecordingsDir: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }),
}));

describe("RecordButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.isRecording = false;
    mockState.isMonitoring = false;
    mockState.elapsedTime = 0;
  });

  it("shows Select a device when not monitoring", () => {
    render(<RecordButton />);
    expect(screen.getByText("Select a device")).toBeInTheDocument();
  });

  it("shows R to record when monitoring but not recording", () => {
    mockState.isMonitoring = true;
    render(<RecordButton />);
    expect(screen.getByText("R to record")).toBeInTheDocument();
  });

  it("shows Space to stop when recording", () => {
    mockState.isMonitoring = true;
    mockState.isRecording = true;
    render(<RecordButton />);
    expect(screen.getByText("Space to stop")).toBeInTheDocument();
  });

  it("shows elapsed time formatted as 00:00:00 initially", () => {
    render(<RecordButton />);
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
  });

  it("shows formatted elapsed time", () => {
    mockState.elapsedTime = 3661; // 1h 1m 1s
    render(<RecordButton />);
    expect(screen.getByText("01:01:01")).toBeInTheDocument();
  });

  it("button is disabled when not monitoring", () => {
    render(<RecordButton />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("click calls startRecording when monitoring", () => {
    mockState.isMonitoring = true;
    render(<RecordButton />);
    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(mockStartRecording).toHaveBeenCalled();
  });

  it("click calls stopRecording when recording", () => {
    mockState.isMonitoring = true;
    mockState.isRecording = true;
    render(<RecordButton />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(mockStopRecording).toHaveBeenCalled();
  });
});
