import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfigBar } from "./ConfigBar";

const mockUpdateConfig = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

const defaultDevice = {
  id: "default-device",
  name: "Default",
  is_default: true,
  max_channels: 2,
  default_sample_rate: 48000,
};

const mockState: Record<string, any> = {
  config: { sample_rate: 48000, bit_depth: 24, channels: 2, output_dir: "", default_device: null },
  updateConfig: mockUpdateConfig,
  devices: [defaultDevice],
  selectedDeviceId: "default-device",
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("ConfigBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.config = { sample_rate: 48000, bit_depth: 24, channels: 2, output_dir: "", default_device: null };
    mockState.devices = [defaultDevice];
    mockState.selectedDeviceId = "default-device";
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

  it("renders channel buttons based on selected device's max_channels", () => {
    render(<ConfigBar />);
    expect(screen.getByText("Mono")).toBeInTheDocument();
    expect(screen.getByText("Stereo")).toBeInTheDocument();
    expect(screen.queryByText("3ch")).not.toBeInTheDocument();
  });

  it("renders N-channel buttons when device supports more channels", () => {
    mockState.devices = [{ ...defaultDevice, max_channels: 4 }];
    render(<ConfigBar />);
    expect(screen.getByText("Mono")).toBeInTheDocument();
    expect(screen.getByText("Stereo")).toBeInTheDocument();
    expect(screen.getByText("3ch")).toBeInTheDocument();
    expect(screen.getByText("4ch")).toBeInTheDocument();
  });

  it("caps the channel picker at MAX_CHANNEL_OPTIONS (8)", () => {
    mockState.devices = [{ ...defaultDevice, max_channels: 32 }];
    render(<ConfigBar />);
    expect(screen.getByText("8ch")).toBeInTheDocument();
    expect(screen.queryByText("9ch")).not.toBeInTheDocument();
  });

  it("falls back to 2 channels when no device is selected", () => {
    mockState.selectedDeviceId = null;
    render(<ConfigBar />);
    expect(screen.getByText("Mono")).toBeInTheDocument();
    expect(screen.getByText("Stereo")).toBeInTheDocument();
    expect(screen.queryByText("3ch")).not.toBeInTheDocument();
  });

  it("active button has accent style", () => {
    render(<ConfigBar />);
    const activeBtn = screen.getByText("48k");
    expect(activeBtn.className).toContain("bg-accent");
    const inactiveBtn = screen.getByText("44.1k");
    expect(inactiveBtn.className).not.toContain("bg-accent");
  });

  it("click 44.1k persists sample_rate 44100 via store and backend", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("44.1k"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ sample_rate: 44100 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "recorder_set_config",
      expect.objectContaining({ config: expect.objectContaining({ sample_rate: 44100 }) })
    );
  });

  it("click 16-bit persists bit_depth 16", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("16-bit"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ bit_depth: 16 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "recorder_set_config",
      expect.objectContaining({ config: expect.objectContaining({ bit_depth: 16 }) })
    );
  });

  it("click Mono persists channels 1", () => {
    render(<ConfigBar />);
    fireEvent.click(screen.getByText("Mono"));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ channels: 1 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "recorder_set_config",
      expect.objectContaining({ config: expect.objectContaining({ channels: 1 }) })
    );
  });

  it("clamps config.channels down when device supports fewer", () => {
    mockState.config = { ...mockState.config, channels: 8 };
    mockState.devices = [{ ...defaultDevice, max_channels: 2 }];
    render(<ConfigBar />);
    expect(mockUpdateConfig).toHaveBeenCalledWith({ channels: 2 });
  });
});
