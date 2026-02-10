import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStore } from "../store";
import { useJobs } from "./useJobs";

// Mock the api client module
vi.mock("../api/client", () => ({
  api: {
    getJobStats: vi.fn(),
  },
}));

// Mock the dynamic import of @tauri-apps/api/event used in useJobs
// The hook does: import("@tauri-apps/api/event").then(({ listen }) => ...)
// We need the listen mock to return a Promise<unlisten>
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Get the mocked api
import { api } from "../api/client";
const mockApi = vi.mocked(api);

describe("useJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApi.getJobStats.mockReset();
    mockApi.getJobStats.mockResolvedValue({
      stats: { pending: 0, running: 0, complete: 0, failed: 0 },
      worker_running: false,
    });
    // Reset store
    useStore.setState({ jobStats: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls job stats on mount", async () => {
    renderHook(() => useJobs());

    // Flush the initial poll + microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(mockApi.getJobStats).toHaveBeenCalled();
  });

  it("updates store with job stats", async () => {
    const stats = { pending: 5, running: 2, complete: 100, failed: 1 };
    mockApi.getJobStats.mockResolvedValue({
      stats,
      worker_running: true,
    });

    renderHook(() => useJobs());

    await vi.advanceTimersByTimeAsync(0);

    expect(useStore.getState().jobStats).toEqual(stats);
  });

  it("polls periodically", async () => {
    renderHook(() => useJobs());

    await vi.advanceTimersByTimeAsync(0);
    const initialCalls = mockApi.getJobStats.mock.calls.length;

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockApi.getJobStats.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("cleans up interval on unmount", async () => {
    const { unmount } = renderHook(() => useJobs());

    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeUnmount = mockApi.getJobStats.mock.calls.length;

    unmount();

    // Reset mock to clearly see new calls
    mockApi.getJobStats.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    // After unmount, no new polling calls should happen
    expect(mockApi.getJobStats).not.toHaveBeenCalled();
  });

  it("handles getJobStats error gracefully", async () => {
    mockApi.getJobStats.mockRejectedValue(new Error("not initialized"));

    // Should not throw
    renderHook(() => useJobs());
    await vi.advanceTimersByTimeAsync(0);

    // Store should remain unchanged
    expect(useStore.getState().jobStats).toBeNull();
  });

  it("returns jobStats from store", async () => {
    const stats = { pending: 3, running: 1, complete: 50, failed: 0 };
    mockApi.getJobStats.mockResolvedValue({
      stats,
      worker_running: true,
    });

    const { result } = renderHook(() => useJobs());

    await vi.advanceTimersByTimeAsync(0);

    expect(result.current.jobStats).toEqual(stats);
  });
});
