import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import type { OllamaStatusDict } from "../types/ollama";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.1.5"),
}));

const llmStatus: OllamaStatusDict = {
  state: "not_loaded",
  model: null,
  available_models: [],
  error: null,
};

function defaultProps() {
  return {
    onClose: vi.fn(),
    llmStatus,
    onRefreshLlm: vi.fn().mockResolvedValue(undefined),
    onSetLlmModel: vi.fn().mockResolvedValue(undefined),
    onShowOrphans: vi.fn(),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  // Default invoke responses for the tabs that load data on mount
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_app_data_paths":
        return Promise.resolve({
          library_data_dir: "/Users/test/.music-hub-data",
          recordings_dir: "/Users/test/.music-hub-data/recordings",
          config_path: "/Users/test/.music-hub-data/config.toml",
          models_dir: "/Users/test/.music-hub-data/models",
        });
      case "watch_list_directories":
        return Promise.resolve([]);
      case "recorder_list_audio_devices":
        return Promise.resolve([
          { id: "Built-in Mic", name: "Built-in Mic", is_default: true, max_channels: 2, default_sample_rate: 48000 },
          { id: "USB Mic", name: "USB Mic", is_default: false, max_channels: 1, default_sample_rate: 44100 },
        ]);
      case "get_search_stats":
        return Promise.resolve({ total_samples: 0, total_embeddings: 0, index_loaded: false });
      case "get_app_versions":
        return Promise.resolve({ app: "0.1.5", tauri: "2.11.0", os: "macOS / aarch64", sidecar: null });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("SettingsDialog tabs", () => {
  it("renders all six tab buttons", () => {
    render(<SettingsDialog {...defaultProps()} />);
    expect(screen.getByTestId("settings-tab-general")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-audio")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-files")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-analysis-ml")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-library")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-about")).toBeInTheDocument();
  });

  it("starts on General tab and exposes the updates check", () => {
    render(<SettingsDialog {...defaultProps()} />);
    expect(screen.getByTestId("settings-check-updates")).toBeInTheDocument();
  });

  it("switches to Audio tab and renders the device picker with system devices", async () => {
    render(<SettingsDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("settings-tab-audio"));

    const picker = await screen.findByTestId("audio-device-picker");
    expect(picker).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Built-in Mic/)).toBeInTheDocument();
    });
    expect(screen.getByText(/USB Mic/)).toBeInTheDocument();
  });

  it("switches to Files tab and shows app data paths + auto-import label", async () => {
    render(<SettingsDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("settings-tab-files"));

    expect(await screen.findByText(/Library data/)).toBeInTheDocument();
    expect(screen.getByText(/Auto-import directories/)).toBeInTheDocument();
    // Ensure the old "Watch Directories" label is gone
    expect(screen.queryByText(/Watch Directories/)).not.toBeInTheDocument();
  });

  it("switches to Analysis & ML tab and shows the ML empty state", async () => {
    render(<SettingsDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("settings-tab-analysis-ml"));

    expect(await screen.findByTestId("ml-features-empty")).toBeInTheDocument();
    // Test analysis lives behind an Advanced disclosure now
    expect(screen.queryByTestId("analysis-test-file")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show advanced/));
    expect(screen.getByTestId("analysis-test-file")).toBeInTheDocument();
  });

  it("calls reveal_path when Reveal is clicked on an app data path", async () => {
    render(<SettingsDialog {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("settings-tab-files"));

    const revealButtons = await screen.findAllByTitle("Reveal in Finder");
    fireEvent.click(revealButtons[0]);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("reveal_path", expect.objectContaining({ path: expect.stringContaining(".music-hub-data") }));
    });
  });
});
