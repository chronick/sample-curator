//! Native audio playback using rodio with a dedicated audio thread.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

// Commands sent to the audio thread
enum AudioCommand {
    Play(PathBuf),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    GetStatus(Sender<AudioStatus>),
}

#[derive(Clone, Copy)]
pub struct AudioStatus {
    pub is_playing: bool,
    pub is_paused: bool,
    pub duration: f64,
    pub position: f64,
}

// Build a rodio output stream at the given sample rate, if the default output
// device supports it. Returns the stream, a handle, and the rate the stream was
// actually opened at (which may differ from `target_rate` on fallback).
//
// Why: rodio 0.17's mixer will resample any source whose rate differs from the
// stream's rate, using a linear-interpolation resampler that produces audible
// artifacts on common conversions like 44.1→48 kHz. Opening the stream at the
// source rate sidesteps that path entirely.
fn build_output_stream_for_rate(
    target_rate: u32,
) -> Option<(rodio::OutputStream, rodio::OutputStreamHandle, u32)> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let target = cpal::SampleRate(target_rate);

    let matched = device.supported_output_configs().ok().and_then(|configs| {
        configs
            .filter_map(|range| {
                if range.min_sample_rate() <= target && target <= range.max_sample_rate() {
                    Some(range.with_sample_rate(target))
                } else {
                    None
                }
            })
            .next()
    });

    if let Some(config) = matched {
        let rate = config.sample_rate().0;
        if let Ok((s, h)) = rodio::OutputStream::try_from_device_config(&device, config) {
            return Some((s, h, rate));
        }
    }

    // Fallback: device's native config (resampling path — may glitch, but keeps audio alive).
    let default_rate = device.default_output_config().ok().map(|c| c.sample_rate().0)?;
    let (s, h) = rodio::OutputStream::try_default().ok()?;
    Some((s, h, default_rate))
}

