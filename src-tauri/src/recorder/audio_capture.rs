use super::metering::{calculate_stereo_levels, ChannelLevel, LevelData};
use super::visualization;
use chrono::{DateTime, Utc};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use crossbeam::channel::{self, Sender};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;
use uuid::Uuid;

const RING_BUFFER_SIZE: usize = 48000 * 2; // ~1 second at 48kHz stereo
const RECORDING_CHUNK_SIZE: usize = 2048; // ~42ms at 48kHz mono — one FFT window per chunk
const MAX_RECORDING_CHUNKS: usize = 48000 * 600 / RECORDING_CHUNK_SIZE; // ~14k chunks ≈ 10 min

// cpal::Stream is !Send on macOS due to CoreAudio internals, but it's safe
// to hold across threads when wrapped in a Mutex (we never use it concurrently).
struct SendStream(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub max_channels: u16,
    pub default_sample_rate: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecordingConfig {
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub output_dir: Option<String>,
    pub session_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordingInfo {
    pub path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_monitoring: bool,
    pub elapsed_secs: f64,
    pub current_file: Option<String>,
}

/// Incrementally computed recording waveform data.
/// Audio is processed into fixed-size chunks as it arrives in the audio callback.
/// Each chunk stores a pre-computed peak and spectral centroid.
/// Query-time binning into display bars is O(num_chunks) simple arithmetic — no FFT.
pub struct RecordingWaveformCache {
    chunk_peaks: Vec<f32>,
    chunk_centroids: Vec<f32>,
    current_chunk: Vec<f32>,
    current_chunk_peak: f32,
    sample_rate: u32,
    num_channels: u16,
}

impl RecordingWaveformCache {
    pub fn new() -> Self {
        Self {
            chunk_peaks: Vec::new(),
            chunk_centroids: Vec::new(),
            current_chunk: Vec::with_capacity(RECORDING_CHUNK_SIZE),
            current_chunk_peak: 0.0,
            sample_rate: 48000,
            num_channels: 2,
        }
    }

    pub fn clear(&mut self, sample_rate: u32, num_channels: u16) {
        self.chunk_peaks.clear();
        self.chunk_centroids.clear();
        self.current_chunk.clear();
        self.current_chunk_peak = 0.0;
        self.sample_rate = sample_rate;
        self.num_channels = num_channels;
    }

    /// Process interleaved audio: mix to mono, accumulate peaks and centroids per chunk.
    pub fn push_samples(&mut self, interleaved: &[f32]) {
        if self.chunk_peaks.len() >= MAX_RECORDING_CHUNKS {
            return;
        }
        let nc = self.num_channels.max(1) as usize;

        let mut i = 0;
        while i + nc <= interleaved.len() {
            let mono: f32 = interleaved[i..i + nc].iter().sum::<f32>() / nc as f32;
            let abs = mono.abs();
            if abs > self.current_chunk_peak {
                self.current_chunk_peak = abs;
            }
            self.current_chunk.push(mono);
            if self.current_chunk.len() >= RECORDING_CHUNK_SIZE {
                self.finalize_chunk();
                if self.chunk_peaks.len() >= MAX_RECORDING_CHUNKS {
                    return;
                }
            }
            i += nc;
        }
    }

    fn finalize_chunk(&mut self) {
        let centroid =
            visualization::compute_spectral_centroid(&self.current_chunk, self.sample_rate);
        self.chunk_peaks.push(self.current_chunk_peak);
        self.chunk_centroids.push(centroid);
        self.current_chunk.clear();
        self.current_chunk_peak = 0.0;
    }

    /// Bin pre-computed chunks into num_bars bars for display.
    pub fn get_waveform(&self, num_bars: usize) -> visualization::RecordingWaveformData {
        let total_chunks = self.chunk_peaks.len();
        if total_chunks == 0 {
            return visualization::RecordingWaveformData {
                peaks: vec![],
                centroids: vec![],
                duration: 0.0,
            };
        }

        let total_mono_samples = total_chunks * RECORDING_CHUNK_SIZE + self.current_chunk.len();
        let duration = total_mono_samples as f64 / self.sample_rate as f64;

        // Fewer chunks than bars — return chunk data directly
        if total_chunks <= num_bars {
            return visualization::RecordingWaveformData {
                peaks: self.chunk_peaks.clone(),
                centroids: self.chunk_centroids.clone(),
                duration,
            };
        }

        // Bin chunks into bars
        let mut peaks = Vec::with_capacity(num_bars);
        let mut centroids = Vec::with_capacity(num_bars);
        let chunks_per_bar = total_chunks as f64 / num_bars as f64;

        for bar in 0..num_bars {
            let start = (bar as f64 * chunks_per_bar) as usize;
            let end = (((bar + 1) as f64 * chunks_per_bar) as usize).min(total_chunks);
            let count = (end - start).max(1);

            let mut max_peak = 0.0_f32;
            let mut centroid_sum = 0.0_f32;
            for i in start..end {
                max_peak = max_peak.max(self.chunk_peaks[i]);
                centroid_sum += self.chunk_centroids[i];
            }
            peaks.push(max_peak);
            centroids.push(centroid_sum / count as f32);
        }

        visualization::RecordingWaveformData {
            peaks,
            centroids,
            duration,
        }
    }
}

/// Per-arm-cycle ephemeral state. Lives only in memory; cleared on disarm.
/// Drives session tagging, the continuous-mode UX banner, and stem-separation
/// override for the current session.
#[derive(Debug, Clone, Serialize)]
pub struct CurrentSessionContext {
    /// `"session:<uuid v4>"` — applied as a tag to every clip recorded
    /// during this arm cycle.
    pub session_tag: String,
    /// Wall-clock arm-on time. Banner uses this for elapsed-time display.
    pub started_at: DateTime<Utc>,
    /// Whether stems should be separated for clips in this session.
    /// Defaults from a global setting (placeholder `false` until T5);
    /// mutable mid-session via `session_set_stem_separation`.
    pub stem_separation_enabled: bool,
}

pub struct RecorderState {
    // Input monitoring (always-on when device selected)
    stream: Mutex<Option<SendStream>>,
    pub is_monitoring: Arc<AtomicBool>,
    // Shared ring buffer for visualization (latest samples)
    waveform_buffer: Arc<Mutex<Vec<f32>>>,
    waveform_write_pos: Arc<Mutex<usize>>,
    pub levels: Arc<Mutex<LevelData>>,
    pub smoothed_levels: Arc<Mutex<LevelData>>,

    // Actual device stream properties (set when device is selected)
    pub stream_channels: Arc<AtomicU16>,
    pub stream_sample_rate: Arc<AtomicU32>,

    // Recording (on/off independently of monitoring)
    pub is_recording: Arc<AtomicBool>,
    writer_tx: Arc<Mutex<Option<Sender<Vec<f32>>>>>,
    writer_handle: Mutex<Option<JoinHandle<()>>>,
    pub recording_start: Mutex<Option<Instant>>,
    pub current_file: Mutex<Option<String>>,
    recording_config: Mutex<Option<RecordingConfig>>,

    // Set to true once the writer thread has finished flushing + finalizing the WAV.
    // Used by save_to_library to know when the file is safe to read.
    pub writer_finalized: Arc<AtomicBool>,

    // Incremental recording waveform cache (peaks + centroids computed per chunk)
    pub recording_waveform_cache: Arc<Mutex<RecordingWaveformCache>>,

    // Arm-cycle session context. `Some` while armed, `None` while disarmed.
    pub current_session: Mutex<Option<CurrentSessionContext>>,
}

impl RecorderState {
    pub fn new() -> Self {
        Self {
            stream: Mutex::new(None),
            is_monitoring: Arc::new(AtomicBool::new(false)),
            waveform_buffer: Arc::new(Mutex::new(vec![0.0; RING_BUFFER_SIZE])),
            waveform_write_pos: Arc::new(Mutex::new(0)),
            levels: Arc::new(Mutex::new(LevelData::default())),
            smoothed_levels: Arc::new(Mutex::new(LevelData::default())),

            stream_channels: Arc::new(AtomicU16::new(2)),
            stream_sample_rate: Arc::new(AtomicU32::new(48000)),

            is_recording: Arc::new(AtomicBool::new(false)),
            writer_tx: Arc::new(Mutex::new(None)),
            writer_handle: Mutex::new(None),
            recording_start: Mutex::new(None),
            current_file: Mutex::new(None),
            recording_config: Mutex::new(None),

            writer_finalized: Arc::new(AtomicBool::new(true)),

            recording_waveform_cache: Arc::new(Mutex::new(RecordingWaveformCache::new())),

            current_session: Mutex::new(None),
        }
    }

    /// Arm-on lifecycle hook. Idempotent: repeated calls without an
    /// intervening disarm return the existing session unchanged so the
    /// `session_tag` stays stable across the entire arm cycle.
    pub fn arm_session(&self) -> Result<CurrentSessionContext, String> {
        let mut guard = self.current_session.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let session = CurrentSessionContext {
            session_tag: format!("session:{}", Uuid::new_v4()),
            started_at: Utc::now(),
            // Placeholder until the Settings global is wired in T5.
            stem_separation_enabled: false,
        };
        *guard = Some(session.clone());
        Ok(session)
    }

    /// Arm-off lifecycle hook. Drops the session context. No DB writes —
    /// session tags are applied at clip-finalize time (see T2b), so a 0-clip
    /// arm cycle leaves no trace.
    pub fn disarm_session(&self) -> Result<(), String> {
        let mut guard = self.current_session.lock().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }

    /// Snapshot of the current session context, or `None` when disarmed.
    pub fn session_snapshot(&self) -> Result<Option<CurrentSessionContext>, String> {
        let guard = self.current_session.lock().map_err(|e| e.to_string())?;
        Ok(guard.clone())
    }

    /// Mutate `stem_separation_enabled` on the active session. Errors when
    /// disarmed — there is no session to mutate.
    pub fn set_stem_separation(&self, enabled: bool) -> Result<(), String> {
        let mut guard = self.current_session.lock().map_err(|e| e.to_string())?;
        match guard.as_mut() {
            Some(session) => {
                session.stem_separation_enabled = enabled;
                Ok(())
            }
            None => Err("Cannot set stem separation: not armed".to_string()),
        }
    }
}

pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_device_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let mut devices = Vec::new();

    let input_devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

    for device in input_devices {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        let is_default = default_device_name.as_deref() == Some(&name);

        let (max_channels, default_sample_rate) =
            if let Ok(config) = device.default_input_config() {
                (config.channels(), config.sample_rate().0)
            } else {
                (2, 48000)
            };

        devices.push(AudioDevice {
            id: name.clone(),
            name,
            is_default,
            max_channels,
            default_sample_rate,
        });
    }

    Ok(devices)
}

fn find_device_by_id(device_id: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

    for device in devices {
        if let Ok(name) = device.name() {
            if name == device_id {
                return Ok(device);
            }
        }
    }

    Err(format!("Device not found: {}", device_id))
}

/// Apply exponential smoothing to level data.
/// Fast attack (transients register quickly), slow decay (ambient noise settles).
fn smooth_levels(raw: &LevelData, prev: &LevelData) -> LevelData {
    let mut channels = Vec::with_capacity(raw.channels.len());
    for (i, raw_ch) in raw.channels.iter().enumerate() {
        let prev_ch = prev.channels.get(i);
        let (prev_rms, prev_peak) = match prev_ch {
            Some(p) => (p.rms_db, p.peak_db),
            None => (-96.0, -96.0),
        };

        // RMS: attack=0.4, decay=0.15
        let rms_alpha = if raw_ch.rms_db > prev_rms { 0.4 } else { 0.15 };
        let smoothed_rms = rms_alpha * raw_ch.rms_db + (1.0 - rms_alpha) * prev_rms;

        // Peak: attack=0.5, decay=0.1
        let peak_alpha = if raw_ch.peak_db > prev_peak { 0.5 } else { 0.1 };
        let smoothed_peak = peak_alpha * raw_ch.peak_db + (1.0 - peak_alpha) * prev_peak;

        channels.push(ChannelLevel {
            rms_db: smoothed_rms,
            peak_db: smoothed_peak,
        });
    }
    LevelData { channels }
}

/// Common callback logic: convert samples to f32, write to ring buffer, update levels, forward to writer.
///
/// Uses `try_lock` for visualization data (ring buffer, levels, waveform cache) so the
/// real-time audio thread never blocks waiting for an IPC read. Missing one callback's
/// worth of visualization data is invisible; losing recording data is not, so `writer_tx`
/// keeps a regular lock.
fn process_f32_samples(
    data: &[f32],
    num_channels: u16,
    waveform_buffer: &Arc<Mutex<Vec<f32>>>,
    waveform_write_pos: &Arc<Mutex<usize>>,
    levels: &Arc<Mutex<LevelData>>,
    smoothed_levels: &Arc<Mutex<LevelData>>,
    is_recording: &Arc<AtomicBool>,
    writer_tx: &Arc<Mutex<Option<Sender<Vec<f32>>>>>,
    recording_waveform_cache: &Arc<Mutex<RecordingWaveformCache>>,
) {
    // Write to ring buffer for visualization (skip if IPC is reading)
    if let Ok(mut buf) = waveform_buffer.try_lock() {
        if let Ok(mut pos) = waveform_write_pos.try_lock() {
            let buf_len = buf.len();
            for &sample in data {
                buf[*pos % buf_len] = sample;
                *pos = (*pos + 1) % buf_len;
            }
        }
    }

    // Compute levels (always — cheap arithmetic)
    let raw = calculate_stereo_levels(data, num_channels);

    // Update raw + smoothed levels (skip if IPC is reading — next callback catches up)
    if let Ok(mut lvl) = levels.try_lock() {
        *lvl = raw.clone();
    }
    if let Ok(mut smooth) = smoothed_levels.try_lock() {
        *smooth = smooth_levels(&raw, &smooth);
    }

    // If recording, send to writer thread (MUST succeed — real audio data)
    // and accumulate for waveform visualization (best-effort)
    if is_recording.load(Ordering::Relaxed) {
        if let Ok(tx_guard) = writer_tx.lock() {
            if let Some(ref tx) = *tx_guard {
                let _ = tx.send(data.to_vec());
            }
        }
        // Waveform cache: try_lock so FFT in finalize_chunk never blocks audio thread
        if let Ok(mut cache) = recording_waveform_cache.try_lock() {
            cache.push_samples(data);
        }
    }
}

/// Select a device and start input monitoring (always-on stream).
///
/// `preferred_sample_rate` (optional) lets the caller request a specific rate
/// that will match the system output device, avoiding glitchy resampling during
/// playback. If the device doesn't support the requested rate, we fall back to
/// the device's native default.
pub fn select_device(
    device_id: &str,
    state: &RecorderState,
    preferred_sample_rate: Option<u32>,
) -> Result<(), String> {
    // Stop any existing stream
    stop_monitoring(state);

    let device = find_device_by_id(device_id)?;
    let default_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get device config: {}", e))?;

    // Try to honor the requested sample rate. cpal's supported_input_configs
    // returns a list of ranges; we pick the first one whose range includes our
    // target and build a concrete SupportedStreamConfig at that rate. If nothing
    // matches, fall back to the device's native default so recording still works.
    let supported_config = preferred_sample_rate
        .and_then(|target| {
            device.supported_input_configs().ok().and_then(|configs| {
                configs
                    .filter_map(|range| {
                        let min = range.min_sample_rate().0;
                        let max = range.max_sample_rate().0;
                        if min <= target && target <= max {
                            Some(range.with_sample_rate(cpal::SampleRate(target)))
                        } else {
                            None
                        }
                    })
                    .next()
            })
        })
        .unwrap_or(default_config);

    let num_channels = supported_config.channels();
    let sample_rate = supported_config.sample_rate().0;
    let sample_format = supported_config.sample_format();
    let stream_config: cpal::StreamConfig = supported_config.into();

    // Store actual device properties
    state.stream_channels.store(num_channels, Ordering::Relaxed);
    state.stream_sample_rate.store(sample_rate, Ordering::Relaxed);

    eprintln!(
        "Opening device: {}ch, {}Hz, format={:?} (preferred={:?})",
        num_channels, sample_rate, sample_format, preferred_sample_rate
    );

    let waveform_buffer = Arc::clone(&state.waveform_buffer);
    let waveform_write_pos = Arc::clone(&state.waveform_write_pos);
    let levels = Arc::clone(&state.levels);
    let smoothed_levels = Arc::clone(&state.smoothed_levels);
    let is_recording = Arc::clone(&state.is_recording);
    let writer_tx = Arc::clone(&state.writer_tx);
    let recording_waveform_cache = Arc::clone(&state.recording_waveform_cache);

    let err_fn = |err: cpal::StreamError| {
        eprintln!("Audio input error: {}", err);
    };

    // Build the input stream matching the device's native sample format
    let stream = match sample_format {
        SampleFormat::F32 => {
            let wb = waveform_buffer;
            let wp = waveform_write_pos;
            let lv = levels;
            let sl = smoothed_levels;
            let ir = is_recording;
            let wt = writer_tx;
            let rwc = recording_waveform_cache;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        process_f32_samples(data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwc);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build F32 input stream: {}", e))?
        }
        SampleFormat::I16 => {
            let wb = waveform_buffer;
            let wp = waveform_write_pos;
            let lv = levels;
            let sl = smoothed_levels;
            let ir = is_recording;
            let wt = writer_tx;
            let rwc = recording_waveform_cache;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 32768.0).collect();
                        process_f32_samples(&f32_data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwc);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build I16 input stream: {}", e))?
        }
        SampleFormat::I32 => {
            let wb = waveform_buffer;
            let wp = waveform_write_pos;
            let lv = levels;
            let sl = smoothed_levels;
            let ir = is_recording;
            let wt = writer_tx;
            let rwc = recording_waveform_cache;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 2147483648.0).collect();
                        process_f32_samples(&f32_data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwc);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build I32 input stream: {}", e))?
        }
        format => {
            return Err(format!("Unsupported sample format: {:?}", format));
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    {
        let mut s = state.stream.lock().map_err(|e| e.to_string())?;
        *s = Some(SendStream(stream));
    }
    state.is_monitoring.store(true, Ordering::Relaxed);

    Ok(())
}

fn stop_monitoring(state: &RecorderState) {
    if let Ok(mut s) = state.stream.lock() {
        *s = None; // Drop the stream, stops it
    }
    state.is_monitoring.store(false, Ordering::Relaxed);
}

/// Start recording to a WAV file.
pub fn start_recording(config: RecordingConfig, state: &RecorderState) -> Result<(), String> {
    if state.is_recording.load(Ordering::Relaxed) {
        return Err("Already recording".to_string());
    }
    if !state.is_monitoring.load(Ordering::Relaxed) {
        return Err("No device selected. Select a device first.".to_string());
    }

    let output_dir = config.output_dir.clone().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".music-hub-data")
            .join("recordings")
            .to_string_lossy()
            .to_string()
    });
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let session = config
        .session_name
        .clone()
        .unwrap_or_else(|| "session".to_string());
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}_{}.wav", session, timestamp);
    let filepath = std::path::Path::new(&output_dir)
        .join(&filename)
        .to_string_lossy()
        .to_string();

    // Create channel for audio data
    let (tx, rx) = channel::unbounded::<Vec<f32>>();

    // Use actual device stream properties for the WAV file
    let sample_rate = state.stream_sample_rate.load(Ordering::Relaxed);
    let stream_channels = state.stream_channels.load(Ordering::Relaxed).max(1);

    // Honor requested channel count from config, capped at what the device provides.
    // 0 is invalid; fall back to the stream's native channel count.
    let requested_channels = if config.channels == 0 {
        stream_channels
    } else {
        config.channels.min(stream_channels)
    };
    let bit_depth = config.bit_depth;
    let file_path = filepath.clone();

    eprintln!(
        "Recording: {}ch (from {}ch stream), {}Hz, {}-bit -> {}",
        requested_channels, stream_channels, sample_rate, bit_depth, file_path
    );

    // Spawn writer thread
    let writer_handle = std::thread::spawn(move || {
        let spec = hound::WavSpec {
            channels: requested_channels,
            sample_rate,
            bits_per_sample: bit_depth,
            sample_format: if bit_depth == 32 {
                hound::SampleFormat::Float
            } else {
                hound::SampleFormat::Int
            },
        };

        let mut writer = match hound::WavWriter::create(&file_path, spec) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create WAV writer: {}", e);
                return;
            }
        };

        let src_ch = stream_channels as usize;
        let dst_ch = requested_channels as usize;
        let downmix = dst_ch < src_ch;

        for chunk in rx {
            // The audio callback sends interleaved frames of `src_ch` samples.
            // When the user requested fewer channels, keep the first `dst_ch` of each frame.
            // (Simple channel selection; avoids summing that would need per-channel gain staging.)
            let iter: Box<dyn Iterator<Item = f32>> = if downmix {
                Box::new(
                    chunk
                        .chunks_exact(src_ch)
                        .flat_map(move |frame| frame.iter().take(dst_ch).copied()),
                )
            } else {
                Box::new(chunk.into_iter())
            };

            for sample in iter {
                match bit_depth {
                    16 => {
                        let s = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
                        if writer.write_sample(s).is_err() {
                            return;
                        }
                    }
                    24 => {
                        let s = (sample * 8388607.0).clamp(-8388608.0, 8388607.0) as i32;
                        if writer.write_sample(s).is_err() {
                            return;
                        }
                    }
                    _ => {
                        // 32-bit float
                        if writer.write_sample(sample).is_err() {
                            return;
                        }
                    }
                }
            }
        }

        if let Err(e) = writer.finalize() {
            eprintln!("Failed to finalize WAV: {}", e);
        }
    });

    // Store state
    {
        let mut tx_guard = state.writer_tx.lock().map_err(|e| e.to_string())?;
        *tx_guard = Some(tx);
    }
    {
        let mut handle = state.writer_handle.lock().map_err(|e| e.to_string())?;
        *handle = Some(writer_handle);
    }
    {
        let mut start = state.recording_start.lock().map_err(|e| e.to_string())?;
        *start = Some(Instant::now());
    }
    {
        let mut file = state.current_file.lock().map_err(|e| e.to_string())?;
        *file = Some(filepath);
    }
    {
        let mut rc = state.recording_config.lock().map_err(|e| e.to_string())?;
        *rc = Some(RecordingConfig {
            sample_rate,
            bit_depth,
            channels: requested_channels,
            output_dir: config.output_dir,
            session_name: config.session_name,
        });
    }

    // Clear recording waveform cache.
    // Cache operates on raw stream data (pre-downmix), so use stream_channels.
    {
        let mut cache = state.recording_waveform_cache.lock().map_err(|e| e.to_string())?;
        cache.clear(sample_rate, stream_channels);
    }

    state.writer_finalized.store(false, Ordering::Release);
    state.is_recording.store(true, Ordering::Relaxed);
    Ok(())
}

