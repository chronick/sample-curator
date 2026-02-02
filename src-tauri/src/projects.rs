//! Project management commands.
//!
//! Projects are curated collections of samples for specific tasks.

use sample_library_core::{
    db::Database,
    projects::{export_project, ExportOptions, Project, ProjectSample},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// State for project operations (shared with search).
pub struct ProjectState {
    /// Database connection.
    db: Mutex<Option<Database>>,
}

impl ProjectState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
        }
    }

    /// Get or initialize the database.
    fn get_db(&self) -> Result<std::sync::MutexGuard<Option<Database>>, String> {
        let mut guard = self.db.lock().map_err(|e| e.to_string())?;

        if guard.is_none() {
            let db_path = get_db_path()?;
            let db = Database::open(&db_path).map_err(|e| e.to_string())?;
            *guard = Some(db);
        }

        Ok(guard)
    }
}

impl Default for ProjectState {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the database path.
fn get_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Could not find home directory")?;
    let path = home.join(".music-hub-data").join("sample-library").join("library.db");

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Input for creating a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub bpm_target: Option<f64>,
    pub key_target: Option<String>,
}

/// Input for updating a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub bpm_target: Option<f64>,
    pub key_target: Option<String>,
}

/// Input for adding a sample to a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddSampleInput {
    pub notes: Option<String>,
    pub role: Option<String>,
}

/// Input for exporting a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProjectInput {
    pub output_dir: String,
    pub naming_pattern: Option<String>,
    pub copy_files: Option<bool>,
}

/// Create a new project.
#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    state: State<'_, ProjectState>,
) -> Result<Project, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.create_project(
        &input.name,
        input.description.as_deref(),
        input.bpm_target,
        input.key_target.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Get all projects.
#[tauri::command]
pub fn list_projects(state: State<'_, ProjectState>) -> Result<Vec<Project>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_projects().map_err(|e| e.to_string())
}

/// Get a project by ID.
#[tauri::command]
pub fn get_project(
    project_id: i64,
    state: State<'_, ProjectState>,
) -> Result<Option<Project>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_project(project_id).map_err(|e| e.to_string())
}

/// Update a project.
#[tauri::command]
pub fn update_project(
    project_id: i64,
    input: UpdateProjectInput,
    state: State<'_, ProjectState>,
) -> Result<Project, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.update_project(
        project_id,
        input.name.as_deref(),
        input.description.as_deref(),
        input.bpm_target,
        input.key_target.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Delete a project.
#[tauri::command]
pub fn delete_project(
    project_id: i64,
    state: State<'_, ProjectState>,
) -> Result<(), String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.delete_project(project_id).map_err(|e| e.to_string())
}

/// Get samples in a project.
#[tauri::command]
pub fn get_project_samples(
    project_id: i64,
    state: State<'_, ProjectState>,
) -> Result<Vec<ProjectSample>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_project_samples(project_id).map_err(|e| e.to_string())
}

/// Add a sample to a project.
#[tauri::command]
pub fn add_sample_to_project(
    project_id: i64,
    sample_id: i64,
    input: Option<AddSampleInput>,
    state: State<'_, ProjectState>,
) -> Result<(), String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let (notes, role) = input
        .map(|i| (i.notes, i.role))
        .unwrap_or((None, None));

    db.add_sample_to_project(project_id, sample_id, notes.as_deref(), role.as_deref())
        .map_err(|e| e.to_string())
}

/// Remove a sample from a project.
#[tauri::command]
pub fn remove_sample_from_project(
    project_id: i64,
    sample_id: i64,
    state: State<'_, ProjectState>,
) -> Result<(), String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.remove_sample_from_project(project_id, sample_id)
        .map_err(|e| e.to_string())
}

/// Update a sample's metadata within a project.
#[tauri::command]
pub fn update_project_sample(
    project_id: i64,
    sample_id: i64,
    notes: Option<String>,
    role: Option<String>,
    state: State<'_, ProjectState>,
) -> Result<(), String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.update_project_sample(project_id, sample_id, notes.as_deref(), role.as_deref())
        .map_err(|e| e.to_string())
}

/// Export a project to a directory.
#[tauri::command]
pub fn export_project_command(
    project_id: i64,
    input: ExportProjectInput,
    state: State<'_, ProjectState>,
) -> Result<Vec<String>, String> {
    let db_guard = state.get_db()?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let options = ExportOptions {
        output_dir: input.output_dir,
        naming_pattern: input.naming_pattern.unwrap_or_else(|| "{project}_{role}_{index}".to_string()),
        copy_files: input.copy_files.unwrap_or(true),
        convert_format: None,
    };

    export_project(db, project_id, &options).map_err(|e| e.to_string())
}
