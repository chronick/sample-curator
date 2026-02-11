import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useCanvasResize,
  useWaveformRenderer,
  useSpectrumRenderer,
} from "./useVisualization";

// Mock ResizeObserver
let resizeCallback: ResizeObserverCallback;
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}

globalThis.ResizeObserver = MockResizeObserver as any;

// Set consistent DPR for all tests
window.devicePixelRatio = 2;

function createMockCanvas(width = 800, height = 400) {
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

describe("useCanvasResize", () => {
  beforeEach(() => {
    mockObserve.mockReset();
    mockDisconnect.mockReset();
  });

  it("sets up ResizeObserver on mount", () => {
    const { canvas } = createMockCanvas();
    const canvasRef = { current: canvas };

    renderHook(() => useCanvasResize(canvasRef));

    expect(mockObserve).toHaveBeenCalledWith(canvas);
  });

  it("disconnects observer on unmount", () => {
    const { canvas } = createMockCanvas();
    const canvasRef = { current: canvas };

    const { unmount } = renderHook(() => useCanvasResize(canvasRef));
    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("does nothing if canvas is null", () => {
    const canvasRef = { current: null };

    renderHook(() => useCanvasResize(canvasRef));

    expect(mockObserve).not.toHaveBeenCalled();
  });
});

describe("useWaveformRenderer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls clearRect on each render", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };

    renderHook(() => useWaveformRenderer(canvasRef, [0.5, -0.3]));

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it("skips all drawing when data is empty (avoids clobbering recording waveform)", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };

    renderHook(() => useWaveformRenderer(canvasRef, []));

    // With empty data, the renderer should not touch the canvas at all
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it("draws waveform line when data provided", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };
    const data = [0.1, 0.2, 0.3, 0.4];

    renderHook(() => useWaveformRenderer(canvasRef, data));

    // Center line + waveform line = 2 beginPath calls
    expect(ctx.beginPath).toHaveBeenCalledTimes(2);
    // First data point uses moveTo, rest use lineTo
    // moveTo: center line (1) + waveform first point (1) = 2
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    // lineTo: center line (1) + waveform remaining points (3) = 4
    expect(ctx.lineTo).toHaveBeenCalledTimes(4);
  });

  it("auto-gain scales small signals up", () => {
    const { canvas, ctx } = createMockCanvas(800, 400);
    const canvasRef = { current: canvas };
    // peak = 0.1, gain = min(0.8 / 0.1, 200) = min(8, 200) = 8
    // data[0] * gain = 0.05 * 8 = 0.4 -> y = (1 - 0.4) * 400 / 2 = 120
    // data[1] * gain = 0.1 * 8 = 0.8 -> y = (1 - 0.8) * 400 / 2 = 40
    // Without auto-gain, 0.05 would barely move from center (y~190).
    // With auto-gain, it reaches y=120 -- well above center (200).
    const data = [0.05, 0.1];

    renderHook(() => useWaveformRenderer(canvasRef, data));

    const sliceWidth = 800 / 2;
    // Waveform moveTo is the second call (first is center line at y=200)
    expect(ctx.moveTo).toHaveBeenCalledWith(0, expect.closeTo(120, 5));
    expect(ctx.lineTo).toHaveBeenCalledWith(sliceWidth, expect.closeTo(40, 5));
  });
});

describe("useSpectrumRenderer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls clearRect on each render", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };
    const prevDataRef = { current: [] as number[] };

    renderHook(() => useSpectrumRenderer(canvasRef, [0.5], prevDataRef));

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it("does not draw when data is empty", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };
    const prevDataRef = { current: [] as number[] };

    renderHook(() => useSpectrumRenderer(canvasRef, [], prevDataRef));

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("draws bars when data provided", () => {
    const { canvas, ctx } = createMockCanvas();
    const canvasRef = { current: canvas };
    const prevDataRef = { current: [] as number[] };
    const data = [0.5, 0.3, 0.8];

    renderHook(() => useSpectrumRenderer(canvasRef, data, prevDataRef));

    // fillRect called once per data point
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
  });

  it("applies smooth falloff from previous data", () => {
    const { canvas } = createMockCanvas();
    const canvasRef = { current: canvas };
    const prevDataRef = { current: [1.0, 1.0] };

    // Current data is small, previous was large
    // smoothed[i] = max(data[i], prev[i] * 0.85)
    // smoothed[0] = max(0.01, 1.0 * 0.85) = 0.85
    // smoothed[1] = max(0.01, 1.0 * 0.85) = 0.85
    renderHook(() =>
      useSpectrumRenderer(canvasRef, [0.01, 0.01], prevDataRef)
    );

    expect(prevDataRef.current[0]).toBe(0.85);
    expect(prevDataRef.current[1]).toBe(0.85);
  });
});
