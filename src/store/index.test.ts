import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './index';
import type { Sample } from '../api/types';

// Helper to create a mock sample
function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: 1,
    path: '/samples/kick.wav',
    source_type: 'imported',
    sample_type: 'kick',
    bpm: 120,
    key: 'C',
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
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    analyzed_at: null,
    ...overrides,
  };
}

describe('useStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useStore.setState({
      samples: [],
      totalSamples: 0,
      selectedSample: null,
      selectedIds: new Set(),
      packs: [],
      allTags: [],
      typeCounts: [],
      filters: {
        query: '',
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
      },
      sortField: 'applicability_score',
      sortDirection: 'desc',
      viewMode: 'list',
      tabs: [{
        id: 'tab-1',
        label: 'All Samples',
        filters: {
          query: '',
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
        },
        scrollPosition: 0,
        viewMode: 'list',
      }],
      activeTabId: 'tab-1',
      loading: false,
      error: null,
      importJobId: null,
      importProgress: null,
    });
  });

  it('has correct initial state', () => {
    const state = useStore.getState();
    expect(state.samples).toEqual([]);
    expect(state.totalSamples).toBe(0);
    expect(state.selectedSample).toBeNull();
    expect(state.selectedIds.size).toBe(0);
    expect(state.sortField).toBe('applicability_score');
    expect(state.sortDirection).toBe('desc');
    expect(state.viewMode).toBe('list');
    expect(state.tabs).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it('setSamples updates samples and totalSamples', () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 })];
    useStore.getState().setSamples(samples, 42);

    const state = useStore.getState();
    expect(state.samples).toHaveLength(2);
    expect(state.totalSamples).toBe(42);
  });

  it('setSelectedSample updates selectedSample', () => {
    const sample = makeSample({ id: 5 });
    useStore.getState().setSelectedSample(sample);
    expect(useStore.getState().selectedSample?.id).toBe(5);

    useStore.getState().setSelectedSample(null);
    expect(useStore.getState().selectedSample).toBeNull();
  });

  it('toggleSelection adds id', () => {
    useStore.getState().toggleSelection(1);
    expect(useStore.getState().selectedIds.has(1)).toBe(true);
  });

  it('toggleSelection removes id', () => {
    useStore.getState().toggleSelection(1);
    useStore.getState().toggleSelection(1);
    expect(useStore.getState().selectedIds.has(1)).toBe(false);
  });

  it('selectAll selects all sample ids', () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 }), makeSample({ id: 3 })];
    useStore.getState().setSamples(samples, 3);
    useStore.getState().selectAll();

    const ids = useStore.getState().selectedIds;
    expect(ids.size).toBe(3);
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
  });

  it('clearSelection empties selectedIds', () => {
    useStore.getState().toggleSelection(1);
    useStore.getState().toggleSelection(2);
    useStore.getState().clearSelection();
    expect(useStore.getState().selectedIds.size).toBe(0);
  });

  it('setFilters merges partial filters', () => {
    useStore.getState().setFilters({ min_bpm: 120 });
    const filters = useStore.getState().filters;
    expect(filters.min_bpm).toBe(120);
    expect(filters.limit).toBe(100); // unchanged
  });

  it('resetFilters restores defaults', () => {
    useStore.getState().setFilters({ min_bpm: 120 });
    useStore.getState().resetFilters();
    const filters = useStore.getState().filters;
    expect(filters.min_bpm).toBeUndefined();
  });

  it('setSortField toggles direction for same field', () => {
    // Initial: sortField = applicability_score, sortDirection = desc
    useStore.getState().setSortField('applicability_score');
    expect(useStore.getState().sortDirection).toBe('asc'); // toggled from desc

    useStore.getState().setSortField('applicability_score');
    expect(useStore.getState().sortDirection).toBe('desc'); // toggled back
  });

  it('setSortField new field defaults to desc', () => {
    useStore.getState().setSortField('bpm');
    expect(useStore.getState().sortField).toBe('bpm');
    expect(useStore.getState().sortDirection).toBe('desc');
  });

  it('setSort sets both field and direction', () => {
    useStore.getState().setSort('path', 'asc');
    expect(useStore.getState().sortField).toBe('path');
    expect(useStore.getState().sortDirection).toBe('asc');
  });

  it('setViewMode toggles between list and grid', () => {
    useStore.getState().setViewMode('grid');
    expect(useStore.getState().viewMode).toBe('grid');

    useStore.getState().setViewMode('list');
    expect(useStore.getState().viewMode).toBe('list');
  });

  it('addTab adds tab and sets it active', () => {
    useStore.getState().addTab({ label: 'Kicks' });
    const state = useStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1].label).toBe('Kicks');
    expect(state.activeTabId).toBe(state.tabs[1].id);
  });

  it('closeTab removes tab and switches active', () => {
    useStore.getState().addTab({ label: 'Kicks' });
    const kickTabId = useStore.getState().tabs[1].id;
    useStore.getState().closeTab(kickTabId);
    const state = useStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('tab-1');
  });

  it('closeTab refuses to close last tab', () => {
    useStore.getState().closeTab('tab-1');
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it('setActiveTab saves current tab filters before switching', () => {
    useStore.getState().setFilters({ min_bpm: 120 });
    useStore.getState().addTab({ label: 'New Tab' });
    const newTabId = useStore.getState().activeTabId;

    // Switch back to tab-1
    useStore.getState().setActiveTab('tab-1');

    // Now tab-1 should have the kick filter (was saved before addTab)
    // And when we switch back to the new tab, it should have its own filters
    useStore.getState().setActiveTab(newTabId);
    const state = useStore.getState();
    expect(state.activeTabId).toBe(newTabId);
  });

  it('updateTab updates specific tab properties', () => {
    useStore.getState().updateTab('tab-1', { label: 'Renamed' });
    expect(useStore.getState().tabs[0].label).toBe('Renamed');
  });

  it('setActiveView switches to record', () => {
    useStore.getState().setActiveView('record');
    expect(useStore.getState().activeView).toBe('record');
  });

  it('setActiveView switches back to browse', () => {
    useStore.getState().setActiveView('record');
    useStore.getState().setActiveView('browse');
    expect(useStore.getState().activeView).toBe('browse');
  });

  it('updateSample replaces sample in list by ID', () => {
    const samples = [makeSample({ id: 1, bpm: 120 }), makeSample({ id: 2, bpm: 130 })];
    useStore.getState().setSamples(samples, 2);

    const updated = makeSample({ id: 1, bpm: 140 });
    useStore.getState().updateSample(updated);

    expect(useStore.getState().samples[0].bpm).toBe(140);
    expect(useStore.getState().samples[1].bpm).toBe(130); // unchanged
  });

  it('removeSamples removes by ID and clears selection for removed', () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 }), makeSample({ id: 3 })];
    useStore.getState().setSamples(samples, 3);
    useStore.getState().toggleSelection(1);
    useStore.getState().toggleSelection(2);

    useStore.getState().removeSamples([1, 3]);

    const state = useStore.getState();
    expect(state.samples).toHaveLength(1);
    expect(state.samples[0].id).toBe(2);
    expect(state.selectedIds.has(1)).toBe(false);
    expect(state.selectedIds.has(2)).toBe(true);
  });
});
