use super::metering::{calculate_stereo_levels, ChannelLevel, LevelData};
use super::visualization;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use crossbeam::channel::{self, Sender};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

const RING_BUFFER_SIZE: usize = 48000 * 2; // ~1 second at 48kHz stereo

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

    // Recording waveform accumulation buffer (grows during recording)
    pub recording_waveform_buffer: Arc<Mutex<Vec<f32>>>,
    pub recording_waveform_channels: Arc<AtomicU16>,
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

            recording_waveform_buffer: Arc::new(Mutex::new(Vec::new())),
            recording_waveform_channels: Arc::new(AtomicU16::new(2)),
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
fn process_f32_samples(
    data: &[f32],
    num_channels: u16,
    waveform_buffer: &Arc<Mutex<Vec<f32>>>,
    waveform_write_pos: &Arc<Mutex<usize>>,
    levels: &Arc<Mutex<LevelData>>,
    smoothed_levels: &Arc<Mutex<LevelData>>,
    is_recording: &Arc<AtomicBool>,
    writer_tx: &Arc<Mutex<Option<Sender<Vec<f32>>>>>,
    recording_waveform_buffer: &Arc<Mutex<Vec<f32>>>,
) {
    // Write to ring buffer for visualization
    if let Ok(mut buf) = waveform_buffer.lock() {
        if let Ok(mut pos) = waveform_write_pos.lock() {
            let buf_len = buf.len();
            for &sample in data {
                buf[*pos % buf_len] = sample;
                *pos = (*pos + 1) % buf_len;
            }
        }
    }

    // Update raw levels
    let raw = calculate_stereo_levels(data, num_channels);
    if let Ok(mut lvl) = levels.lock() {
        *lvl = raw.clone();
    }

    // Update smoothed levels
    if let Ok(mut smooth) = smoothed_levels.lock() {
        *smooth = smooth_levels(&raw, &smooth);
    }

    // If recording, send to writer thread and accumulate for waveform
    if is_recording.load(Ordering::Relaxed) {
        if let Ok(tx_guard) = writer_tx.lock() {
            if let Some(ref tx) = *tx_guard {
                let _ = tx.send(data.to_vec());
            }
        }
        // Append to recording waveform buffer (cap at ~10 min at 48kHz stereo = ~57.6M samples)
        const MAX_RECORDING_SAMPLES: usize = 48000 * 2 * 600;
        if let Ok(mut buf) = recording_waveform_buffer.lock() {
            if buf.len() < MAX_RECORDING_SAMPLES {
                buf.extend_from_slice(data);
            }
        }
    }
}

/// Select a device and start input monitoring (always-on stream).
pub fn select_device(device_id: &str, state: &RecorderState) -> Result<(), String> {
    // Stop any existing stream
    stop_monitoring(state);

    let device = find_device_by_id(device_id)?;
    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get device config: {}", e))?;

    let num_channels = supported_config.channels();
    let sample_rate = supported_config.sample_rate().0;
    let sample_format = supported_config.sample_format();
    let stream_config: cpal::StreamConfig = supported_config.into();

    // Store actual device properties
    state.stream_channels.store(num_channels, Ordering::Relaxed);
    state.stream_sample_rate.store(sample_rate, Ordering::Relaxed);

    eprintln!(
        "Opening device: {}ch, {}Hz, format={:?}",
        num_channels, sample_rate, sample_format
    );

    let waveform_buffer = Arc::clone(&state.waveform_buffer);
    let waveform_write_pos = Arc::clone(&state.waveform_write_pos);
    let levels = Arc::clone(&state.levels);
    let smoothed_levels = Arc::clone(&state.smoothed_levels);
    let is_recording = Arc::clone(&state.is_recording);
    let writer_tx = Arc::clone(&state.writer_tx);
    let recording_waveform_buffer = Arc::clone(&state.recording_waveform_buffer);

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
            let rwb = recording_waveform_buffer;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        process_f32_samples(data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwb);
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
            let rwb = recording_waveform_buffer;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 32768.0).collect();
                        process_f32_samples(&f32_data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwb);
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
            let rwb = recording_waveform_buffer;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 2147483648.0).collect();
                        process_f32_samples(&f32_data, num_channels, &wb, &wp, &lv, &sl, &ir, &wt, &rwb);
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
    let channels = state.stream_channels.load(Ordering::Relaxed);
    let bit_depth = config.bit_depth;
    let file_path = filepath.clone();

    eprintln!(
        "Recording: {}ch, {}Hz, {}-bit -> {}",
        channels, sample_rate, bit_depth, file_path
    );

    // Spawn writer thread
    let writer_handle = std::thread::spawn(move || {
        let spec = hound::WavSpec {
            channels,
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

        for chunk in rx {
            for &sample in &chunk {
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
            channels,
            output_dir: config.output_dir,
            session_name: config.session_name,
        });
    }

    // Clear recording waveform buffer and set channel count
    {
        let mut rwb = state.recording_waveform_buffer.lock().map_err(|e| e.to_string())?;
        rwb.clear();
    }
    state.recording_waveform_channels.store(channels, Ordering::Relaxed);

    state.is_recording.store(true, Ordering::Relaxed);
    Ok(())
}

/// Stop recording and finalize the WAV file.
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

    // Wait for writer thread to finish
    {
        let mut handle = state.writer_handle.lock().map_err(|e| e.to_string())?;
        if let Some(h) = handle.take() {
            h.join().map_err(|_| "Writer thread panicked".to_string())?;
        }
    }

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
pub fn get_recording_waveform(state: &RecorderState, num_bars: usize) -> visualization::RecordingWaveformData {
    let buf = match state.recording_waveform_buffer.lock() {
        Ok(b) => b.clone(),
        Err(_) => return visualization::RecordingWaveformData { peaks: vec![], centroids: vec![], duration: 0.0 },
    };

    if buf.is_empty() {
        return visualization::RecordingWaveformData { peaks: vec![], centroids: vec![], duration: 0.0 };
    }

    let channels = state.recording_waveform_channels.load(Ordering::Relaxed) as usize;
    let sample_rate = state.stream_sample_rate.load(Ordering::Relaxed);

    // Mix to mono
    let mono: Vec<f32> = if channels > 1 {
        buf.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        buf
    };

    let duration = mono.len() as f64 / sample_rate as f64;

    visualization::compute_recording_waveform(&mono, sample_rate, num_bars, duration)
}
