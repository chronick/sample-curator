import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { api } from './client';

// invoke is already mocked in setup.ts
const mockInvoke = vi.mocked(invoke);

describe('api client', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('search calls db_search with correct filter mapping', async () => {
    mockInvoke.mockResolvedValue({ samples: [], total: 0 });

    await api.search({
      query: 'kick',
      tags: ['dark'],
      min_bpm: 120,
      max_bpm: 160,
      limit: 50,
      offset: 10,
    });

    expect(mockInvoke).toHaveBeenCalledWith('db_search', {
      filters: {
        query: 'kick',
        tags: ['dark'],
        pack_id: null,
        min_score: null,
        max_score: null,
        sample_type: null,
        min_bpm: 120,
        max_bpm: 160,
        sort_field: null,
        sort_direction: null,
        limit: 50,
        offset: 10,
      },
    });
  });

  it('getSample calls db_get_sample with id', async () => {
    mockInvoke.mockResolvedValue({ id: 42 });

    await api.getSample(42);

    expect(mockInvoke).toHaveBeenCalledWith('db_get_sample', { id: 42 });
  });

  it('updateSample calls db_update_sample with id and updates', async () => {
    mockInvoke.mockResolvedValue({ id: 1 });

    await api.updateSample(1, { bpm: 128 });

    expect(mockInvoke).toHaveBeenCalledWith('db_update_sample', {
      id: 1,
      updates: { bpm: 128 },
    });
  });

  it('deleteSample calls db_delete_sample', async () => {
    mockInvoke.mockResolvedValue(true);

    await api.deleteSample(5);

    expect(mockInvoke).toHaveBeenCalledWith('db_delete_sample', { id: 5 });
  });

  it('listPacks calls db_list_packs', async () => {
    mockInvoke.mockResolvedValue([]);

    await api.listPacks();

    expect(mockInvoke).toHaveBeenCalledWith('db_list_packs');
  });

  it('listTags calls db_list_tags', async () => {
    mockInvoke.mockResolvedValue([]);

    await api.listTags();

    expect(mockInvoke).toHaveBeenCalledWith('db_list_tags');
  });

  it('addTags calls db_add_tags with sampleId and tags', async () => {
    mockInvoke.mockResolvedValue({ id: 1 });

    await api.addTags(1, ['dark', 'heavy']);

    expect(mockInvoke).toHaveBeenCalledWith('db_add_tags', {
      sampleId: 1,
      tags: ['dark', 'heavy'],
    });
  });

  it('startImport calls import_start with path and options', async () => {
    mockInvoke.mockResolvedValue('job-123');

    await api.startImport('/path/to/samples', {
      recursive: true,
      analyze: true,
      detect_duplicates: false,
      exclude_patterns: [],
    });

    expect(mockInvoke).toHaveBeenCalledWith('import_start', {
      path: '/path/to/samples',
      options: {
        recursive: true,
        analyze: true,
        detect_duplicates: false,
      },
    });
  });

  it('getTypeCounts calls db_get_type_counts', async () => {
    mockInvoke.mockResolvedValue([['kick', 10]]);

    await api.getTypeCounts();

    expect(mockInvoke).toHaveBeenCalledWith('db_get_type_counts');
  });

  it('analyzeSample gets sample then calls native_quality and db_update_sample', async () => {
    // First call: get sample
    mockInvoke
      .mockResolvedValueOnce({ id: 1, path: '/samples/kick.wav' })
      // Second call: native_quality
      .mockResolvedValueOnce({
        rms_db: -12,
        peak_db: -3,
        crest_factor: 9,
        dynamic_range: 15,
        clipping_detected: false,
      })
      // Third call: db_update_sample
      .mockResolvedValueOnce({ id: 1 });

    await api.analyzeSample(1);

    expect(mockInvoke).toHaveBeenCalledWith('db_get_sample', { id: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('native_quality', {
      path: '/samples/kick.wav',
    });
    expect(mockInvoke).toHaveBeenCalledWith('db_update_sample', {
      id: 1,
      updates: { quality_score: expect.any(Number) },
    });
  });
});
