//! Folder watching for automatic sample import.
//!
//! Uses notify-rs to watch configured directories for new audio files
//! and automatically queue them for import and analysis.

use crate::error::{Error, Result};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Duration;

/// Supported audio file extensions.
const AUDIO_EXTENSIONS: &[&str] = &["wav", "aif", "aiff", "flac", "mp3", "ogg", "m4a"];

/// Event from the folder watcher.
#[derive(Debug, Clone)]
pub enum WatchEvent {
    /// New audio file detected.
    FileCreated(PathBuf),
    /// Audio file modified.
    FileModified(PathBuf),
    /// Audio file deleted.
    FileDeleted(PathBuf),
    /// Error occurred.
    Error(String),
}

/// Configuration for the folder watcher.
#[derive(Debug, Clone)]
pub struct WatchConfig {
    /// Directories to watch.
    pub directories: Vec<PathBuf>,
    /// Whether to watch subdirectories recursively.
    pub recursive: bool,
    /// Debounce duration (to avoid duplicate events).
    pub debounce_duration: Duration,
    /// File patterns to exclude.
    pub exclude_patterns: Vec<String>,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            directories: Vec::new(),
            recursive: true,
            debounce_duration: Duration::from_millis(500),
            exclude_patterns: vec![
                ".*".to_string(),        // Hidden files
                "_*".to_string(),        // Temp files
                "*.tmp".to_string(),     // Temp files
                "*.bak".to_string(),     // Backup files
            ],
        }
    }
}

/// Folder watcher for automatic sample import.
pub struct FolderWatcher {
    config: WatchConfig,
    _watcher: Option<RecommendedWatcher>,
}

impl FolderWatcher {
    /// Create a new folder watcher.
    pub fn new(config: WatchConfig) -> Self {
        Self {
            config,
            _watcher: None,
        }
    }

    /// Start watching configured directories.
    /// Returns a receiver for watch events.
    pub fn start(&mut self) -> Result<Receiver<WatchEvent>> {
        let (event_tx, event_rx) = channel();
        let exclude_patterns = self.config.exclude_patterns.clone();
        let debounce_duration = self.config.debounce_duration;

        // Create the raw event channel
        let (raw_tx, raw_rx) = channel();

        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = raw_tx.send(event);
            }
        })
        .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

        // Watch all configured directories
        let mode = if self.config.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };

        // Store watcher before watching to keep it alive
        self._watcher = Some(watcher);

        if let Some(ref mut w) = self._watcher {
            for dir in &self.config.directories {
                if dir.exists() {
                    w.watch(dir, mode)
                        .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
                    log::info!("Watching directory: {:?}", dir);
                } else {
                    log::warn!("Directory does not exist: {:?}", dir);
                }
            }
        }

        // Spawn thread to process and debounce events
        std::thread::spawn(move || {
            process_events(raw_rx, event_tx, &exclude_patterns, debounce_duration);
        });

        Ok(event_rx)
    }

    /// Stop watching.
    pub fn stop(&mut self) {
        self._watcher = None;
    }

    /// Add a directory to watch.
    pub fn add_directory(&mut self, path: PathBuf) -> Result<()> {
        if let Some(ref mut watcher) = self._watcher {
            let mode = if self.config.recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };

            watcher
                .watch(&path, mode)
                .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

            self.config.directories.push(path);
        }
        Ok(())
    }

    /// Remove a directory from watching.
    pub fn remove_directory(&mut self, path: &Path) -> Result<()> {
        if let Some(ref mut watcher) = self._watcher {
            watcher
                .unwatch(path)
                .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

            self.config.directories.retain(|p| p != path);
        }
        Ok(())
    }
}

/// Process raw events into debounced watch events.
fn process_events(
    rx: Receiver<Event>,
    tx: Sender<WatchEvent>,
    exclude_patterns: &[String],
    debounce_duration: Duration,
) {
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();
    let mut last_cleanup = std::time::Instant::now();

    loop {
        // Clean up seen paths periodically
        if last_cleanup.elapsed() > Duration::from_secs(10) {
            seen_paths.clear();
            last_cleanup = std::time::Instant::now();
        }

        match rx.recv_timeout(debounce_duration) {
            Ok(event) => {
                for path in event.paths {
                    // Skip non-audio files
                    if !is_audio_file(&path) {
                        continue;
                    }

                    // Skip excluded patterns
                    if should_exclude(&path, exclude_patterns) {
                        continue;
                    }

                    // Debounce by skipping recently seen paths
                    if seen_paths.contains(&path) {
                        continue;
                    }
                    seen_paths.insert(path.clone());

                    // Map event kind to watch event
                    let watch_event = match event.kind {
                        EventKind::Create(_) => WatchEvent::FileCreated(path),
                        EventKind::Modify(_) => WatchEvent::FileModified(path),
                        EventKind::Remove(_) => WatchEvent::FileDeleted(path),
                        _ => continue,
                    };

                    if tx.send(watch_event).is_err() {
                        // Receiver dropped, exit thread
                        return;
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Clear seen paths after debounce period
                seen_paths.clear();
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                // Channel closed, exit thread
                return;
            }
        }
    }
}

/// Check if a path is an audio file.
fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Check if a path should be excluded.
fn should_exclude(path: &Path, patterns: &[String]) -> bool {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    for pattern in patterns {
        if pattern.starts_with('*') && pattern.ends_with('*') {
            // Contains pattern
            let middle = &pattern[1..pattern.len() - 1];
            if file_name.contains(middle) {
                return true;
            }
        } else if pattern.starts_with('*') {
            // Ends with pattern
            let suffix = &pattern[1..];
            if file_name.ends_with(suffix) {
                return true;
            }
        } else if pattern.ends_with('*') {
            // Starts with pattern
            let prefix = &pattern[..pattern.len() - 1];
            if file_name.starts_with(prefix) {
                return true;
            }
        } else {
            // Exact match
            if file_name == pattern {
                return true;
            }
        }
    }

    false
}

/// Scan a directory for audio files (for initial import).
pub fn scan_directory(path: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();

    if !path.is_dir() {
        return files;
    }

    scan_directory_impl(path, recursive, &mut files);

    files
}

fn scan_directory_impl(path: &Path, recursive: bool, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();

            if entry_path.is_file() && is_audio_file(&entry_path) {
                files.push(entry_path);
            } else if entry_path.is_dir() && recursive {
                scan_directory_impl(&entry_path, recursive, files);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file(Path::new("test.wav")));
        assert!(is_audio_file(Path::new("test.WAV")));
        assert!(is_audio_file(Path::new("test.mp3")));
        assert!(is_audio_file(Path::new("test.flac")));
        assert!(!is_audio_file(Path::new("test.txt")));
        assert!(!is_audio_file(Path::new("test.jpg")));
    }

    #[test]
    fn test_should_exclude() {
        let patterns = vec![
            ".*".to_string(),
            "*.tmp".to_string(),
            "_*".to_string(),
        ];

        assert!(should_exclude(Path::new(".hidden.wav"), &patterns));
        assert!(should_exclude(Path::new("test.tmp"), &patterns));
        assert!(should_exclude(Path::new("_temp.wav"), &patterns));
        assert!(!should_exclude(Path::new("normal.wav"), &patterns));
    }
}
