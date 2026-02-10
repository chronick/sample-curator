import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelMeter } from "./LevelMeter";

const mockState: Record<string, any> = {
  levels: { channels: [] },
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

describe("LevelMeter", () => {
  beforeEach(() => {
    mockState.levels = { channels: [] };
  });

  it("renders L/R labels when no channels (empty array defaults)", () => {
    render(<LevelMeter />);
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("renders M label for mono (1 channel)", () => {
    mockState.levels = {
      channels: [{ rms_db: -20, peak_db: -10 }],
    };
    render(<LevelMeter />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("renders L/R labels for stereo (2 channels)", () => {
    mockState.levels = {
      channels: [
        { rms_db: -20, peak_db: -10 },
        { rms_db: -22, peak_db: -12 },
      ],
    };
    render(<LevelMeter />);
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("shows dB scale labels when channels present", () => {
    mockState.levels = {
      channels: [
        { rms_db: -20, peak_db: -10 },
        { rms_db: -22, peak_db: -12 },
      ],
    };
    render(<LevelMeter />);
    expect(screen.getByText("-60")).toBeInTheDocument();
    expect(screen.getByText("-40")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
    expect(screen.getByText("-10")).toBeInTheDocument();
    expect(screen.getByText("0 dB")).toBeInTheDocument();
  });

  it("shows formatted dB values", () => {
    mockState.levels = {
      channels: [{ rms_db: -20, peak_db: -10 }],
    };
    render(<LevelMeter />);
    expect(screen.getByText("-20.0 dB")).toBeInTheDocument();
  });

  it("shows -infinity dB for very low levels", () => {
    mockState.levels = {
      channels: [{ rms_db: -96, peak_db: -96 }],
    };
    render(<LevelMeter />);
    expect(screen.getByText("-\u221E dB")).toBeInTheDocument();
  });

  it("shows -infinity dB for default empty channels", () => {
    render(<LevelMeter />);
    const infinityLabels = screen.getAllByText("-\u221E dB");
    expect(infinityLabels).toHaveLength(2);
  });
});
