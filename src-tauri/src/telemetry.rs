//! Structured session/job event telemetry.
//!
//! Writes one JSON line per event to a daily file at
//! `~/.music-hub-data/logs/events-YYYY-MM-DD.jsonl`. Surfaced in the Settings
//! Debug-log panel for diagnosing "naming hung" / "stem job died" without
//! console-diving (vault-259a).

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Top-level event category. Keep in sync with the frontend filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventCategory {
    Arm,
    Clip,
    Job,
}

impl EventCategory {
    fn as_str(self) -> &'static str {
        match self {
            EventCategory::Arm => "arm",
            EventCategory::Clip => "clip",
            EventCategory::Job => "job",
        }
    }
}

/// One event written to the JSONL log. `details` is freeform per event_type
/// so callers can attach context (job id, naming method, sample id, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub ts: String,
    pub category: String,
    pub event_type: String,
    #[serde(default)]
    pub details: serde_json::Value,
}

/// Mockable directory override for tests. None in production → resolves
/// `~/.music-hub-data/logs`.
pub struct TelemetryState {
    dir_override: Mutex<Option<PathBuf>>,
}

impl TelemetryState {
    pub fn new() -> Self {
        Self {
            dir_override: Mutex::new(None),
        }
    }
}

impl Default for TelemetryState {
    fn default() -> Self {
        Self::new()
    }
}

fn default_log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".music-hub-data")
        .join("logs")
}

fn log_file_for(dir: &Path, date_utc: &str) -> PathBuf {
    dir.join(format!("events-{}.jsonl", date_utc))
}

/// Append one event to today's log. Failures are logged to stderr but never
/// propagate — telemetry must not break the user's recording flow.
pub fn log_event(category: EventCategory, event_type: &str, details: serde_json::Value) {
    log_event_in(&default_log_dir(), category, event_type, details);
}

/// Test-friendly variant that targets an explicit directory.
pub fn log_event_in(
    dir: &Path,
    category: EventCategory,
    event_type: &str,
    details: serde_json::Value,
) {
    let now = Utc::now();
    let event = LogEvent {
        ts: now.to_rfc3339(),
        category: category.as_str().to_string(),
        event_type: event_type.to_string(),
        details,
    };
    if let Err(e) = append_event(dir, &now.format("%Y-%m-%d").to_string(), &event) {
        eprintln!("[telemetry] failed to write event {}/{}: {}", category.as_str(), event_type, e);
    }
}

fn append_event(dir: &Path, date_utc: &str, event: &LogEvent) -> std::io::Result<()> {
    create_dir_all(dir)?;
    let path = log_file_for(dir, date_utc);
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    let line = serde_json::to_string(event)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

/// Read the most recent `limit` events from today's log, optionally filtered
/// by category. Returned in chronological order (oldest → newest of the
/// selected window) so the UI can render bottom-anchored without re-sorting.
pub fn read_recent(
    dir: &Path,
    date_utc: &str,
    limit: usize,
    category: Option<EventCategory>,
) -> Vec<LogEvent> {
    let path = log_file_for(dir, date_utc);
    let file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut events: Vec<LogEvent> = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<LogEvent>(&line) {
            Ok(ev) => {
                if let Some(cat) = category {
                    if ev.category != cat.as_str() {
                        continue;
                    }
                }
                events.push(ev);
            }
            Err(_) => {
                // Skip malformed line; log corruption shouldn't break the panel.
            }
        }
    }
    if events.len() > limit {
        let drop = events.len() - limit;
        events.drain(..drop);
    }
    events
}

/// Frontend command — last `limit` events from today's log, filterable by
/// category ("arm" / "clip" / "job"). Empty list when the log doesn't exist.
#[tauri::command]
pub fn telemetry_recent_events(
    limit: Option<usize>,
    category: Option<String>,
    state: State<'_, TelemetryState>,
) -> Result<Vec<LogEvent>, String> {
    let limit = limit.unwrap_or(100).min(1000);
    let cat = match category.as_deref() {
        Some("arm") => Some(EventCategory::Arm),
        Some("clip") => Some(EventCategory::Clip),
        Some("job") => Some(EventCategory::Job),
        Some("all") | None => None,
        Some(other) => return Err(format!("unknown category filter: {}", other)),
    };
    let dir = state
        .dir_override
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_else(default_log_dir);
    let date_utc = Utc::now().format("%Y-%m-%d").to_string();
    Ok(read_recent(&dir, &date_utc, limit, cat))
}

/// Frontend command — absolute path of today's log (whether or not it
/// exists). Used by the Settings panel "open in Finder" affordance.
#[tauri::command]
pub fn telemetry_log_path(state: State<'_, TelemetryState>) -> Result<String, String> {
    let dir = state
        .dir_override
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_else(default_log_dir);
    let date_utc = Utc::now().format("%Y-%m-%d").to_string();
    Ok(log_file_for(&dir, &date_utc).to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn append_creates_dir_and_file() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("nested");
        log_event_in(&target, EventCategory::Arm, "arm-on", json!({"tag": "session:abc"}));
        let path = log_file_for(&target, &Utc::now().format("%Y-%m-%d").to_string());
        assert!(path.exists(), "log file should be created");
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("\"event_type\":\"arm-on\""), "expected event in log: {}", body);
        assert!(body.ends_with('\n'), "each event line should be newline-terminated");
    }

    #[test]
    fn read_recent_respects_limit() {
        let dir = tempdir().unwrap();
        for i in 0..5 {
            log_event_in(dir.path(), EventCategory::Job, "job-started", json!({"i": i}));
        }
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let events = read_recent(dir.path(), &date, 3, None);
        assert_eq!(events.len(), 3);
        // Last 3 → indexes 2,3,4 (oldest-to-newest of returned window).
        assert_eq!(events[0].details["i"], json!(2));
        assert_eq!(events[2].details["i"], json!(4));
    }

    #[test]
    fn read_recent_filters_by_category() {
        let dir = tempdir().unwrap();
        log_event_in(dir.path(), EventCategory::Arm, "arm-on", json!({}));
        log_event_in(dir.path(), EventCategory::Job, "job-started", json!({"id": 7}));
        log_event_in(dir.path(), EventCategory::Clip, "clip-finalized", json!({}));
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let only_jobs = read_recent(dir.path(), &date, 100, Some(EventCategory::Job));
        assert_eq!(only_jobs.len(), 1);
        assert_eq!(only_jobs[0].event_type, "job-started");
        assert_eq!(only_jobs[0].details["id"], json!(7));
    }

    #[test]
    fn read_recent_returns_empty_when_no_log() {
        let dir = tempdir().unwrap();
        let events = read_recent(dir.path(), "2099-01-01", 100, None);
        assert!(events.is_empty());
    }

    #[test]
    fn read_recent_skips_malformed_lines() {
        let dir = tempdir().unwrap();
        log_event_in(dir.path(), EventCategory::Arm, "arm-on", json!({}));
        // Hand-write a malformed line between two valid events.
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let path = log_file_for(dir.path(), &date);
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(b"not-json\n").unwrap();
        drop(f);
        log_event_in(dir.path(), EventCategory::Arm, "arm-off", json!({}));
        let events = read_recent(dir.path(), &date, 100, None);
        assert_eq!(events.len(), 2, "malformed line should be skipped, valid events kept");
        assert_eq!(events[0].event_type, "arm-on");
        assert_eq!(events[1].event_type, "arm-off");
    }
}
