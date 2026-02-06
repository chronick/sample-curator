/**
 * API client for Sample Curator.
 *
 * DB operations use native Rust Tauri commands (db_*, import_*).
 * ML operations use the Python sidecar via JSON-RPC (kept for future use).
 */

import { invoke } from "@tauri-apps/api/tauri";
import type {
  Sample,
  Pack,
  SearchFilters,
  SearchResult,
  FilterPreset,
  ImportOptions,
  ImportProgress,
  WaveformData,
  SpectrogramData,
  SearchAspects,
  SimilarityResult,
  CompatibilityCriteria,
  CompatibilityResult,
  SearchStats,
  Project,
  ProjectSample,
  CreateProjectInput,
  UpdateProjectInput,
  ExportProjectInput,
  DirectoryEntry,
} from "./types";

// ============ JSON-RPC (kept for future ML sidecar use) ============

let requestId = 0;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

/**
 * Send a JSON-RPC request to the Python sidecar.
 * Kept for future ML features (captioning, semantic search).
 */
async function rpcCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
    id: ++requestId,
  };

  console.log(`[RPC] Calling ${method}...`, params);

  try {
    const responseStr = await invoke<string>("sidecar_call", {
      request: JSON.stringify(request),
    });

    const response: JsonRpcResponse<T> = JSON.parse(responseStr);

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result as T;
  } catch (err) {
    console.error(`[RPC] Error calling ${method}:`, err);
    throw err;
  }
}

/**
 * Sample Curator API client.
 */