/// Stop recording and return immediately.
/// The writer thread is joined on a background thread so the IPC call never blocks.
/// `writer_finalized` is set to true once the WAV is fully flushed.
pub fn stop_recording(state: &RecorderState) -> Result<RecordingInfo, String> {
    if !state.is_recording.load(Ordering::Relaxed) {
        return Err("Not recording".to_string());
    }

    state.is_recording.store(false, Ordering::Relaxed);

    // Drop sender to signal writer thread to finish
    {
        let mut tx_guard = state.writer_tx.lock().map_err(|e| e.to_string())?;
        *tx_guard = None;
    }

    // Capture recording info before cleanup (doesn't need writer to finish)
    let duration_secs = {
        let start = state.recording_start.lock().map_err(|e| e.to_string())?;
        start.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0)
    };

    let path = {
        let file = state.current_file.lock().map_err(|e| e.to_string())?;
        file.clone().unwrap_or_default()
    };

    let (sample_rate, channels, bit_depth) = {
        let rc = state.recording_config.lock().map_err(|e| e.to_string())?;
        rc.as_ref()
            .map(|c| (c.sample_rate, c.channels, c.bit_depth))
            .unwrap_or((48000, 2, 24))
    };

    // Join writer thread on a background thread — don't block IPC
    let writer_finalized = Arc::clone(&state.writer_finalized);
    let handle = {
        let mut h = state.writer_handle.lock().map_err(|e| e.to_string())?;
        h.take()
    };
    if let Some(h) = handle {
        std::thread::spawn(move || {
            let _ = h.join();
            writer_finalized.store(true, Ordering::Release);
        });
    } else {
        state.writer_finalized.store(true, Ordering::Release);
    }

    // Clean up
    {
        let mut start = state.recording_start.lock().map_err(|e| e.to_string())?;
        *start = None;
    }

    Ok(RecordingInfo {
        path,
        duration_secs,
        sample_rate,
        channels,
        bit_depth,
    })
}

