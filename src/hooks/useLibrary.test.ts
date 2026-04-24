import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStore } from "../store";
import { api } from "../api";
import { useLibrary } from "./useLibrary";
import type { Sample, SearchResult } from "../api/types";

vi.mock("../api", () => ({
  api: {
    search: vi.fn(),
    listPacks: vi.fn(),
    listTags: vi.fn(),
    getTypeCounts: vi.fn(),
    batchDelete: vi.fn(),
    batchAddTags: vi.fn(),
    updateSample: vi.fn(),
  },
}));

const mockApi = vi.mocked(api);

function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: 1,
    path: "/samples/kick.wav",
    source_type: "imported",
    sample_type: "kick",
    bpm: 120,
    key: "C",
    duration: 0.5,
    sample_rate: 44100,
    channels: 2,
    tags: [],
    rms_db: null,
    peak_db: null,
    crest_factor: null,
    dynamic_range: null,
    clipping_detected: null,
    spectral_centroid: null,
    spectral_flatness: null,
    loop_quality: null,
    is_loopable: null,
    quality_score: null,
    applicability_score: null,
    pack_id: null,
    pack_name: null,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    analyzed_at: null,
    ...overrides,
  };
}

describe("useLibrary", () => {
  beforeEach(() => {
    // Reset store
    useStore.setState({
      samples: [],
      totalSamples: 0,
      selectedSample: null,
      selectedIds: new Set(),
      packs: [],
      allTags: [],
      typeCounts: [],
      filters: {
        query: "",
        tags: [],
        limit: 100,
        offset: 0,
      },
      sortField: "applicability_score",
      sortDirection: "desc",
      viewMode: "list",
      tabs: [{
        id: "tab-1",
        label: "All Samples",
        filters: { query: "", tags: [], limit: 100, offset: 0 },
        scrollPosition: 0,
        viewMode: "list",
      }],
      activeTabId: "tab-1",
      loading: false,
      error: null,
    });

    // Default mock implementations
    mockApi.search.mockResolvedValue({ samples: [], total: 0 });
    mockApi.listPacks.mockResolvedValue([]);
    mockApi.listTags.mockResolvedValue([]);
    mockApi.getTypeCounts.mockResolvedValue([]);
  });

  it("fetches samples on mount", async () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 })];
    mockApi.search.mockResolvedValueOnce({ samples, total: 2 });

    const { result } = renderHook(() => useLibrary());

    // Wait for effects to settle
    await vi.waitFor(() => {
      expect(result.current.samples).toHaveLength(2);
    });

    expect(mockApi.search).toHaveBeenCalled();
  });

  it("fetchSamples sets loading state", async () => {
    let resolveSearch: (value: SearchResult) => void;
    mockApi.search.mockImplementation(
      () => new Promise((resolve) => { resolveSearch = resolve; })
    );

    const { result } = renderHook(() => useLibrary());

    // Should be loading
    expect(result.current.loading).toBe(true);

    // Resolve
    await act(async () => {
      resolveSearch!({ samples: [], total: 0 });
    });

    expect(result.current.loading).toBe(false);
  });

  it("fetchSamples sets error on failure", async () => {
    mockApi.search.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useLibrary());

    await vi.waitFor(() => {
      expect(result.current.error).toBe("network error");
    });
  });

  it("deleteSamples calls api.batchDelete and removes from store", async () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 }), makeSample({ id: 3 })];
    mockApi.search.mockResolvedValueOnce({ samples, total: 3 });
    mockApi.batchDelete.mockResolvedValueOnce(2);

    const { result } = renderHook(() => useLibrary());

    await vi.waitFor(() => {
      expect(result.current.samples).toHaveLength(3);
    });

    await act(async () => {
      await result.current.deleteSamples([1, 3]);
    });

    expect(mockApi.batchDelete).toHaveBeenCalledWith([1, 3]);
    expect(result.current.samples).toHaveLength(1);
    expect(result.current.samples[0].id).toBe(2);
  });

  it("addTagsToSamples calls api and refreshes", async () => {
    mockApi.batchAddTags.mockResolvedValueOnce(2);

    const { result } = renderHook(() => useLibrary());

    await act(async () => {
      await result.current.addTagsToSamples([1, 2], ["dark", "heavy"]);
    });

    expect(mockApi.batchAddTags).toHaveBeenCalledWith([1, 2], ["dark", "heavy"]);
  });

  it("updateSample calls api and updates store", async () => {
    const samples = [makeSample({ id: 1, bpm: 120 })];
    mockApi.search.mockResolvedValueOnce({ samples, total: 1 });

    const updated = makeSample({ id: 1, bpm: 140 });
    mockApi.updateSample.mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useLibrary());

    await vi.waitFor(() => {
      expect(result.current.samples).toHaveLength(1);
    });

    await act(async () => {
      await result.current.updateSample(1, { bpm: 140 });
    });

    expect(mockApi.updateSample).toHaveBeenCalledWith(1, { bpm: 140 });
    expect(result.current.samples[0].bpm).toBe(140);
  });

  it("deleteSamples sets error on failure", async () => {
    mockApi.batchDelete.mockRejectedValueOnce(new Error("delete failed"));

    const { result } = renderHook(() => useLibrary());

    await act(async () => {
      await result.current.deleteSamples([1]);
    });

    expect(result.current.error).toBe("delete failed");
  });

  it("selectSample updates selectedSample", async () => {
    const sample = makeSample({ id: 5 });

    const { result } = renderHook(() => useLibrary());

    act(() => {
      result.current.selectSample(sample);
    });

    expect(result.current.selectedSample?.id).toBe(5);
  });

  it("refresh triggers all data fetches", async () => {
    const { result } = renderHook(() => useLibrary());

    // Wait for initial load
    await vi.waitFor(() => {
      expect(mockApi.search).toHaveBeenCalled();
    });

    // Clear mock counts
    mockApi.search.mockClear();
    mockApi.listPacks.mockClear();
    mockApi.listTags.mockClear();
    mockApi.getTypeCounts.mockClear();

    act(() => {
      result.current.refresh();
    });

    expect(mockApi.search).toHaveBeenCalled();
    expect(mockApi.listPacks).toHaveBeenCalled();
    expect(mockApi.listTags).toHaveBeenCalled();
    expect(mockApi.getTypeCounts).toHaveBeenCalled();
  });
});
