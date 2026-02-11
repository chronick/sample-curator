import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelMeter } from "./LevelMeter";

let mockLevels: any = { channels: [] };

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: Object.assign(
    (selector: any) => selector({ levels: mockLevels }),
    { getState: () => ({ levels: mockLevels }) }
  ),
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

describe("LevelMeter", () => {
  beforeEach(() => {
    mockLevels = { channels: [] };
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
    mockLevels = {
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
    mockLevels = {
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
    mockLevels = {
      channels: [{ rms_db: -30, peak_db: -15 }],
    };
    render(<LevelMeter />);
    flushRaf();
    // Both L and R should show the same mono value
    const labels = screen.getAllByText("-30.0 dB");
    expect(labels).toHaveLength(2);
  });
});
