import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DebugLogPanel, type TelemetryEvent } from "./DebugLogPanel";

const invokeMock = vi.mocked(invoke);

function makeEvent(over: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    ts: "2026-05-04T10:00:00Z",
    category: "arm",
    event_type: "arm-on",
    details: { session_tag: "session:abc" },
    ...over,
  };
}

describe("DebugLogPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("renders empty state when telemetry_recent_events returns []", async () => {
    invokeMock.mockResolvedValue([]);
    render(<DebugLogPanel />);
    await waitFor(() =>
      expect(screen.getByText(/No events recorded yet today/i)).toBeInTheDocument(),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "telemetry_recent_events",
      expect.objectContaining({ limit: 100, category: null }),
    );
  });

  it("renders event rows with category and event_type", async () => {
    invokeMock.mockResolvedValue([
      makeEvent({ event_type: "arm-on", category: "arm" }),
      makeEvent({ event_type: "clip-finalized", category: "clip", details: { sample_id: 7 } }),
    ]);
    render(<DebugLogPanel />);
    await waitFor(() => {
      expect(screen.getByText("arm-on")).toBeInTheDocument();
      expect(screen.getByText("clip-finalized")).toBeInTheDocument();
    });
  });

  it("re-fetches with category filter when a tab is clicked", async () => {
    invokeMock.mockResolvedValue([]);
    render(<DebugLogPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    invokeMock.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Job" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "telemetry_recent_events",
        expect.objectContaining({ category: "job" }),
      ),
    );
  });

  it("polls for fresh events on an interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invokeMock.mockResolvedValue([]);
    render(<DebugLogPanel />);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(invokeMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("surfaces invoke errors without breaking the panel", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));
    render(<DebugLogPanel />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/disk full/i),
    );
  });
});
