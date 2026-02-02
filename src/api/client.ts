/**
 * JSON-RPC client for the Python sidecar API.
 */

import { invoke } from "@tauri-apps/api/tauri";
import type {
  Sample,
  Pack,
  SearchFilters,
  SearchResult,
  ImportOptions,
  ImportProgress,
  WaveformData,
  SpectrogramData,
  AnalysisResult,
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
} from "./types";

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
    // The Rust sidecar returns a JSON string, so we need to parse it
    const responseStr = await invoke<string>("sidecar_call", {
      request: JSON.stringify(request),
    });

    console.log(`[RPC] Raw response for ${method}:`, responseStr);

    const response: JsonRpcResponse<T> = JSON.parse(responseStr);

    console.log(`[RPC] Parsed response for ${method}:`, response);

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
  /**
   * Search for samples.
   */
  async search(filters: SearchFilters): Promise<SearchResult> {
    return rpcCall<SearchResult>("search", {
      query: filters.query,
      tags: filters.tags,
      pack_id: filters.pack_id,
      min_score: filters.min_score,
      max_score: filters.max_score,
      sample_type: filters.sample_type,
      min_bpm: filters.min_bpm,
      max_bpm: filters.max_bpm,
      limit: filters.limit ?? 100,
      offset: filters.offset ?? 0,
    });
  },

  /**
   * Get a sample by ID.
   */
  async getSample(id: number): Promise<Sample> {
    return rpcCall<Sample>("get_sample", { id });
  },

  /**
   * Update a sample.
   */
  async updateSample(id: number, updates: Partial<Sample>): Promise<Sample> {
    return rpcCall<Sample>("update_sample", { id, updates });
  },

  /**
   * Delete a sample.
   */
  async deleteSample(id: number): Promise<boolean> {
    return rpcCall<boolean>("delete_sample", { id });
  },

  /**
   * Start an import job.
   */
  async startImport(path: string, options: ImportOptions): Promise<string> {
    return rpcCall<string>("start_import", { path, options });
  },

  /**
   * Get import progress.
   */
  async getImportProgress(jobId: string): Promise<ImportProgress> {
    return rpcCall<ImportProgress>("get_import_progress", { job_id: jobId });
  },

  /**
   * Cancel an import job.
   */
  async cancelImport(jobId: string): Promise<boolean> {
    return rpcCall<boolean>("cancel_import", { job_id: jobId });
  },

  /**
   * Get waveform data for a sample.
   */
  async getWaveform(id: number, width: number = 800): Promise<WaveformData> {
    return rpcCall<WaveformData>("get_waveform", { id, width });
  },

  /**
   * List all packs.
   */
  async listPacks(): Promise<Pack[]> {
    return rpcCall<Pack[]>("list_packs", {});
  },

  /**
   * Analyze a sample.
   */
  async analyzeSample(id: number): Promise<AnalysisResult> {
    return rpcCall<AnalysisResult>("analyze_sample", { id });
  },

  /**
   * Get spectrogram data for a sample.
   */
  async getSpectrogram(id: number, width: number = 800, height: number = 128): Promise<SpectrogramData> {
    return rpcCall<SpectrogramData>("get_spectrogram", { id, width, height });
  },

  /**
   * List all tags.
   */
  async listTags(): Promise<string[]> {
    return rpcCall<string[]>("list_tags", {});
  },

  /**
   * Add tags to a sample.
   */
  async addTags(id: number, tags: string[]): Promise<Sample> {
    return rpcCall<Sample>("add_tags", { id, tags });
  },

  /**
   * Remove tags from a sample.
   */
  async removeTags(id: number, tags: string[]): Promise<Sample> {
    return rpcCall<Sample>("remove_tags", { id, tags });
  },

  /**
   * Batch update samples.
   */
  async batchUpdate(ids: number[], updates: Partial<Sample>): Promise<number> {
    return rpcCall<number>("batch_update", { ids, updates });
  },

  /**
   * Batch delete samples.
   */
  async batchDelete(ids: number[]): Promise<number> {
    return rpcCall<number>("batch_delete", { ids });
  },

  /**
   * Batch add tags.
   */
  async batchAddTags(ids: number[], tags: string[]): Promise<number> {
    return rpcCall<number>("batch_add_tags", { ids, tags });
  },

  // ============ Native Search Commands (Rust, bypasses Python sidecar) ============

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

  /**
   * Create a new project.
   */
  async createProject(input: CreateProjectInput): Promise<Project> {
    return invoke<Project>("create_project", { input });
  },

  /**
   * List all projects.
   */
  async listProjects(): Promise<Project[]> {
    return invoke<Project[]>("list_projects");
  },

  /**
   * Get a project by ID.
   */
  async getProject(projectId: number): Promise<Project | null> {
    return invoke<Project | null>("get_project", { projectId });
  },

  /**
   * Update a project.
   */
  async updateProject(projectId: number, input: UpdateProjectInput): Promise<Project> {
    return invoke<Project>("update_project", { projectId, input });
  },

  /**
   * Delete a project.
   */
  async deleteProject(projectId: number): Promise<void> {
    return invoke<void>("delete_project", { projectId });
  },

  /**
   * Get samples in a project.
   */
  async getProjectSamples(projectId: number): Promise<ProjectSample[]> {
    return invoke<ProjectSample[]>("get_project_samples", { projectId });
  },

  /**
   * Add a sample to a project.
   */
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

  /**
   * Remove a sample from a project.
   */
  async removeSampleFromProject(projectId: number, sampleId: number): Promise<void> {
    return invoke<void>("remove_sample_from_project", {
      projectId,
      sampleId,
    });
  },

  /**
   * Export a project.
   */
  async exportProject(projectId: number, input: ExportProjectInput): Promise<string[]> {
    return invoke<string[]>("export_project_command", { projectId, input });
  },

  // ============ Background Job Commands (Native Rust) ============

  /**
   * Get job queue statistics.
   */
  async getJobStats(): Promise<JobStatusResponse> {
    return invoke<JobStatusResponse>("get_job_stats");
  },

  /**
   * Queue embedding jobs for all samples missing embeddings.
   */
  async queueMissingEmbeddings(priority?: number): Promise<number> {
    return invoke<number>("queue_missing_embeddings", { priority });
  },

  /**
   * Queue a job for a specific sample.
   */
  async queueSampleJob(sampleId: number, jobType: string, priority?: number): Promise<number> {
    return invoke<number>("queue_sample_job", {
      sampleId,
      jobType,
      priority,
    });
  },

  /**
   * Start the background job worker.
   */
  async startJobWorker(): Promise<boolean> {
    return invoke<boolean>("start_job_worker");
  },

  /**
   * Stop the background job worker.
   */
  async stopJobWorker(): Promise<boolean> {
    return invoke<boolean>("stop_job_worker");
  },

  /**
   * Reset stuck jobs from previous runs.
   */
  async resetStuckJobs(): Promise<number> {
    return invoke<number>("reset_stuck_jobs");
  },

  /**
   * Clean up old completed/failed jobs.
   */
  async cleanupOldJobs(daysOld?: number): Promise<number> {
    return invoke<number>("cleanup_old_jobs", { daysOld });
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
