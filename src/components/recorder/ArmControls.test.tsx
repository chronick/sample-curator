import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArmControls } from "./ArmControls";

const mockUpdateConfig = vi.fn();
const mockSetIsArmed = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

const baseState = () => ({
  isArmed: false,
  setIsArmed: mockSetIsArmed,
  isRecording: false,
  isMonitoring: true,
  config: {
    sample_rate: 48000,
    bit_depth: 24,
    channels: 2,
    output_dir: "",
    default_device: null,
    arm_threshold_db: -40,
    arm_silence_ms: 2000,
  },
  updateConfig: mockUpdateConfig,
});

let mockState: any = baseState();

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("ArmControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = baseState();
  });

  it("shows 'Arm' button and 'Disarmed' status when disarmed", () => {
    render(<ArmControls />);
    expect(screen.getByRole("button", { name: /arm/i })).toBeInTheDocument();
    expect(screen.getByTestId("arm-status")).toHaveTextContent("Disarmed");
  });

  it("shows 'Armed' + 'Waiting…' when armed and not recording", () => {
    mockState.isArmed = true;
    render(<ArmControls />);
    expect(screen.getByRole("button", { name: /armed/i })).toBeInTheDocument();
    expect(screen.getByTestId("arm-status")).toHaveTextContent("Waiting");
  });

  it("shows 'Recording' when armed and actively recording", () => {
    mockState.isArmed = true;
    mockState.isRecording = true;
    render(<ArmControls />);
    expect(screen.getByTestId("arm-status")).toHaveTextContent("Recording");
  });

  it("disables arm button when not monitoring", () => {
    mockState.isMonitoring = false;
    render(<ArmControls />);
    const btn = screen.getByRole("button", { name: /arm/i });
    expect(btn).toBeDisabled();
  });

  it("toggles arm state when clicked", () => {
    render(<ArmControls />);
    fireEvent.click(screen.getByRole("button", { name: /arm/i }));
    expect(mockSetIsArmed).toHaveBeenCalledWith(true);
  });

  it("persists threshold change to store and backend", () => {
    render(<ArmControls />);
    const slider = screen.getByLabelText(/Arm threshold/i);
    fireEvent.change(slider, { target: { value: "-30" } });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ arm_threshold_db: -30 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "recorder_set_config",
      expect.objectContaining({
        config: expect.objectContaining({ arm_threshold_db: -30 }),
      })
    );
  });

  it("persists silence duration change to store and backend", () => {
    render(<ArmControls />);
    const input = screen.getByLabelText(/Arm silence duration/i);
    fireEvent.change(input, { target: { value: "1500" } });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ arm_silence_ms: 1500 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "recorder_set_config",
      expect.objectContaining({
        config: expect.objectContaining({ arm_silence_ms: 1500 }),
      })
    );
  });
});
