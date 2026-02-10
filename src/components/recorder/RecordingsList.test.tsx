import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordingsList } from "./RecordingsList";

const mockState: Record<string, any> = {
  recentRecordings: [],
  lastSavedSample: null,
};

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

describe("RecordingsList", () => {
  beforeEach(() => {
    mockState.recentRecordings = [];
    mockState.lastSavedSample = null;
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
});
