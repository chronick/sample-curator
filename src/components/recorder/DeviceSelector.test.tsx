import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviceSelector } from "./DeviceSelector";

const mockSelectDevice = vi.fn();
const mockRefreshDevices = vi.fn();

const mockState: Record<string, any> = {
  devices: [
    { id: "dev-1", name: "Built-in Mic", is_default: true, max_channels: 2 },
    { id: "dev-2", name: "USB Interface", is_default: false, max_channels: 4 },
  ],
  selectedDeviceId: null,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("../../hooks/useRecorder", () => ({
  useRecorder: () => ({
    selectDevice: mockSelectDevice,
    refreshDevices: mockRefreshDevices,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    openRecordingsDir: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }),
}));

describe("DeviceSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.devices = [
      { id: "dev-1", name: "Built-in Mic", is_default: true, max_channels: 2 },
      { id: "dev-2", name: "USB Interface", is_default: false, max_channels: 4 },
    ];
    mockState.selectedDeviceId = null;
  });

  it("renders device dropdown with devices", () => {
    render(<DeviceSelector />);
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    // placeholder + 2 devices = 3 options
    expect(options).toHaveLength(3);
  });

  it("shows Select input device... placeholder", () => {
    render(<DeviceSelector />);
    expect(screen.getByText("Select input device...")).toBeInTheDocument();
  });

  it("shows device names with channel count", () => {
    render(<DeviceSelector />);
    expect(screen.getByText(/Built-in Mic.*2ch/)).toBeInTheDocument();
    expect(screen.getByText(/USB Interface.*4ch/)).toBeInTheDocument();
  });

  it("marks default device with (default)", () => {
    render(<DeviceSelector />);
    expect(screen.getByText(/Built-in Mic \(default\)/)).toBeInTheDocument();
    // Non-default should not have (default)
    const usbOption = screen.getByText(/USB Interface/);
    expect(usbOption.textContent).not.toContain("(default)");
  });

  it("calls selectDevice on selection change", () => {
    render(<DeviceSelector />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "dev-2" } });
    expect(mockSelectDevice).toHaveBeenCalledWith("dev-2");
  });

  it("shows refresh button and calls refreshDevices on click", () => {
    render(<DeviceSelector />);
    const refreshBtn = screen.getByTitle("Refresh devices");
    expect(refreshBtn).toBeInTheDocument();
    fireEvent.click(refreshBtn);
    expect(mockRefreshDevices).toHaveBeenCalled();
  });
});
