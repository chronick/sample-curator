import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LevelMeter } from "./LevelMeter";

const mockUpdateConfig = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

let mockState: any = {
  levels: { channels: [] },
  config: {
    sample_rate: 48000,
    bit_depth: 24,
    channels: 2,
    output_dir: "",
    default_device: null,
    arm_threshold_db: -40,
    arm_silence_ms: 2000,
  },
  isArmed: false,
  isRecording: false,
  updateConfig: mockUpdateConfig,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: Object.assign(
    (selector: any) => selector(mockState),
    { getState: () => mockState }
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock requestAnimationFrame for tests
let rafCallback: FrameRequestCallback | null = null;
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  rafCallback = cb;
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function flushRaf() {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(0);
  }
}

function resetState() {
  mockState = {
    levels: { channels: [] },
    config: {
      sample_rate: 48000,
      bit_depth: 24,
      channels: 2,
      output_dir: "",
      default_device: null,
      arm_threshold_db: -40,
      arm_silence_ms: 2000,
    },
    isArmed: false,
    isRecording: false,
    updateConfig: mockUpdateConfig,
  };
}

describe("LevelMeter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    rafCallback = null;
  });

  it("renders L/R labels", () => {
    render(<LevelMeter />);
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("renders dB scale labels", () => {
    render(<LevelMeter />);
    expect(screen.getByText("-60")).toBeInTheDocument();
    expect(screen.getByText("-40")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
    expect(screen.getByText("-10")).toBeInTheDocument();
    expect(screen.getByText("0 dB")).toBeInTheDocument();
  });

  it("shows -infinity dB for default empty channels", () => {
    render(<LevelMeter />);
    flushRaf();
    const infinityLabels = screen.getAllByText("-\u221E dB");
    expect(infinityLabels).toHaveLength(2);
  });

  it("shows formatted dB values after rAF update", () => {
    mockState.levels = {
      channels: [
        { rms_db: -20, peak_db: -10 },
        { rms_db: -22, peak_db: -12 },
      ],
    };
    render(<LevelMeter />);
    flushRaf();
    expect(screen.getByText("-20.0 dB")).toBeInTheDocument();
    expect(screen.getByText("-22.0 dB")).toBeInTheDocument();
  });

  it("shows -infinity dB for very low levels", () => {
    mockState.levels = {
      channels: [
        { rms_db: -96, peak_db: -96 },
        { rms_db: -96, peak_db: -96 },
      ],
    };
    render(<LevelMeter />);
    flushRaf();
    const infinityLabels = screen.getAllByText("-\u221E dB");
    expect(infinityLabels).toHaveLength(2);
  });

  it("mirrors mono channel to both bars", () => {
    mockState.levels = {
      channels: [{ rms_db: -30, peak_db: -15 }],
    };
    render(<LevelMeter />);
    flushRaf();
    const labels = screen.getAllByText("-30.0 dB");
    expect(labels).toHaveLength(2);
  });

  it("renders arm threshold markers on both channels", () => {
    render(<LevelMeter />);
    flushRaf();
    expect(screen.getByTestId("arm-threshold-marker-l")).toBeInTheDocument();
    expect(screen.getByTestId("arm-threshold-marker-r")).toBeInTheDocument();
  });

  it("positions threshold marker at correct percent for -40 dB", () => {
    mockState.config.arm_threshold_db = -40;
    render(<LevelMeter />);
    flushRaf();
    // -40 dB on a -60..0 range → 33.3%
    const marker = screen.getByTestId("arm-threshold-marker-l");
    expect(marker.style.left).toMatch(/^33\./);
  });

  it("threshold marker is bright when armed", () => {
    mockState.isArmed = true;
    mockState.isRecording = false;
    render(<LevelMeter />);
    flushRaf();
    const marker = screen.getByTestId("arm-threshold-marker-l");
    expect(marker.style.opacity).toBe("1");
    expect(marker.style.backgroundColor).toContain("rgb");
  });

  it("threshold marker is red when armed and recording", () => {
    mockState.isArmed = true;
    mockState.isRecording = true;
    render(<LevelMeter />);
    flushRaf();
    const marker = screen.getByTestId("arm-threshold-marker-l");
    // #ef4444 → rgb(239, 68, 68)
    expect(marker.style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  it("threshold marker is dim when disarmed", () => {
    mockState.isArmed = false;
    render(<LevelMeter />);
    flushRaf();
    const marker = screen.getByTestId("arm-threshold-marker-l");
    expect(parseFloat(marker.style.opacity)).toBeLessThan(0.5);
  });

  it("clicking on the bar updates arm threshold", () => {
    render(<LevelMeter />);
    const bar = screen.getByTestId("arm-threshold-marker-l").parentElement!;
    // Simulate clicking somewhere in the middle of the bar
    Object.defineProperty(bar, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 16, height: 16 }),
    });
    fireEvent.mouseDown(bar, { clientX: 150 }); // halfway → -30 dB
    expect(mockUpdateConfig).toHaveBeenCalled();
    const call = mockUpdateConfig.mock.calls[0][0];
    expect(call.arm_threshold_db).toBeCloseTo(-30, 0);
  });

  it("click below -6 dB clamps to arm slider max", () => {
    render(<LevelMeter />);
    const bar = screen.getByTestId("arm-threshold-marker-l").parentElement!;
    Object.defineProperty(bar, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 16, height: 16 }),
    });
    // Click at the far right (0 dB) → should clamp to -6
    fireEvent.mouseDown(bar, { clientX: 300 });
    const call = mockUpdateConfig.mock.calls[0][0];
    expect(call.arm_threshold_db).toBe(-6);
  });
});
