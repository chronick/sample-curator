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

// Audio thread that owns the rodio objects
fn audio_thread(rx: std::sync::mpsc::Receiver<AudioCommand>) {
    use rodio::{Decoder, OutputStream, Sink, Source};
    use std::fs::File;
    use std::io::BufReader;

    // Create output stream - this must stay alive for audio to play
    let (_stream, stream_handle) = match OutputStream::try_default() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to open audio output: {}", e);
            return;
        }
    };

    let mut sink: Option<Sink> = None;
    let mut duration: f64 = 0.0;

    // Position tracking
    let mut play_started_at: Option<Instant> = None;
    let mut paused_at: Option<Instant> = None;
    let mut total_paused_duration: Duration = Duration::ZERO;

    loop {
        match rx.recv() {
            Ok(AudioCommand::Play(path)) => {
                // Stop any current playback
                if let Some(s) = sink.take() {
                    s.stop();
                }

                // Create new sink
                let new_sink = match Sink::try_new(&stream_handle) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Failed to create sink: {}", e);
                        continue;
                    }
                };

                // Open and decode file
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

                // Get duration
                duration = source.total_duration().map(|d: Duration| d.as_secs_f64()).unwrap_or(0.0);

                // Reset position tracking
                play_started_at = Some(Instant::now());
                paused_at = None;
                total_paused_duration = Duration::ZERO;

                // Play
                new_sink.append(source);
                new_sink.play();
                sink = Some(new_sink);

                println!("Audio playing: {:?}, duration: {}", path, duration);
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