// Audio thread that owns the rodio objects
fn audio_thread(rx: std::sync::mpsc::Receiver<AudioCommand>) {
    use rodio::{Decoder, Sink, Source};
    use std::fs::File;
    use std::io::BufReader;

    // Output stream is lazy: built on first Play at the source file's sample rate,
    // rebuilt when a subsequent file's rate differs. The third tuple element is the
    // rate the stream was actually opened at (may differ from requested on fallback).
    // CoreAudio rate renegotiation costs ~50–100ms; caching by rate avoids thrashing
    // when auditioning a run of same-rate files.
    let mut output: Option<(rodio::OutputStream, rodio::OutputStreamHandle, u32)> = None;

    let mut sink: Option<Sink> = None;
    let mut duration: f64 = 0.0;

    // Position tracking
    let mut play_started_at: Option<Instant> = None;
    let mut paused_at: Option<Instant> = None;
    let mut total_paused_duration: Duration = Duration::ZERO;

    loop {
        match rx.recv() {
            Ok(AudioCommand::Play(path)) => {
                // Stop any current playback BEFORE potentially dropping the stream.
                if let Some(s) = sink.take() {
                    s.stop();
                }

                // Open and decode file first so we know its sample rate.
                let file = match File::open(&path) {
                    Ok(f) => f,
                    Err(e) => {
                        eprintln!("Failed to open file {:?}: {}", path, e);
                        continue;
                    }
                };

                let reader = BufReader::new(file);
                let source = match Decoder::new(reader) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Failed to decode audio: {}", e);
                        continue;
                    }
                };

                let src_rate = source.sample_rate();

                // Rebuild output stream if rate mismatches current (or no stream yet).
                // Drop the old stream first — on macOS this releases the CoreAudio
                // device back to its default config before we re-open at the new rate.
                let needs_rebuild = match &output {
                    Some((_, _, rate)) => *rate != src_rate,
                    None => true,
                };
                if needs_rebuild {
                    // Explicitly drop the old stream before building a new one so
                    // CoreAudio can re-negotiate the device config at the new rate.
                    drop(output.take());
                    output = build_output_stream_for_rate(src_rate);
                }

                let stream_handle = match output.as_ref() {
                    Some((_, handle, _)) => handle,
                    None => {
                        eprintln!("Failed to open audio output at {} Hz", src_rate);
                        continue;
                    }
                };

                let new_sink = match Sink::try_new(stream_handle) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Failed to create sink: {}", e);
                        continue;
                    }
                };

                duration = source.total_duration().map(|d: Duration| d.as_secs_f64()).unwrap_or(0.0);

                play_started_at = Some(Instant::now());
                paused_at = None;
                total_paused_duration = Duration::ZERO;

                new_sink.append(source);
                new_sink.play();
                sink = Some(new_sink);

                let actual_rate = output.as_ref().map(|(_, _, r)| *r).unwrap_or(0);
                println!(
                    "Audio playing: {:?}, duration: {}, src_rate: {}Hz, stream_rate: {}Hz",
                    path, duration, src_rate, actual_rate
                );
            }
            Ok(AudioCommand::Pause) => {
                if let Some(ref s) = sink {
                    s.pause();
                    // Record when we paused
                    if paused_at.is_none() {
                        paused_at = Some(Instant::now());
                    }
                }
            }
            Ok(AudioCommand::Resume) => {
                if let Some(ref s) = sink {
                    s.play();
                    // Add pause duration to total
                    if let Some(pause_time) = paused_at.take() {
                        total_paused_duration += pause_time.elapsed();
                    }
                }
            }
            Ok(AudioCommand::Stop) => {
                if let Some(s) = sink.take() {
                    s.stop();
                }
                duration = 0.0;
                play_started_at = None;
                paused_at = None;
                total_paused_duration = Duration::ZERO;
            }
            Ok(AudioCommand::SetVolume(vol)) => {
                if let Some(ref s) = sink {
                    s.set_volume(vol);
                }
            }
            Ok(AudioCommand::GetStatus(reply)) => {
                let status = if let Some(ref s) = sink {
                    let is_playing = !s.empty();
                    let is_paused = s.is_paused();

                    // Calculate current position
                    let position = if let Some(start) = play_started_at {
                        let elapsed = start.elapsed();
                        let paused_time = if let Some(pause_time) = paused_at {
                            total_paused_duration + pause_time.elapsed()
                        } else {
                            total_paused_duration
                        };
                        let pos = elapsed.saturating_sub(paused_time).as_secs_f64();
                        // Clamp to duration
                        pos.min(duration)
                    } else {
                        0.0
                    };

                    AudioStatus {
                        is_playing,
                        is_paused,
                        duration,
                        position,
                    }
                } else {
                    AudioStatus {
                        is_playing: false,
                        is_paused: false,
                        duration: 0.0,
                        position: 0.0,
                    }
                };
                let _ = reply.send(status);
            }
            Err(_) => {
                // Channel closed, exit thread
                break;
            }
        }
    }
}

// Thread-safe wrapper that sends commands to the audio thread
pub struct AudioState {
    tx: Mutex<Option<Sender<AudioCommand>>>,
}

impl AudioState {
    pub fn new() -> Self {
        let (tx, rx) = channel();

        // Spawn audio thread
        thread::spawn(move || {
            audio_thread(rx);
        });

        Self {
            tx: Mutex::new(Some(tx)),
        }
    }

    fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        let guard = self.tx.lock().map_err(|e| e.to_string())?;
        if let Some(ref tx) = *guard {
            tx.send(cmd).map_err(|e| e.to_string())
        } else {
            Err("Audio thread not running".to_string())
        }
    }

    pub fn play(&self, path: &str) -> Result<f64, String> {
        self.send(AudioCommand::Play(PathBuf::from(path)))?;
        // Return duration via status query
        let status = self.get_status()?;
        Ok(status.duration)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send(AudioCommand::Pause)
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send(AudioCommand::Resume)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send(AudioCommand::Stop)
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::SetVolume(volume.clamp(0.0, 1.0)))
    }

    pub fn get_status(&self) -> Result<AudioStatus, String> {
        let (reply_tx, reply_rx) = channel();
        self.send(AudioCommand::GetStatus(reply_tx))?;
        reply_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .map_err(|e| format!("Failed to get status: {}", e))
    }
}
