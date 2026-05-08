//! Background job queue for analysis and embedding generation.
//!
//! Provides persistent job tracking that survives app restarts.

use crate::db::Database;
use crate::error::{Error, Result};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Job type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobType {
    /// Generate embedding for a sample.
    Embedding,
    /// Run CLAP semantic embedding (Python sidecar).
    Clap,
    /// Extract spectral features.
    Spectral,
    /// Full analysis pipeline.
    Full,
    /// Run demucs stem separation (vault-2nnt). Currently driven by
    /// the `stems::separate_stems` Tauri command rather than the
    /// in-process JobWorker, but the variant exists so the analysis
    /// job table can persist queued/running stem work and the future
    /// unified TransformJob queue (vault-1mlx) has a slot for it.
    StemSeparation,
}

impl JobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobType::Embedding => "embedding",
            JobType::Clap => "clap",
            JobType::Spectral => "spectral",
            JobType::Full => "full",
            JobType::StemSeparation => "stem_separation",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "embedding" => Some(JobType::Embedding),
            "clap" => Some(JobType::Clap),
            "spectral" => Some(JobType::Spectral),
            "full" => Some(JobType::Full),
            "stem_separation" => Some(JobType::StemSeparation),
            _ => None,
        }
    }
}

/// Job status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobStatus {
    Pending,
    Running,
    Complete,
    Failed,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Complete => "complete",
            JobStatus::Failed => "failed",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(JobStatus::Pending),
            "running" => Some(JobStatus::Running),
            "complete" => Some(JobStatus::Complete),
            "failed" => Some(JobStatus::Failed),
            _ => None,
        }
    }
}

/// A job in the queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: i64,
    pub sample_id: Option<i64>,
    pub job_type: JobType,
    pub priority: i32,
    pub status: JobStatus,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

impl Job {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let job_type_str: String = row.get("job_type")?;
        let status_str: String = row.get("status")?;

        Ok(Job {
            id: row.get("id")?,
            sample_id: row.get("sample_id")?,
            job_type: JobType::from_str(&job_type_str).unwrap_or(JobType::Embedding),
            priority: row.get("priority")?,
            status: JobStatus::from_str(&status_str).unwrap_or(JobStatus::Pending),
            error_message: row.get("error_message")?,
            created_at: row.get("created_at")?,
            started_at: row.get("started_at")?,
            completed_at: row.get("completed_at")?,
        })
    }
}

/// Job queue for managing background processing.
pub struct JobQueue {
    db: Arc<Database>,
}

impl JobQueue {
    /// Create a new job queue.
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Queue a new job.
    pub fn enqueue(
        &self,
        sample_id: Option<i64>,
        job_type: JobType,
        priority: i32,
    ) -> Result<i64> {
        self.db.connection().execute(
            r#"
            INSERT INTO analysis_jobs (sample_id, job_type, priority, status, created_at)
            VALUES (?1, ?2, ?3, 'pending', CURRENT_TIMESTAMP)
            "#,
            params![sample_id, job_type.as_str(), priority],
        )?;

        Ok(self.db.connection().last_insert_rowid())
    }

    /// Queue embedding jobs for all samples without embeddings.
    pub fn enqueue_missing_embeddings(&self, priority: i32) -> Result<usize> {
        let result = self.db.connection().execute(
            r#"
            INSERT INTO analysis_jobs (sample_id, job_type, priority, status, created_at)
            SELECT s.id, 'embedding', ?1, 'pending', CURRENT_TIMESTAMP
            FROM samples s
            LEFT JOIN embeddings e ON s.id = e.sample_id
            LEFT JOIN analysis_jobs aj ON s.id = aj.sample_id
                AND aj.job_type = 'embedding'
                AND aj.status IN ('pending', 'running')
            WHERE e.sample_id IS NULL
              AND aj.id IS NULL
            "#,
            [priority],
        )?;

        Ok(result)
    }

    /// Get the next pending job (highest priority first).
    pub fn dequeue(&self) -> Result<Option<Job>> {
        // Start a transaction to atomically claim the job
        let tx = self.db.connection();

        // Find the next pending job
        let job: Option<Job> = tx
            .query_row(
                r#"
                SELECT * FROM analysis_jobs
                WHERE status = 'pending'
                ORDER BY priority DESC, created_at ASC
                LIMIT 1
                "#,
                [],
                Job::from_row,
            )
            .optional()?;

        if let Some(ref j) = job {
            // Mark as running
            tx.execute(
                r#"
                UPDATE analysis_jobs
                SET status = 'running', started_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                "#,
                [j.id],
            )?;
        }

        Ok(job)
    }

