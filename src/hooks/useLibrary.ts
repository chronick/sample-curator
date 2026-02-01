/**
 * Hook for managing the sample library.
 */

import { useCallback, useEffect } from "react";
import { useStore } from "../store";
import { api } from "../api";
import type { Sample, SearchFilters } from "../api/types";

export function useLibrary() {
  const {
    samples,
    totalSamples,
    selectedSample,
    selectedIds,
    filters,
    loading,
    error,
    packs,
    allTags,
    setSamples,
    setSelectedSample,
    toggleSelection,
    selectAll,
    clearSelection,
    setFilters,
    resetFilters,
    setPacks,
    setTags,
    setLoading,
    setError,
    updateSample,
    removeSamples,
  } = useStore();

  // Fetch samples when filters change
  const fetchSamples = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.search(filters);
      setSamples(result.samples, result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch samples");
    } finally {
      setLoading(false);
    }
  }, [filters, setSamples, setLoading, setError]);

  // Fetch packs
  const fetchPacks = useCallback(async () => {
    try {
      const packList = await api.listPacks();
      setPacks(packList);
    } catch (err) {
      console.error("Failed to fetch packs:", err);
    }
  }, [setPacks]);

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const tagList = await api.listTags();
      setTags(tagList);
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    }
  }, [setTags]);

  // Initial load
  useEffect(() => {
    fetchSamples();
    fetchPacks();
    fetchTags();
  }, [fetchSamples, fetchPacks, fetchTags]);

  // Refresh all data
  const refresh = useCallback(() => {
    fetchSamples();
    fetchPacks();
    fetchTags();
  }, [fetchSamples, fetchPacks, fetchTags]);

  // Select a sample
  const selectSample = useCallback(
    (sample: Sample | null) => {
      setSelectedSample(sample);
    },
    [setSelectedSample]
  );

  // Update filters
  const updateFilters = useCallback(
    (newFilters: Partial<SearchFilters>) => {
      setFilters(newFilters);
    },
    [setFilters]
  );

  // Delete samples
  const deleteSamples = useCallback(
    async (ids: number[]) => {
      try {
        await api.batchDelete(ids);
        removeSamples(ids);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete samples");
      }
    },
    [removeSamples, setError]
  );

  // Add tags to samples
  const addTagsToSamples = useCallback(
    async (ids: number[], tags: string[]) => {
      try {
        await api.batchAddTags(ids, tags);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add tags");
      }
    },
    [refresh, setError]
  );

  // Update a single sample
  const updateSampleData = useCallback(
    async (id: number, updates: Partial<Sample>) => {
      try {
        const updated = await api.updateSample(id, updates);
        updateSample(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update sample");
      }
    },
    [updateSample, setError]
  );

  return {
    // Data
    samples,
    totalSamples,
    selectedSample,
    selectedIds,
    filters,
    loading,
    error,
    packs,
    allTags,

    // Actions
    setFilters: updateFilters,
    resetFilters,
    selectSample,
    toggleSelection,
    selectAll,
    clearSelection,
    refresh,
    deleteSamples,
    addTagsToSamples,
    updateSample: updateSampleData,
  };
}

export default useLibrary;
