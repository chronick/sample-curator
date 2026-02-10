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
}

export interface SaveResult {
  sample_id: number;
  path: string;
}
