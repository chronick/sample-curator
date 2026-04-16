export interface AudioDevice {
  id: string;
  name: string;
  is_default: boolean;
  max_channels: number;
  default_sample_rate: number;
}

export interface ChannelLevel {
  rms_db: number;
  peak_db: number;
}

export interface LevelData {
  channels: ChannelLevel[];
}

export interface RecordingConfig {
  sample_rate: number;
  bit_depth: number;
  channels: number;
  output_dir?: string;
  session_name?: string;
}

export interface RecordingInfo {
  path: string;
  duration_secs: number;
  sample_rate: number;
  channels: number;
  bit_depth: number;
}

export interface RecordingStatus {
  is_recording: boolean;
  is_monitoring: boolean;
  elapsed_secs: number;
  current_file: string | null;
}

export interface RecorderConfig {
  sample_rate: number;
  bit_depth: number;
  channels: number;
  output_dir: string;
  default_device: string | null;
  /** Peak dBFS threshold above which arm mode starts recording. */
  arm_threshold_db: number;
  /** Duration of continuous silence (below threshold) before arm mode auto-stops. */
  arm_silence_ms: number;
}

export interface SaveResult {
  sample_id: number;
  /** Path the frontend sent to `recorder_save_to_library` (pre-rename). */
  original_path: string;
  /** Canonical path after auto-naming. Same as original_path if rename failed. */
  path: string;
  analyzed: boolean;
  pack_name: string | null;
  /** ML-derived tags from CLAP or heuristic classifier. */
  naming_tags: string[];
  /** How the name was produced: "clap" | "heuristic" | "heroku" | "heroku-fallback". */
  naming_method: string;
}

export interface RecordingEntry extends RecordingInfo {
  sample_id?: number;
  /** ML-derived tags attached during auto-naming (CLAP categories etc.). */
  naming_tags?: string[];
  /** How the filename was generated. Shown as a subtle badge in the UI. */
  naming_method?: string;
  /**
   * True while `recorder_save_to_library` is in flight for this entry. During
   * this window the physical WAV file is being renamed on disk, so attempting
   * playback via the original `path` would 404. UI should surface a "saving"
   * state and disable Play until the save callback swaps in the final path.
   */
  saving?: boolean;
}

export interface RecordingWaveformData {
  peaks: number[];
  centroids: number[];
  duration: number;
}
