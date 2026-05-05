import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SessionBanner } from "./SessionBanner";

const mockClearSessionEndSummary = vi.fn();
const mockGetJobStats = vi.fn();

const baseState = () => ({
  isArmed: false,
  isMonitoring: false,
  sessionStartedAt: null as number | null,
  sessionClipCount: 0,
  sessionEndSummary: null as null | { clipCount: number; durationMs: number },
  clearSessionEndSummary: mockClearSessionEndSummary,
});

let mockState: any = baseState();

vi.mock("../../store/recorderStore", () => ({
  useRecorderStore: (selector: any) => selector(mockState),
}));

vi.mock("../../api/client", () => ({
  api: { getJobStats: () => mockGetJobStats() },
}));

describe("SessionBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState = baseState();
    mockGetJobStats.mockResolvedValue({
      stats: { pending: 0, running: 0, complete: 0, failed: 0 },
      worker_running: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when disarmed and no end summary present", () => {
    const { container } = render(<SessionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when armed but not monitoring (defensive)", () => {
    // The arm button is disabled in the UI when isMonitoring is false,
    // but if state ever desyncs we should fail safe — no banner, no
    // ticking timer, no pipeline poll.
    mockState.isArmed = true;
    mockState.isMonitoring = false;
    mockState.sessionStartedAt = Date.now();
    const { container } = render(<SessionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the live banner when armed + monitoring + session started", () => {
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = Date.now();
    render(<SessionBanner />);
    expect(screen.getByTestId("session-banner")).toBeInTheDocument();
    expect(screen.getByTestId("session-elapsed")).toHaveTextContent("0:00");
    expect(screen.getByTestId("session-clip-count")).toHaveTextContent(
      "0 clips"
    );
  });

  it("ticks the elapsed counter every second while armed", () => {
    const start = Date.now();
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = start;
    render(<SessionBanner />);
    expect(screen.getByTestId("session-elapsed")).toHaveTextContent("0:00");
    act(() => {
      // Fake timers advance the clock AND fire any setInterval ticks
      // within the window. After 5s, the banner has re-rendered with
      // Date.now() - start === 5000.
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("session-elapsed")).toHaveTextContent("0:05");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("session-elapsed")).toHaveTextContent("1:05");
  });

  it("formats elapsed time as h:mm:ss past one hour", () => {
    const start = Date.now();
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = start;
    render(<SessionBanner />);
    act(() => {
      vi.advanceTimersByTime(3_725_000); // 1h 02m 05s
    });
    expect(screen.getByTestId("session-elapsed")).toHaveTextContent("1:02:05");
  });

  it("renders 'clip' singular at count 1 and 'clips' plural otherwise", () => {
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = Date.now();
    mockState.sessionClipCount = 1;
    const { rerender } = render(<SessionBanner />);
    expect(screen.getByTestId("session-clip-count")).toHaveTextContent(
      "1 clip"
    );
    mockState.sessionClipCount = 7;
    rerender(<SessionBanner />);
    expect(screen.getByTestId("session-clip-count")).toHaveTextContent(
      "7 clips"
    );
  });

  it("hides the pipeline backlog chip when zero pending+running", async () => {
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = Date.now();
    render(<SessionBanner />);
    // Allow the initial getJobStats() promise to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId("session-pipeline-backlog")
    ).not.toBeInTheDocument();
  });

  it("renders the pipeline backlog chip when pending+running > 0", async () => {
    mockGetJobStats.mockResolvedValue({
      stats: { pending: 3, running: 1, complete: 0, failed: 0 },
      worker_running: true,
    });
    mockState.isArmed = true;
    mockState.isMonitoring = true;
    mockState.sessionStartedAt = Date.now();
    render(<SessionBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByTestId("session-pipeline-backlog")
    ).toHaveTextContent("4 pending");
  });

  it("hides the live banner and renders end summary when sessionEndSummary set", () => {
    mockState.isArmed = false;
    mockState.sessionEndSummary = { clipCount: 3, durationMs: 75_000 };
    render(<SessionBanner />);
    expect(screen.queryByTestId("session-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-banner-summary")).toHaveTextContent(
      "Session ended: 3 clips, 1:15"
    );
  });

  it("end summary shows 'No clips captured' for 0-clip cycle", () => {
    mockState.sessionEndSummary = { clipCount: 0, durationMs: 18_000 };
    render(<SessionBanner />);
    expect(screen.getByTestId("session-banner-summary")).toHaveTextContent(
      "No clips captured"
    );
  });

  it("clears the end summary after the timeout fires", () => {
    mockState.sessionEndSummary = { clipCount: 2, durationMs: 30_000 };
    render(<SessionBanner />);
    expect(mockClearSessionEndSummary).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockClearSessionEndSummary).toHaveBeenCalledTimes(1);
  });
});
