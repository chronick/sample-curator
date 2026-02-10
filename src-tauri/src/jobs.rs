//! Background job management commands.
//!
//! Provides Tauri commands for managing the analysis job queue.
//!
//! Note: The background worker runs in a separate thread with its own database
//! connection since rusqlite::Connection is not Send.

use sample_library_core::db::Database;
use sample_library_core::jobs::{Job, JobQueue, JobStats, JobWorker, JobProgress, JobType, JobStatus};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, State};

/// State for job queue management.
pub struct JobState {
    db_path: PathBuf,
    worker_running: AtomicBool,
    worker_stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl JobState {
    pub fn new() -> Self {
        let db_path = get_db_path().unwrap_or_else(|_| PathBuf::from("library.db"));
        Self {
            db_path,
            worker_running: AtomicBool::new(false),
            worker_stop: Mutex::new(None),
        }
    }

    fn open_db(&self) -> Result<Database, String> {
        Database::open(&self.db_path).map_err(|e| e.to_string())
    }
}

impl Default for JobState {
    fn default() -> Self {
        Self::new()
    }
}

fn get_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Could not find home directory")?;
    let path = home.join(".music-hub-data").join("sample-library").join("library.db");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Job status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatusResponse {
    pub stats: JobStats,
    pub worker_running: bool,
}

/// Get job queue statistics.
#[tauri::command]
pub fn get_job_stats(state: State<'_, JobState>) -> Result<JobStatusResponse, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));
    let stats = queue.stats().map_err(|e| e.to_string())?;
    let worker_running = state.worker_running.load(Ordering::Relaxed);

    Ok(JobStatusResponse {
        stats,
        worker_running,
    })
}

/// Queue embedding jobs for all samples missing embeddings.
#[tauri::command]
pub fn queue_missing_embeddings(
    priority: Option<i32>,
    state: State<'_, JobState>,
) -> Result<usize, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));
    let count = queue.enqueue_missing_embeddings(priority.unwrap_or(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Queue a job for a specific sample.
#[tauri::command]
pub fn queue_sample_job(
    sample_id: i64,
    job_type: String,
    priority: Option<i32>,
    state: State<'_, JobState>,
) -> Result<i64, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));

    let jt = match job_type.as_str() {
        "embedding" => JobType::Embedding,
        "spectral" => JobType::Spectral,
        "full" => JobType::Full,
        "clap" => JobType::Clap,
        _ => return Err(format!("Unknown job type: {}", job_type)),
    };

    let job_id = queue.enqueue(Some(sample_id), jt, priority.unwrap_or(0))
        .map_err(|e| e.to_string())?;

    Ok(job_id)
}

/// Start the background worker.
#[tauri::command]
pub fn start_job_worker(app_handle: tauri::AppHandle, state: State<'_, JobState>) -> Result<bool, String> {
    // Check if already running
    if state.worker_running.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // Get database path for worker thread
    let db_path = state.db_path.clone();

    // Create stop flag
    let stop_flag = Arc::new(AtomicBool::new(false));

    // Store stop flag for later
    {
        let mut guard = state.worker_stop.lock().map_err(|e| e.to_string())?;
        *guard = Some(Arc::clone(&stop_flag));
    }

    state.worker_running.store(true, Ordering::Relaxed);

    let app = app_handle.clone();

    // Spawn worker thread - creates its own database connection
    thread::spawn(move || {
        // Open database in worker thread
        let db = match Database::open(&db_path) {
            Ok(db) => Arc::new(db),
            Err(e) => {
                eprintln!("Worker failed to open database: {}", e);
                return;
            }
        };

        let queue = Arc::new(JobQueue::new(Arc::clone(&db)));
        let worker = JobWorker::new(queue, db);

        // Run until stopped
        loop {
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Process one batch of jobs
            match worker.run(|progress| {
                match &progress {
                    JobProgress::Started { job_id, job_type } => {
                        println!("[Jobs] Job {} started: {:?}", job_id, job_type);
                    }
                    JobProgress::Completed { job_id } => {
                        println!("[Jobs] Job {} completed", job_id);
                    }
                    JobProgress::Failed { job_id, error } => {
                        eprintln!("[Jobs] Job {} failed: {}", job_id, error);
                    }
                }
                // Emit Tauri event for real-time frontend updates
                let _ = app.emit("job:progress", &progress);
            }) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[Jobs] Worker error: {}", e);
                    thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        }
    });

    Ok(true)
}

/// Stop the background worker.
#[tauri::command]
pub fn stop_job_worker(state: State<'_, JobState>) -> Result<bool, String> {
    if !state.worker_running.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // Signal stop
    {
        let guard = state.worker_stop.lock().map_err(|e| e.to_string())?;
        if let Some(ref stop_flag) = *guard {
            stop_flag.store(true, Ordering::Relaxed);
        }
    }

    state.worker_running.store(false, Ordering::Relaxed);

    Ok(true)
}

/// Reset any stuck jobs from previous runs.
#[tauri::command]
pub fn reset_stuck_jobs(state: State<'_, JobState>) -> Result<usize, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));
    queue.reset_stuck_jobs().map_err(|e| e.to_string())
}

/// Clean up old completed/failed jobs.
#[tauri::command]
pub fn cleanup_old_jobs(
    days_old: Option<i32>,
    state: State<'_, JobState>,
) -> Result<usize, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));
    queue.cleanup(days_old.unwrap_or(7)).map_err(|e| e.to_string())
}

/// List recent jobs with optional status filter.
#[tauri::command]
pub fn list_jobs(
    limit: Option<i64>,
    status: Option<String>,
    state: State<'_, JobState>,
) -> Result<Vec<Job>, String> {
    let db = state.open_db()?;
    let queue = JobQueue::new(Arc::new(db));

    let status_filter = status.and_then(|s| JobStatus::from_str(&s));
    let jobs = queue.list_recent_jobs(limit.unwrap_or(50), status_filter)
        .map_err(|e| e.to_string())?;

    Ok(jobs)
}
