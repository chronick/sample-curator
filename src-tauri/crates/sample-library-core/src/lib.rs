//! Core library for sample-curator.
//!
//! This crate provides:
//! - Database operations (rusqlite)
//! - Embedding extraction and storage
//! - Similarity search (usearch ANN)
//! - Compatibility search (key/BPM/frequency matching)
//! - Project management
//! - Background job processing
//! - Folder watching
//! - Applicability scoring

pub mod db;
pub mod embedding;
pub mod error;
pub mod orphans;
pub mod search;
pub mod projects;
pub mod jobs;
pub mod watcher;
pub mod compatibility;
pub mod categorization;
pub mod scoring;

pub use db::{Database, Sample, Pack, Tag};
pub use embedding::{Embedding, EmbeddingExtractor};
pub use error::{Error, Result};
pub use search::{SimilaritySearch, SimilarityResult, SearchAspects};
pub use projects::{Project, ProjectSample};
pub use jobs::{JobQueue, Job, JobStatus, JobType};
pub use compatibility::{CompatibilitySearch, CompatibilityResult, CompatibilityCriteria};
pub use categorization::{AcousticTags, categorize_sample};
pub use scoring::{compute_applicability_score, score_sample, ScoreComponents};
