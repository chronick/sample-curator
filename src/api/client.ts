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
};

export default api;
