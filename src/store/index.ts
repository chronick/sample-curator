/**
 * Zustand store for global application state.
 */

import { create } from "zustand";
import type { Sample, Pack, SearchFilters, ImportProgress } from "../api/types";

interface LibraryState {
  // Sample data
  samples: Sample[];
  totalSamples: number;
  selectedSample: Sample | null;
  selectedIds: Set<number>;

  // Packs
  packs: Pack[];

  // Tags
  allTags: string[];

  // Filters
  filters: SearchFilters;

  // Loading states
  loading: boolean;
  error: string | null;

  // Import state
  importJobId: string | null;
  importProgress: ImportProgress | null;

  // Actions
  setSamples: (samples: Sample[], total: number) => void;
  setSelectedSample: (sample: Sample | null) => void;
  toggleSelection: (id: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setPacks: (packs: Pack[]) => void;
  setTags: (tags: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setImportJob: (jobId: string | null) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  updateSample: (sample: Sample) => void;
  removeSamples: (ids: number[]) => void;
}

const defaultFilters: SearchFilters = {
  query: "",
  tags: [],
  pack_id: undefined,
  min_score: undefined,
  max_score: undefined,
  sample_type: undefined,
  min_bpm: undefined,
  max_bpm: undefined,
  limit: 100,
  offset: 0,
};

export const useStore = create<LibraryState>((set) => ({
  // Initial state
  samples: [],
  totalSamples: 0,
  selectedSample: null,
  selectedIds: new Set(),
  packs: [],
  allTags: [],
  filters: defaultFilters,
  loading: false,
  error: null,
  importJobId: null,
  importProgress: null,

  // Actions
  setSamples: (samples, total) => set({ samples, totalSamples: total }),

  setSelectedSample: (sample) => set({ selectedSample: sample }),

  toggleSelection: (id) =>
    set((state) => {
      const newSelected = new Set(state.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedIds: newSelected };
    }),

  selectAll: () =>
    set((state) => ({
      selectedIds: new Set(state.samples.map((s) => s.id)),
    })),

  clearSelection: () => set({ selectedIds: new Set() }),

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
    })),

  resetFilters: () => set({ filters: defaultFilters }),

  setPacks: (packs) => set({ packs }),

  setTags: (tags) => set({ allTags: tags }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setImportJob: (jobId) => set({ importJobId: jobId }),

  setImportProgress: (progress) => set({ importProgress: progress }),

  updateSample: (sample) =>
    set((state) => ({
      samples: state.samples.map((s) => (s.id === sample.id ? sample : s)),
      selectedSample:
        state.selectedSample?.id === sample.id ? sample : state.selectedSample,
    })),

  removeSamples: (ids) =>
    set((state) => {
      const idSet = new Set(ids);
      const newSelected = new Set(state.selectedIds);
      ids.forEach((id) => newSelected.delete(id));
      return {
        samples: state.samples.filter((s) => !idSet.has(s.id)),
        selectedIds: newSelected,
        selectedSample:
          state.selectedSample && idSet.has(state.selectedSample.id)
            ? null
            : state.selectedSample,
      };
    }),
}));

export default useStore;
