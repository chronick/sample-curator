/**
 * Core types for the Sample Curator API.
 */

export interface Sample {
  id: number;
  path: string;
  source_type: string;
  sample_type: string | null;
  bpm: number | null;
  key: string | null;
  duration: number | null;
  sample_rate: number | null;
  channels: number | null;
  tags: string[];

  // Quality metrics
  rms_db: number | null;
  peak_db: number | null;
  crest_factor: number | null;
  dynamic_range: number | null;
  clipping_detected: boolean | null;

  // Spectral
  spectral_centroid: number | null;
  spectral_flatness: number | null;

  // Loop
  loop_quality: number | null;
  is_loopable: boolean | null;

  // Scores
  quality_score: number | null;
  applicability_score: number | null;

  // Pack
  pack_id: number | null;
  pack_name: string | null;

  // Timestamps
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
}

export interface Pack {
  id: number;
  name: string;
  path: string;
  source_type: string;
  vendor: string | null;
  sample_count: number;
  avg_quality_score: number | null;
  created_at: string;
}

export interface SearchFilters {
  query?: string;
  tags?: string[];
  pack_id?: number;
  min_score?: number;
  max_score?: number;
  min_bpm?: number;
  max_bpm?: number;
  sort_field?: string;
  sort_direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface FilterPreset {
  id: number;
  name: string;
  emoji: string | null;
  filters_json: string;
  is_system: boolean;
  sort_order: number;
}

export interface SearchResult {
  samples: Sample[];
  total: number;
}

export interface ImportOptions {
  recursive: boolean;
  exclude_patterns: string[];
  analyze: boolean;
  detect_duplicates: boolean;
}

export interface ImportProgress {
  phase: "scanning" | "fingerprinting" | "analyzing" | "importing" | "complete" | "error";
  current: number;
  total: number;
  current_file: string;
  errors: Array<[string, string]>;
  duplicates_skipped: number;
  imported_count: number;
}

export interface WaveformData {
  peaks: number[];
  duration: number;
}

export interface AnalysisResult {
  bpm: number | null;
  key: string | null;
  quality_score: number | null;
  applicability_score: number | null;
}

export interface SpectrogramData {
  spectrogram: number[][];  // 2D array [frequency_bins][time_frames]
  duration: number;
  width: number;
  height: number;
}

// ============ Similarity & Compatibility Search ============

export interface SearchAspects {
  timbre?: number;
  pitch?: number;
  amplitude?: number;
  spectrum?: number;
}

export interface SimilarityResult {
  sample_id: number;
  similarity: number;
  distance: number;
}

export interface CompatibilityCriteria {
  check_key?: boolean;
  check_bpm?: boolean;
  check_frequency?: boolean;
  check_dynamics?: boolean;
  bpm_tolerance?: number;
}

export interface CompatibilityResult {
  sample_id: number;
  score: number;
  key_score: number;
  bpm_score: number;
  frequency_score: number;
  dynamics_score: number;
  notes: string[];
}

export interface SearchStats {
  total_samples: number;
  total_embeddings: number;
  index_size: number;
  index_loaded: boolean;
}

// ============ Projects ============

export interface Project {
  id: number;
  name: string;
  description: string | null;
  bpm_target: number | null;
  key_target: string | null;
  created_at: string | null;
  updated_at: string | null;
  sample_count: number;
}

export interface ProjectSample {
  project_id: number;
  sample_id: number;
  notes: string | null;
  role: string | null;
  added_at: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  bpm_target?: number;
  key_target?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  bpm_target?: number;
  key_target?: string;
}

export interface ExportProjectInput {
  output_dir: string;
  naming_pattern?: string;
  copy_files?: boolean;
}

// ============ File Browser ============

export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  sample_id: number | null;
}