    /// Get a job by ID.
    pub fn get_job(&self, id: i64) -> Result<Option<Job>> {
        let job = self
            .db
            .connection()
            .query_row(
                "SELECT * FROM analysis_jobs WHERE id = ?1",
                [id],
                Job::from_row,
            )
            .optional()?;
        Ok(job)
    }

    /// Mark a job as complete.
    pub fn complete(&self, id: i64) -> Result<()> {
        self.db.connection().execute(
            r#"
            UPDATE analysis_jobs
            SET status = 'complete', completed_at = CURRENT_TIMESTAMP
            WHERE id = ?1
            "#,
            [id],
        )?;
        Ok(())
    }

    /// Mark a job as failed.
    pub fn fail(&self, id: i64, error_message: &str) -> Result<()> {
        self.db.connection().execute(
            r#"
            UPDATE analysis_jobs
            SET status = 'failed', error_message = ?2, completed_at = CURRENT_TIMESTAMP
            WHERE id = ?1
            "#,
            params![id, error_message],
        )?;
        Ok(())
    }

    /// Get pending job count.
    pub fn pending_count(&self) -> Result<i64> {
        let count: i64 = self.db.connection().query_row(
            "SELECT COUNT(*) FROM analysis_jobs WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Get running job count.
    pub fn running_count(&self) -> Result<i64> {
        let count: i64 = self.db.connection().query_row(
            "SELECT COUNT(*) FROM analysis_jobs WHERE status = 'running'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Get job statistics.
    pub fn stats(&self) -> Result<JobStats> {
        let mut stmt = self.db.connection().prepare(
            r#"
            SELECT status, COUNT(*) as count
            FROM analysis_jobs
            GROUP BY status
            "#,
        )?;

        let rows = stmt.query_map([], |row| {
            let status: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((status, count))
        })?;

        let mut stats = JobStats::default();
        for row in rows {
            let (status, count) = row?;
            match status.as_str() {
                "pending" => stats.pending = count,
                "running" => stats.running = count,
                "complete" => stats.complete = count,
                "failed" => stats.failed = count,
                _ => {}
            }
        }

        Ok(stats)
    }

    /// Clear completed jobs older than N days.
    pub fn cleanup(&self, days_old: i32) -> Result<usize> {
        let result = self.db.connection().execute(
            r#"
            DELETE FROM analysis_jobs
            WHERE status IN ('complete', 'failed')
              AND completed_at < datetime('now', '-' || ?1 || ' days')
            "#,
            [days_old],
        )?;
        Ok(result)
    }

    /// Reset stuck running jobs (e.g., after crash).
    pub fn reset_stuck_jobs(&self) -> Result<usize> {
        let result = self.db.connection().execute(
            r#"
            UPDATE analysis_jobs
            SET status = 'pending', started_at = NULL
            WHERE status = 'running'
            "#,
            [],
        )?;
        Ok(result)
    }

    /// List recent jobs with optional status filter.
    pub fn list_recent_jobs(&self, limit: i64, status_filter: Option<JobStatus>) -> Result<Vec<Job>> {
        let mut jobs = Vec::new();

        if let Some(status) = status_filter {
            let mut stmt = self.db.connection().prepare(
                r#"
                SELECT * FROM analysis_jobs
                WHERE status = ?1
                ORDER BY created_at DESC
                LIMIT ?2
                "#,
            )?;
            let rows = stmt.query_map(params![status.as_str(), limit], Job::from_row)?;
            for row in rows {
                jobs.push(row?);
            }
        } else {
            let mut stmt = self.db.connection().prepare(
                r#"
                SELECT * FROM analysis_jobs
                ORDER BY
                    CASE status
                        WHEN 'running' THEN 0
                        WHEN 'pending' THEN 1
                        WHEN 'failed' THEN 2
                        WHEN 'complete' THEN 3
                    END,
                    created_at DESC
                LIMIT ?1
                "#,
            )?;
            let rows = stmt.query_map([limit], Job::from_row)?;
            for row in rows {
                jobs.push(row?);
            }
        }

        Ok(jobs)
    }
}

/// Job statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JobStats {
    pub pending: i64,
    pub running: i64,
    pub complete: i64,
    pub failed: i64,
}

impl JobStats {
    pub fn total(&self) -> i64 {
        self.pending + self.running + self.complete + self.failed
    }
}

/// Background worker for processing jobs.
pub struct JobWorker {
    queue: Arc<JobQueue>,
    db: Arc<Database>,
    stop_flag: Arc<AtomicBool>,
}

impl JobWorker {
    /// Create a new worker.
    pub fn new(queue: Arc<JobQueue>, db: Arc<Database>) -> Self {
        Self {
            queue,
            db,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Get the stop flag for signaling shutdown.
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.stop_flag)
    }

    /// Process jobs until stopped.
    pub fn run<F>(&self, mut on_progress: F) -> Result<usize>
    where
        F: FnMut(JobProgress),
    {
        let mut processed = 0;

        while !self.stop_flag.load(Ordering::Relaxed) {
            match self.queue.dequeue()? {
                Some(job) => {
                    on_progress(JobProgress::Started {
                        job_id: job.id,
                        job_type: job.job_type,
                    });

                    let result = self.process_job(&job);

                    match result {
                        Ok(()) => {
                            self.queue.complete(job.id)?;
                            on_progress(JobProgress::Completed { job_id: job.id });
                            processed += 1;
                        }
                        Err(e) => {
                            let error_msg = e.to_string();
                            self.queue.fail(job.id, &error_msg)?;
                            on_progress(JobProgress::Failed {
                                job_id: job.id,
                                error: error_msg,
                            });
                        }
                    }
                }
                None => {
                    // No pending jobs, sleep briefly
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }

        Ok(processed)
    }

    /// Process a single job.
    fn process_job(&self, job: &Job) -> Result<()> {
        match job.job_type {
            JobType::Embedding => {
                if let Some(sample_id) = job.sample_id {
                    let extractor = crate::embedding::EmbeddingExtractor::new();
                    let sample = self
                        .db
                        .get_sample(sample_id)?
                        .ok_or(Error::SampleNotFound(sample_id))?;

                    let embedding = extractor.extract_from_file(&sample.path)?;
                    self.db.store_embedding(
                        sample_id,
                        &embedding,
                        crate::embedding::EMBEDDING_VERSION,
                    )?;
                }
            }
            JobType::Spectral => {
                if let Some(sample_id) = job.sample_id {
                    let sample = self
                        .db
                        .get_sample(sample_id)?
                        .ok_or(Error::SampleNotFound(sample_id))?;

                    let spectral = sample_analysis_core::analyzers::spectral::analyze_spectral_file(
                        &sample.path,
                        None,
                    )?;

                    self.db.update_spectral_features(
                        sample_id,
                        spectral.spectral_centroid,
                        spectral.spectral_flatness,
                        spectral.spectral_bandwidth,
                        spectral.spectral_rolloff,
                    )?;
                }
            }
            JobType::Clap => {
                // CLAP requires Python sidecar - this is handled externally
                log::info!("CLAP job requires Python sidecar");
            }
            JobType::StemSeparation => {
                // Stem separation is driven by the `stems::separate_stems`
                // Tauri command (which talks to the sidecar's runtime
                // worker). The in-process JobWorker doesn't run it; rows
                // of this kind are owned by the command-driven path.
                log::debug!("StemSeparation job seen by JobWorker; skipping");
            }
            JobType::Full => {
                // Run spectral + embedding
                if let Some(sample_id) = job.sample_id {
                    let sample = self
                        .db
                        .get_sample(sample_id)?
                        .ok_or(Error::SampleNotFound(sample_id))?;

                    // Spectral
                    let spectral = sample_analysis_core::analyzers::spectral::analyze_spectral_file(
                        &sample.path,
                        None,
                    )?;
                    self.db.update_spectral_features(
                        sample_id,
                        spectral.spectral_centroid,
                        spectral.spectral_flatness,
                        spectral.spectral_bandwidth,
                        spectral.spectral_rolloff,
                    )?;

                    // Embedding
                    let extractor = crate::embedding::EmbeddingExtractor::new();
                    let embedding = extractor.extract_from_file(&sample.path)?;
                    self.db.store_embedding(
                        sample_id,
                        &embedding,
                        crate::embedding::EMBEDDING_VERSION,
                    )?;
                }
            }
        }

        Ok(())
    }
}

/// Progress update from job worker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobProgress {
    Started { job_id: i64, job_type: JobType },
    Completed { job_id: i64 },
    Failed { job_id: i64, error: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_queue() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let queue = JobQueue::new(Arc::clone(&db));

        // Enqueue jobs without sample_id (no FK constraint)
        let id1 = queue.enqueue(None, JobType::Embedding, 0).unwrap();
        let id2 = queue.enqueue(None, JobType::Embedding, 10).unwrap();

        // Higher priority should be dequeued first
        let job = queue.dequeue().unwrap().unwrap();
        assert_eq!(job.id, id2);
        assert_eq!(job.priority, 10);

        // Complete the job
        queue.complete(job.id).unwrap();

        // Next job
        let job = queue.dequeue().unwrap().unwrap();
        assert_eq!(job.id, id1);

        // Stats
        let stats = queue.stats().unwrap();
        assert_eq!(stats.running, 1);
        assert_eq!(stats.complete, 1);
    }
}
