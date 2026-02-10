import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfigBar } from "./ConfigBar";

const mockUpdateConfig = vi.fn();

const mockState: Record<string, any> = {
  config: { sample_rate: 48000, bit_depth: 24, channels: 2, output_dir: "", default_device: null },
  updateConfig: mockUpdateConfig,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

describe("ConfigBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.config = { sample_rate: 48000, bit_depth: 24, channels: 2, output_dir: "", default_device: null };
  });

  it("renders sample rate buttons", () => {
    render(<ConfigBar />);
    expect(screen.getByText("44.1k")).toBeInTheDocument();
    expect(screen.getByText("48k")).toBeInTheDocument();
    expect(screen.getByText("96k")).toBeInTheDocument();
  });

  it("renders bit depth buttons", () => {
    render(<ConfigBar />);
    expect(screen.getByText("16-bit")).toBeInTheDocument();
    expect(screen.getByText("24-bit")).toBeInTheDocument();
    expect(screen.getByText("32-bit")).toBeInTheDocument();
  });

  it("renders channel buttons", () => {
    render(<ConfigBar />);
    expect(screen.getByText("Mono")).toBeInTheDocument();
    expect(screen.getByText("Stereo")).toBeInTheDocument();
  });

  it("active button has accent style", () => {
    render(<ConfigBar />);
    const activeBtn = screen.getByText("48k");
    expect(activeBtn.className).toContain("bg-accent");
    const inactiveBtn = screen.getByText("44.1k");
    expect(inactiveBtn.className).not.toContain("bg-accent");
  });

  it("click 44.1k calls updateConfig with sample_rate 44100", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("44.1k"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ sample_rate: 44100 });
  });

  it("click 16-bit calls updateConfig with bit_depth 16", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("16-bit"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ bit_depth: 16 });
  });

  it("click Mono calls updateConfig with channels 1", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("Mono"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ channels: 1 });
  });
});