/// Block until the writer thread has finished flushing + finalizing the WAV file.
/// Returns Ok(()) if finalized within timeout, Err if timeout exceeded.
pub fn wait_for_writer(state: &RecorderState, timeout_ms: u64) -> Result<(), String> {
    let start = Instant::now();
    while !state.writer_finalized.load(Ordering::Acquire) {
        if start.elapsed().as_millis() as u64 > timeout_ms {
            return Err("Timeout waiting for WAV file to be finalized".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(())
}

/// Get the current waveform data from the ring buffer.
pub fn get_waveform_snapshot(state: &RecorderState, num_samples: usize) -> Vec<f32> {
    let buf = match state.waveform_buffer.lock() {
        Ok(b) => b.clone(),
        Err(_) => return vec![0.0; num_samples],
    };

    let pos = match state.waveform_write_pos.lock() {
        Ok(p) => *p,
        Err(_) => return vec![0.0; num_samples],
    };

    // Read the latest samples from ring buffer in order
    let len = buf.len();
    let mut ordered = Vec::with_capacity(len);
    for i in 0..len {
        ordered.push(buf[(pos + i) % len]);
    }

    visualization::downsample_waveform(&ordered, num_samples)
}

/// Get spectrum data from the latest audio buffer.
pub fn get_spectrum_snapshot(state: &RecorderState, num_bins: usize) -> Vec<f32> {
    let buf = match state.waveform_buffer.lock() {
        Ok(b) => b.clone(),
        Err(_) => return vec![0.0; num_bins],
    };

    let pos = match state.waveform_write_pos.lock() {
        Ok(p) => *p,
        Err(_) => return vec![0.0; num_bins],
    };

    // Use the latest 2048 samples for FFT
    let fft_size = 2048;
    let len = buf.len();
    let mut samples = Vec::with_capacity(fft_size);
    let start = if len >= fft_size { pos + len - fft_size } else { 0 };
    for i in 0..fft_size.min(len) {
        samples.push(buf[(start + i) % len]);
    }

    visualization::calculate_spectrum(&samples, num_bins)
}

/// Get the growing recording waveform data (peaks + spectral centroids).
/// Bins pre-computed chunk data — no FFT, no buffer clone, O(num_chunks) arithmetic.
pub fn get_recording_waveform(state: &RecorderState, num_bars: usize) -> visualization::RecordingWaveformData {
    match state.recording_waveform_cache.lock() {
        Ok(cache) => cache.get_waveform(num_bars),
        Err(_) => visualization::RecordingWaveformData { peaks: vec![], centroids: vec![], duration: 0.0 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_waveform_cache_chunk_accumulation() {
        let mut cache = RecordingWaveformCache::new();
        cache.clear(48000, 1); // mono

        // Push exactly one chunk worth of mono samples
        let samples: Vec<f32> = (0..RECORDING_CHUNK_SIZE)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin())
            .collect();
        cache.push_samples(&samples);
        assert_eq!(cache.chunk_peaks.len(), 1);
        assert!(cache.chunk_peaks[0] > 0.0);
        assert!(cache.chunk_centroids[0] > 300.0); // near 440Hz
    }

    #[test]
    fn test_waveform_cache_stereo_mixing() {
        let mut cache = RecordingWaveformCache::new();
        cache.clear(48000, 2); // stereo

        // Push stereo interleaved data (L=0.5, R=0.5 → mono=0.5)
        let stereo: Vec<f32> = vec![0.5; RECORDING_CHUNK_SIZE * 2]; // 2048 frames × 2 channels
        cache.push_samples(&stereo);
        assert_eq!(cache.chunk_peaks.len(), 1);
        assert!((cache.chunk_peaks[0] - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_waveform_cache_binning() {
        let mut cache = RecordingWaveformCache::new();
        cache.clear(48000, 1);

        // Push 10 chunks of data
        for _ in 0..10 {
            let samples: Vec<f32> = (0..RECORDING_CHUNK_SIZE)
                .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin())
                .collect();
            cache.push_samples(&samples);
        }
        assert_eq!(cache.chunk_peaks.len(), 10);

        // Bin into 5 bars
        let waveform = cache.get_waveform(5);
        assert_eq!(waveform.peaks.len(), 5);
        assert_eq!(waveform.centroids.len(), 5);
        assert!(waveform.duration > 0.0);

        // Bin into more bars than chunks — returns chunk count
        let waveform = cache.get_waveform(20);
        assert_eq!(waveform.peaks.len(), 10);
    }

    #[test]
    fn test_waveform_cache_clear() {
        let mut cache = RecordingWaveformCache::new();
        cache.clear(48000, 1);
        let samples = vec![0.5_f32; RECORDING_CHUNK_SIZE * 3];
        cache.push_samples(&samples);
        assert!(cache.chunk_peaks.len() > 0);

        cache.clear(44100, 2);
        assert_eq!(cache.chunk_peaks.len(), 0);
        assert_eq!(cache.chunk_centroids.len(), 0);
        assert_eq!(cache.sample_rate, 44100);
        assert_eq!(cache.num_channels, 2);
    }

    #[test]
    fn test_waveform_cache_empty() {
        let cache = RecordingWaveformCache::new();
        let waveform = cache.get_waveform(800);
        assert!(waveform.peaks.is_empty());
        assert_eq!(waveform.duration, 0.0);
    }

    #[test]
    fn session_snapshot_is_none_when_disarmed() {
        let state = RecorderState::new();
        assert!(state.session_snapshot().unwrap().is_none());
    }

    #[test]
    fn arm_session_creates_session_with_session_tag_prefix() {
        let state = RecorderState::new();
        let session = state.arm_session().unwrap();
        assert!(session.session_tag.starts_with("session:"));
        // UUID v4 string is 36 chars; session_tag adds the "session:" (8) prefix.
        assert_eq!(session.session_tag.len(), 8 + 36);
        assert!(!session.stem_separation_enabled);
        let snap = state.session_snapshot().unwrap().unwrap();
        assert_eq!(snap.session_tag, session.session_tag);
    }

    #[test]
    fn arm_session_is_idempotent_within_one_arm_cycle() {
        let state = RecorderState::new();
        let first = state.arm_session().unwrap();
        let second = state.arm_session().unwrap();
        let snap = state.session_snapshot().unwrap().unwrap();
        assert_eq!(first.session_tag, second.session_tag);
        assert_eq!(first.session_tag, snap.session_tag);
        assert_eq!(first.started_at, snap.started_at);
    }

    #[test]
    fn disarm_clears_session() {
        let state = RecorderState::new();
        state.arm_session().unwrap();
        state.disarm_session().unwrap();
        assert!(state.session_snapshot().unwrap().is_none());
    }

    #[test]
    fn rearm_generates_fresh_uuid() {
        let state = RecorderState::new();
        let first = state.arm_session().unwrap();
        state.disarm_session().unwrap();
        let second = state.arm_session().unwrap();
        assert_ne!(first.session_tag, second.session_tag);
    }

    #[test]
    fn set_stem_separation_mutates_active_session() {
        let state = RecorderState::new();
        state.arm_session().unwrap();
        state.set_stem_separation(true).unwrap();
        let snap = state.session_snapshot().unwrap().unwrap();
        assert!(snap.stem_separation_enabled);
        state.set_stem_separation(false).unwrap();
        let snap = state.session_snapshot().unwrap().unwrap();
        assert!(!snap.stem_separation_enabled);
    }

    #[test]
    fn set_stem_separation_errors_when_disarmed() {
        let state = RecorderState::new();
        let err = state.set_stem_separation(true).unwrap_err();
        assert!(err.contains("not armed"));
    }
}
