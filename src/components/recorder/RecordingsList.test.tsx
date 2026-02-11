import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordingsList } from "./RecordingsList";

const mockState: Record<string, any> = {
  recentRecordings: [],
  lastSavedSample: null,
  expandedRecordingIndex: null,
  setExpandedRecordingIndex: vi.fn(),
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("../../store", () => ({
  useStore: Object.assign(
    (selector: any) => selector({ setSelectedSample: vi.fn(), setActiveView: vi.fn() }),
    { getState: () => ({ setSelectedSample: vi.fn(), setActiveView: vi.fn() }) }
  ),
}));

vi.mock("../../hooks/usePlayer", () => ({
  usePlayer: () => ({
    isPlaying: false,
    currentSample: null,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    progress: 0,
  }),
}));

vi.mock("../../api", () => ({
  api: {
    getSample: vi.fn().mockResolvedValue({ id: 1, path: "/test.wav" }),
  },
}));

describe("RecordingsList", () => {
  beforeEach(() => {
    mockState.recentRecordings = [];
    mockState.lastSavedSample = null;
    mockState.expandedRecordingIndex = null;
    (mockState.setExpandedRecordingIndex as ReturnType<typeof vi.fn>).mockClear();
  });

  it("shows No recordings yet when empty", () => {
    render(<RecordingsList />);
    expect(screen.getByText("No recordings yet")).toBeInTheDocument();
  });

  it("renders recording filename and duration", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 125 },
    ];
    render(<RecordingsList />);
    expect(screen.getByText("kick-001.wav")).toBeInTheDocument();
    expect(screen.getByText("(2:05)")).toBeInTheDocument();
  });

  it("shows Saved badge for matching recording", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 30 },
    ];
    mockState.lastSavedSample = { sample_id: 1, path: "/recordings/kick-001.wav" };
    render(<RecordingsList />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("does not show Saved for non-matching recordings", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 30 },
      { path: "/recordings/snare-002.wav", duration_secs: 45 },
    ];
    mockState.lastSavedSample = { sample_id: 1, path: "/recordings/kick-001.wav" };
    render(<RecordingsList />);
    // Only one "Saved" badge should appear (for kick-001.wav, not snare-002.wav)
    const savedBadges = screen.getAllByText("Saved");
    expect(savedBadges).toHaveLength(1);
  });

  it("calls setExpandedRecordingIndex on click", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 30 },
    ];
    render(<RecordingsList />);
    fireEvent.click(screen.getByText("kick-001.wav"));
    expect(mockState.setExpandedRecordingIndex).toHaveBeenCalledWith(0);
  });

  it("toggles expanded index off when clicking already-expanded recording", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 30 },
    ];
    mockState.expandedRecordingIndex = 0;
    render(<RecordingsList />);
    fireEvent.click(screen.getByText("kick-001.wav"));
    expect(mockState.setExpandedRecordingIndex).toHaveBeenCalledWith(null);
  });

  it("shows inline player when recording is expanded", () => {
    mockState.recentRecordings = [
      { path: "/recordings/kick-001.wav", duration_secs: 30 },
    ];
    mockState.expandedRecordingIndex = 0;
    render(<RecordingsList />);
    expect(screen.getByText("Play")).toBeInTheDocument();
  });
});
