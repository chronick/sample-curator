/**
 * Zustand store for global application state.
 */

import { create } from "zustand";
import type { Sample, Pack, SearchFilters, ImportProgress, ViewMode } from "../api/types";
import type { Tab } from "../components/TabBar";

type ActiveView = "browse" | "jobs";

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

  // Type counts (for PackTree)
  typeCounts: Array<[string, number]>;

  // Filters
  filters: SearchFilters;

  // Sort
  sortField: string;
  sortDirection: "asc" | "desc";

  // View mode
  viewMode: ViewMode;

  // Top-level view
  activeView: ActiveView;

  // Tabs
  tabs: Tab[];
  activeTabId: string;

  // Loading states
  loading: boolean;
  error: string | null;

  // Import state
  importJobId: string | null;
  importProgress: ImportProgress | null;

  // Job stats
  jobStats: { pending: number; running: number; complete: number; failed: number } | null;

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
  setTypeCounts: (counts: Array<[string, number]>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setImportJob: (jobId: string | null) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  setActiveView: (view: ActiveView) => void;
  setJobStats: (stats: { pending: number; running: number; complete: number; failed: number } | null) => void;
  updateSample: (sample: Sample) => void;
  removeSamples: (ids: number[]) => void;

  // Sort actions
  setSortField: (field: string) => void;
  toggleSortDirection: () => void;
  setSort: (field: string, direction: "asc" | "desc") => void;

  // View mode actions
  setViewMode: (mode: ViewMode) => void;

  // Tab actions
  addTab: (tab?: Partial<Tab>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
}

const defaultFilters: SearchFilters = {
  query: "",
  tags: [],
  pack_id: undefined,
  min_score: undefined,
  max_score: undefined,
  min_bpm: undefined,
  max_bpm: undefined,
  sort_field: undefined,
  sort_direction: undefined,
  limit: 100,
  offset: 0,
};

const defaultTabId = "tab-1";

const defaultTab: Tab = {
  id: defaultTabId,
  label: "All Samples",
  filters: defaultFilters,
  scrollPosition: 0,
  viewMode: "list",
};

export const useStore = create<LibraryState>((set) => ({
  // Initial state
  samples: [],
  totalSamples: 0,
  selectedSample: null,
  selectedIds: new Set(),
  packs: [],
  allTags: [],
  typeCounts: [],
  filters: defaultFilters,
  sortField: "applicability_score",
  sortDirection: "desc",
  viewMode: "list",
  activeView: "browse",
  tabs: [defaultTab],
  activeTabId: defaultTabId,
  loading: false,
  error: null,
  importJobId: null,
  importProgress: null,
  jobStats: null,

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

  setTypeCounts: (counts) => set({ typeCounts: counts }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setImportJob: (jobId) => set({ importJobId: jobId }),

  setImportProgress: (progress) => set({ importProgress: progress }),

  setActiveView: (view) => set({ activeView: view }),
  setJobStats: (stats) => set({ jobStats: stats }),

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

  // Sort
  setSortField: (field) =>
    set((state) => ({
      sortField: field,
      sortDirection: state.sortField === field && state.sortDirection === "desc" ? "asc" : "desc",
      filters: {
        ...state.filters,
        sort_field: field,
        sort_direction: state.sortField === field && state.sortDirection === "desc" ? "asc" : "desc",
      },
    })),

  toggleSortDirection: () =>
    set((state) => {
      const newDir = state.sortDirection === "asc" ? "desc" : "asc";
      return {
        sortDirection: newDir,
        filters: { ...state.filters, sort_direction: newDir },
      };
    }),

  setSort: (field, direction) =>
    set((state) => ({
      sortField: field,
      sortDirection: direction,
      filters: { ...state.filters, sort_field: field, sort_direction: direction },
    })),

  // View mode
  setViewMode: (mode) => set({ viewMode: mode }),

  // Tabs
  addTab: (tab) => {
    const id = `tab-${Date.now()}`;
    const newTab: Tab = {
      id,
      label: tab?.label || "New Tab",
      filters: tab?.filters || { ...defaultFilters },
      scrollPosition: 0,
      viewMode: tab?.viewMode || "list",
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
      filters: newTab.filters,
      viewMode: newTab.viewMode,
    }));
  },

  closeTab: (tabId) =>
    set((state) => {
      if (state.tabs.length <= 1) return state;
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      const newActiveId =
        state.activeTabId === tabId ? newTabs[0].id : state.activeTabId;
      const activeTab = newTabs.find((t) => t.id === newActiveId) || newTabs[0];
      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        filters: activeTab.filters,
        viewMode: activeTab.viewMode,
      };
    }),

  setActiveTab: (tabId) =>
    set((state) => {
      // Save current tab state
      const updatedTabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? { ...t, filters: state.filters, viewMode: state.viewMode }
          : t
      );
      const targetTab = updatedTabs.find((t) => t.id === tabId);
      if (!targetTab) return state;
      return {
        tabs: updatedTabs,
        activeTabId: tabId,
        filters: targetTab.filters,
        viewMode: targetTab.viewMode,
      };
    }),

  updateTab: (tabId, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    })),
}));

// Expose serializable store snapshot for automation control channel (dev only)
if (import.meta.env.DEV) {
  useStore.subscribe((state) => {
    (window as any).__STORE_STATE__ = {
      totalSamples: state.totalSamples,
      selectedSample: state.selectedSample
        ? {
            id: state.selectedSample.id,
            path: state.selectedSample.path,
            name: state.selectedSample.path?.split("/").pop() ?? null,
          }
        : null,
      selectedCount: state.selectedIds.size,
      filters: {
        query: state.filters.query,
        tags: state.filters.tags,
        pack_id: state.filters.pack_id,
        limit: state.filters.limit,
        offset: state.filters.offset,
      },
      sortField: state.sortField,
      sortDirection: state.sortDirection,
      viewMode: state.viewMode,
      activeView: state.activeView,
      activeTabId: state.activeTabId,
      tabCount: state.tabs.length,
      loading: state.loading,
      error: state.error,
      packCount: state.packs.length,
      tagCount: state.allTags.length,
      jobStats: state.jobStats,
    };
  });
}

export default useStore;
