import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOllamaStatus } from "./useOllamaStatus";
import type { OllamaStatusDict } from "../types/ollama";

vi.mock("../api/client", () => ({
  api: {
    sidecarCall: vi.fn(),
  },
}));

import { api } from "../api/client";
const mockApi = vi.mocked(api);

function loaded(model = "gemma3:1b"): OllamaStatusDict {
  return {
    state: "loaded",
    model,
    available_models: [model, "qwen2.5:3b"],
    error: null,
  };
}

function loading(): OllamaStatusDict {
  return { state: "loading", model: null, available_models: [], error: null };
}

function notLoaded(): OllamaStatusDict {
  return {
    state: "not_loaded",
    model: null,
    available_models: [],
    error: "daemon unreachable",
  };
}

describe("useOllamaStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApi.sidecarCall.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial state is loading", () => {
    mockApi.sidecarCall.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useOllamaStatus());
    expect(result.current.status.state).toBe("loading");
    expect(result.current.status.model).toBeNull();
    expect(result.current.status.available_models).toEqual([]);
  });

  it("first poll fires immediately on mount", async () => {
    mockApi.sidecarCall.mockResolvedValue(loading());
    renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockApi.sidecarCall).toHaveBeenCalledWith("get_ollama_status");
  });

  it("fast-polls at 1s cadence while state is loading", async () => {
    mockApi.sidecarCall.mockResolvedValue(loading());
    renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const initial = mockApi.sidecarCall.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(initial + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(initial + 2);
  });

  it("slow-polls at 10s cadence after loaded", async () => {
    mockApi.sidecarCall.mockResolvedValue(loaded());
    renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const initial = mockApi.sidecarCall.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(initial);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(initial + 1);
  });

  it("switches cadence on loading→loaded transition", async () => {
    mockApi.sidecarCall
      .mockResolvedValueOnce(loading())
      .mockResolvedValueOnce(loaded())
      .mockResolvedValue(loaded());

    renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // First poll (loading) — fast cadence scheduled (1s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Second poll returned loaded — next cadence is 10s
    const afterTransition = mockApi.sidecarCall.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(afterTransition);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(mockApi.sidecarCall.mock.calls.length).toBe(afterTransition + 1);
  });

  it("refresh() calls refresh_ollama_status and merges response", async () => {
    mockApi.sidecarCall
      .mockResolvedValueOnce(loading())
      .mockResolvedValueOnce(loaded("gemma4:e2b"));

    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockApi.sidecarCall).toHaveBeenCalledWith("refresh_ollama_status");
    expect(result.current.status.state).toBe("loaded");
    expect(result.current.status.model).toBe("gemma4:e2b");
  });

  it("setModel passes correct params for string and null", async () => {
    mockApi.sidecarCall.mockResolvedValue(loaded());
    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.setModel("gemma4:e2b");
    });
    expect(mockApi.sidecarCall).toHaveBeenCalledWith("set_ollama_model", {
      model: "gemma4:e2b",
    });

    await act(async () => {
      await result.current.setModel(null);
    });
    expect(mockApi.sidecarCall).toHaveBeenCalledWith("set_ollama_model", {
      model: null,
    });
  });

  it("setModel propagates RPC error", async () => {
    mockApi.sidecarCall
      .mockResolvedValueOnce(loaded())
      .mockRejectedValueOnce(new Error("env var overrides UI"));

    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await expect(
      act(async () => {
        await result.current.setModel("gemma4:e2b");
      })
    ).rejects.toThrow("env var overrides UI");
  });

  it("race guard: setModel in flight causes concurrent poll to be dropped", async () => {
    let resolveSetModel: (v: OllamaStatusDict) => void = () => {};
    const setModelResult = loaded("chosen-by-user");
    let pollCount = 0;

    mockApi.sidecarCall.mockImplementation((method: string) => {
      if (method === "set_ollama_model") {
        return new Promise<OllamaStatusDict>((res) => {
          resolveSetModel = res;
        });
      }
      pollCount += 1;
      return Promise.resolve(
        pollCount === 1 ? loaded("initial") : loaded("stale-poll")
      );
    });

    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status.model).toBe("initial");

    let setModelPromise!: Promise<void>;
    await act(async () => {
      setModelPromise = result.current.setModel("chosen-by-user");
      // Fire the next poll tick while setModel is in flight.
      await vi.advanceTimersByTimeAsync(10000);
    });

    // Poll returned "stale-poll" but the race guard must have dropped it.
    expect(result.current.status.model).toBe("initial");

    // Now resolve setModel and verify it wins.
    await act(async () => {
      resolveSetModel(setModelResult);
      await setModelPromise;
    });
    expect(result.current.status.model).toBe("chosen-by-user");
  });

  it("idempotent refresh: two concurrent calls share one RPC", async () => {
    let resolveRefresh: (v: OllamaStatusDict) => void = () => {};
    mockApi.sidecarCall.mockImplementation((method: string) => {
      if (method === "refresh_ollama_status") {
        return new Promise<OllamaStatusDict>((res) => {
          resolveRefresh = res;
        });
      }
      return Promise.resolve(loaded());
    });

    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const before = mockApi.sidecarCall.mock.calls.filter(
      (c) => c[0] === "refresh_ollama_status"
    ).length;

    await act(async () => {
      const p1 = result.current.refresh();
      const p2 = result.current.refresh();
      resolveRefresh(loaded("gemma4:e2b"));
      await Promise.all([p1, p2]);
    });

    const after = mockApi.sidecarCall.mock.calls.filter(
      (c) => c[0] === "refresh_ollama_status"
    ).length;
    expect(after - before).toBe(1);
  });

  it("unmount clears the poll timer", async () => {
    mockApi.sidecarCall.mockResolvedValue(loaded());
    const { unmount } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();
    mockApi.sidecarCall.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(mockApi.sidecarCall).not.toHaveBeenCalled();
  });

  it("keeps previous state when poll rejects", async () => {
    mockApi.sidecarCall
      .mockResolvedValueOnce(loaded("gemma3:1b"))
      .mockRejectedValueOnce(new Error("sidecar down"));

    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status.model).toBe("gemma3:1b");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    // Still shows last known good.
    expect(result.current.status.model).toBe("gemma3:1b");
    expect(result.current.status.state).toBe("loaded");
  });

  it("first render returns not-loaded result in state", async () => {
    mockApi.sidecarCall.mockResolvedValue(notLoaded());
    const { result } = renderHook(() => useOllamaStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status.state).toBe("not_loaded");
    expect(result.current.status.error).toBe("daemon unreachable");
  });
});