export const api = {
  // ============ Database Commands (Native Rust) ============

  /**
   * Search for samples.
   */
  async search(filters: SearchFilters): Promise<SearchResult> {
    return invoke<SearchResult>("db_search", {
      filters: {
        query: filters.query || null,
        tags: filters.tags?.length ? filters.tags : null,
        pack_id: filters.pack_id ?? null,
        min_score: filters.min_score ?? null,
        max_score: filters.max_score ?? null,
        sample_type: null,
        min_bpm: filters.min_bpm ?? null,
        max_bpm: filters.max_bpm ?? null,
        sort_field: filters.sort_field || null,
        sort_direction: filters.sort_direction || null,
        limit: filters.limit ?? 100,
        offset: filters.offset ?? 0,
      },
    });
  },

  /**
   * Get a sample by ID.
   */
  async getSample(id: number): Promise<Sample> {
    return invoke<Sample>("db_get_sample", { id });
  },

  /**
   * Update a sample.
   */
  async updateSample(id: number, updates: Partial<Sample>): Promise<Sample> {
    return invoke<Sample>("db_update_sample", { id, updates });
  },

  /**
   * Delete a sample.
   */
  async deleteSample(id: number): Promise<boolean> {
    return invoke<boolean>("db_delete_sample", { id });
  },

  /**
   * Start an import job.
   */
  async startImport(path: string, options: ImportOptions): Promise<string> {
    return invoke<string>("import_start", {
      path,
      options: {
        recursive: options.recursive,
        analyze: options.analyze,
        detect_duplicates: options.detect_duplicates,
      },
    });
  },

  /**
   * Get import progress.
   */
  async getImportProgress(jobId: string): Promise<ImportProgress> {
    return invoke<ImportProgress>("import_progress", { jobId });
  },

  /**
   * Cancel an import job.
   */
  async cancelImport(jobId: string): Promise<boolean> {
    return invoke<boolean>("import_cancel", { jobId });
  },

  /**
   * Get waveform data for a sample.
   * Uses native Rust analysis command.
   */
  async getWaveform(sampleId: number, width: number = 800): Promise<WaveformData> {
    // First get the sample to get its path
    const sample = await invoke<Sample>("db_get_sample", { id: sampleId });
    const result = await invoke<{ data: number[]; duration: number }>("native_waveform", {
      path: sample.path,
      width,
    });
    return { peaks: result.data, duration: result.duration };
  },

  /**
   * List all packs.
   */
  async listPacks(): Promise<Pack[]> {
    return invoke<Pack[]>("db_list_packs");
  },

  /**
   * Get spectrogram data for a sample.
   * Uses native Rust analysis command.
   */
  async getSpectrogram(sampleId: number, width: number = 800, height: number = 128): Promise<SpectrogramData> {
    const sample = await invoke<Sample>("db_get_sample", { id: sampleId });
    return invoke<SpectrogramData>("native_spectrogram", {
      path: sample.path,
      width,
      height,
    });
  },

  /**
   * List all tags.
   */
  async listTags(): Promise<string[]> {
    return invoke<string[]>("db_list_tags");
  },

  /**
   * Add tags to a sample.
   */
  async addTags(sampleId: number, tags: string[]): Promise<Sample> {
    return invoke<Sample>("db_add_tags", { sampleId, tags });
  },

  /**
   * Remove tags from a sample.
   */
  async removeTags(sampleId: number, tags: string[]): Promise<Sample> {
    return invoke<Sample>("db_remove_tags", { sampleId, tags });
  },

  /**
   * Batch update samples.
   */
  async batchUpdate(ids: number[], updates: Partial<Sample>): Promise<number> {
    return invoke<number>("db_batch_update", { ids, updates });
  },

  /**
   * Batch delete samples.
   */
  async batchDelete(ids: number[]): Promise<number> {
    return invoke<number>("db_batch_delete", { ids });
  },

  /**
   * Batch add tags.
   */
  async batchAddTags(ids: number[], tags: string[]): Promise<number> {
    return invoke<number>("db_batch_add_tags", { ids, tags });
  },

  /**
   * Get sample counts by type (for PackTree).
   */
  async getTypeCounts(): Promise<Array<[string, number]>> {
    return invoke<Array<[string, number]>>("db_get_type_counts");
  },

  /**
   * Analyze a sample using native Rust analyzers and update DB.
   */
  async analyzeSample(id: number): Promise<void> {
    const sample = await invoke<Sample>("db_get_sample", { id });
    // Run quality analysis
    try {
      const quality = await invoke<{
        rms_db: number;
        peak_db: number;
        crest_factor: number;
        dynamic_range: number;
        clipping_detected: boolean;
      }>("native_quality", { path: sample.path });
      // Update what we can through the update command
      await invoke("db_update_sample", {
        id,
        updates: { quality_score: Math.min(100, Math.max(0, (quality.dynamic_range / 20) * 100 - (quality.clipping_detected ? 20 : 0))) },
      });
    } catch (err) {
      console.warn("Quality analysis failed:", err);
    }
  },

  // ============ Filter Preset Commands (Native Rust) ============

  async listFilterPresets(): Promise<FilterPreset[]> {
    return invoke<FilterPreset[]>("db_list_filter_presets");
  },

  async createFilterPreset(name: string, filtersJson: string, emoji?: string): Promise<FilterPreset> {
    return invoke<FilterPreset>("db_create_filter_preset", {
      input: { name, emoji: emoji || null, filters_json: filtersJson },
    });
  },

  async updateFilterPreset(id: number, input: { name?: string; emoji?: string; filters_json?: string; sort_order?: number }): Promise<void> {
    return invoke<void>("db_update_filter_preset", { id, input });
  },

  async deleteFilterPreset(id: number): Promise<void> {
    return invoke<void>("db_delete_filter_preset", { id });
  },

  async migrateTypesToTags(): Promise<number> {
    return invoke<number>("db_migrate_types_to_tags");
  },

  // ============ Similarity & Compatibility Search (Native Rust) ============

  /**
   * Find similar samples using native Rust similarity search.
   */
  async findSimilar(
    sampleId: number,
    limit?: number,
    aspects?: SearchAspects
  ): Promise<SimilarityResult[]> {
    return invoke<SimilarityResult[]>("find_similar", {
      sampleId,
      limit,
      aspects,
    });
  },

  /**
   * Find compatible samples (for layering, mixing).
   */
  async findCompatible(
    sampleId: number,
    limit?: number,
    criteria?: CompatibilityCriteria
  ): Promise<CompatibilityResult[]> {
    return invoke<CompatibilityResult[]>("find_compatible", {
      sampleId,
      limit,
      criteria,
    });
  },

  /**
   * Generate embedding for a sample.
   */
  async generateEmbedding(sampleId: number): Promise<boolean> {
    return invoke<boolean>("generate_embedding", { sampleId });
  },

  /**
   * Generate embeddings for samples that don't have them.
   */
  async generateMissingEmbeddings(batchSize?: number): Promise<number> {
    return invoke<number>("generate_missing_embeddings", { batchSize });
  },

  /**
   * Get search index statistics.
   */
  async getSearchStats(): Promise<SearchStats> {
    return invoke<SearchStats>("get_search_stats");
  },

  // ============ Project Commands (Native Rust) ============

  async createProject(input: CreateProjectInput): Promise<Project> {
    return invoke<Project>("create_project", { input });
  },

  async listProjects(): Promise<Project[]> {
    return invoke<Project[]>("list_projects");
  },

  async getProject(projectId: number): Promise<Project | null> {
    return invoke<Project | null>("get_project", { projectId });
  },

  async updateProject(projectId: number, input: UpdateProjectInput): Promise<Project> {
    return invoke<Project>("update_project", { projectId, input });
  },

  async deleteProject(projectId: number): Promise<void> {
    return invoke<void>("delete_project", { projectId });
  },

  async getProjectSamples(projectId: number): Promise<ProjectSample[]> {
    return invoke<ProjectSample[]>("get_project_samples", { projectId });
  },

  async addSampleToProject(
    projectId: number,
    sampleId: number,
    notes?: string,
    role?: string
  ): Promise<void> {
    return invoke<void>("add_sample_to_project", {
      projectId,
      sampleId,
      input: notes || role ? { notes, role } : null,
    });
  },

  async removeSampleFromProject(projectId: number, sampleId: number): Promise<void> {
    return invoke<void>("remove_sample_from_project", {
      projectId,
      sampleId,
    });
  },

  async exportProject(projectId: number, input: ExportProjectInput): Promise<string[]> {
    return invoke<string[]>("export_project_command", { projectId, input });
  },

  // ============ Background Job Commands (Native Rust) ============

  async getJobStats(): Promise<JobStatusResponse> {
    return invoke<JobStatusResponse>("get_job_stats");
  },

  async queueMissingEmbeddings(priority?: number): Promise<number> {
    return invoke<number>("queue_missing_embeddings", { priority });
  },

  async queueSampleJob(sampleId: number, jobType: string, priority?: number): Promise<number> {
    return invoke<number>("queue_sample_job", {
      sampleId,
      jobType,
      priority,
    });
  },

  async startJobWorker(): Promise<boolean> {
    return invoke<boolean>("start_job_worker");
  },

  async stopJobWorker(): Promise<boolean> {
    return invoke<boolean>("stop_job_worker");
  },

  async resetStuckJobs(): Promise<number> {
    return invoke<number>("reset_stuck_jobs");
  },

  async cleanupOldJobs(daysOld?: number): Promise<number> {
    return invoke<number>("cleanup_old_jobs", { daysOld });
  },

  // ============ File Browser Commands (Native Rust) ============

  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    return invoke<DirectoryEntry[]>("list_directory", { path });
  },

  async getBrowseRoots(): Promise<string[]> {
    return invoke<string[]>("get_browse_roots");
  },

  // ============ ML Sidecar Commands (Python, future use) ============

  /**
   * Call ML sidecar for captioning (future).
   */
  async sidecarCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return rpcCall<T>(method, params);
  },
};

/** Job statistics response */
export interface JobStatusResponse {
  stats: {
    pending: number;
    running: number;
    complete: number;
    failed: number;
  };
  worker_running: boolean;
}

export default api;
