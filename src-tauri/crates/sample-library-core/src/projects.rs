//! Project management for curated sample collections.
//!
//! Projects are named workspaces for organizing samples for specific tasks
//! (e.g., "Techno Set 2024", "Ambient Album", "Sound Design Pack").

use crate::db::Database;
use crate::error::{Error, Result};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A project (curated collection of samples).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    /// Target BPM for the project (for compatibility filtering).
    pub bpm_target: Option<f64>,
    /// Target key for the project (for compatibility filtering).
    pub key_target: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Number of samples in the project.
    pub sample_count: i64,
}

impl Project {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Project {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            bpm_target: row.get("bpm_target")?,
            key_target: row.get("key_target")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            sample_count: row.get::<_, Option<i64>>("sample_count")?.unwrap_or(0),
        })
    }
}

/// A sample within a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSample {
    pub project_id: i64,
    pub sample_id: i64,
    /// Notes about this sample's role in the project.
    pub notes: Option<String>,
    /// Role of the sample (e.g., "kick", "pad", "fx").
    pub role: Option<String>,
    pub added_at: Option<String>,
}

impl ProjectSample {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(ProjectSample {
            project_id: row.get("project_id")?,
            sample_id: row.get("sample_id")?,
            notes: row.get("notes")?,
            role: row.get("role")?,
            added_at: row.get("added_at")?,
        })
    }
}

/// Project operations extension for Database.
impl Database {
    /// Create a new project.
    pub fn create_project(
        &self,
        name: &str,
        description: Option<&str>,
        bpm_target: Option<f64>,
        key_target: Option<&str>,
    ) -> Result<Project> {
        self.connection().execute(
            r#"
            INSERT INTO projects (name, description, bpm_target, key_target, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            "#,
            params![name, description, bpm_target, key_target],
        )?;

        let id = self.connection().last_insert_rowid();
        self.get_project(id)?
            .ok_or(Error::ProjectNotFound(id))
    }

    /// Get a project by ID.
    pub fn get_project(&self, id: i64) -> Result<Option<Project>> {
        let project = self
            .connection()
            .query_row(
                r#"
                SELECT p.*, COUNT(ps.sample_id) as sample_count
                FROM projects p
                LEFT JOIN project_samples ps ON p.id = ps.project_id
                WHERE p.id = ?1
                GROUP BY p.id
                "#,
                [id],
                Project::from_row,
            )
            .optional()?;
        Ok(project)
    }

    /// Get a project by name.
    pub fn get_project_by_name(&self, name: &str) -> Result<Option<Project>> {
        let project = self
            .connection()
            .query_row(
                r#"
                SELECT p.*, COUNT(ps.sample_id) as sample_count
                FROM projects p
                LEFT JOIN project_samples ps ON p.id = ps.project_id
                WHERE p.name = ?1
                GROUP BY p.id
                "#,
                [name],
                Project::from_row,
            )
            .optional()?;
        Ok(project)
    }

    /// Get all projects.
    pub fn get_projects(&self) -> Result<Vec<Project>> {
        let mut stmt = self.connection().prepare(
            r#"
            SELECT p.*, COUNT(ps.sample_id) as sample_count
            FROM projects p
            LEFT JOIN project_samples ps ON p.id = ps.project_id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            "#,
        )?;

        let projects = stmt
            .query_map([], Project::from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(projects)
    }

    /// Update a project.
    pub fn update_project(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<&str>,
        bpm_target: Option<f64>,
        key_target: Option<&str>,
    ) -> Result<Project> {
        // Build dynamic UPDATE query
        let mut updates = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(n) = name {
            updates.push("name = ?");
            params.push(Box::new(n.to_string()));
        }
        if let Some(d) = description {
            updates.push("description = ?");
            params.push(Box::new(d.to_string()));
        }
        if let Some(b) = bpm_target {
            updates.push("bpm_target = ?");
            params.push(Box::new(b));
        }
        if let Some(k) = key_target {
            updates.push("key_target = ?");
            params.push(Box::new(k.to_string()));
        }

        if updates.is_empty() {
            return self.get_project(id)?.ok_or(Error::ProjectNotFound(id));
        }

        updates.push("updated_at = CURRENT_TIMESTAMP");

        let sql = format!(
            "UPDATE projects SET {} WHERE id = ?",
            updates.join(", ")
        );
        params.push(Box::new(id));

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        self.connection().execute(&sql, params_refs.as_slice())?;

        self.get_project(id)?.ok_or(Error::ProjectNotFound(id))
    }

    /// Delete a project.
    pub fn delete_project(&self, id: i64) -> Result<()> {
        self.connection()
            .execute("DELETE FROM projects WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Add a sample to a project.
    pub fn add_sample_to_project(
        &self,
        project_id: i64,
        sample_id: i64,
        notes: Option<&str>,
        role: Option<&str>,
    ) -> Result<()> {
        self.connection().execute(
            r#"
            INSERT OR REPLACE INTO project_samples (project_id, sample_id, notes, role, added_at)
            VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
            "#,
            params![project_id, sample_id, notes, role],
        )?;

        // Update project timestamp
        self.connection().execute(
            "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [project_id],
        )?;

        Ok(())
    }

    /// Remove a sample from a project.
    pub fn remove_sample_from_project(&self, project_id: i64, sample_id: i64) -> Result<()> {
        self.connection().execute(
            "DELETE FROM project_samples WHERE project_id = ?1 AND sample_id = ?2",
            params![project_id, sample_id],
        )?;

        // Update project timestamp
        self.connection().execute(
            "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [project_id],
        )?;

        Ok(())
    }

    /// Get all samples in a project.
    pub fn get_project_samples(&self, project_id: i64) -> Result<Vec<ProjectSample>> {
        let mut stmt = self.connection().prepare(
            r#"
            SELECT * FROM project_samples
            WHERE project_id = ?1
            ORDER BY added_at DESC
            "#,
        )?;

        let samples = stmt
            .query_map([project_id], ProjectSample::from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(samples)
    }

    /// Update a sample's metadata within a project.
    pub fn update_project_sample(
        &self,
        project_id: i64,
        sample_id: i64,
        notes: Option<&str>,
        role: Option<&str>,
    ) -> Result<()> {
        self.connection().execute(
            r#"
            UPDATE project_samples
            SET notes = COALESCE(?3, notes), role = COALESCE(?4, role)
            WHERE project_id = ?1 AND sample_id = ?2
            "#,
            params![project_id, sample_id, notes, role],
        )?;
        Ok(())
    }

    /// Check if a sample is in a project.
    pub fn is_sample_in_project(&self, project_id: i64, sample_id: i64) -> Result<bool> {
        let exists: bool = self.connection().query_row(
            "SELECT COUNT(*) > 0 FROM project_samples WHERE project_id = ?1 AND sample_id = ?2",
            params![project_id, sample_id],
            |row| row.get(0),
        )?;
        Ok(exists)
    }
}

/// Export options for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    /// Output directory.
    pub output_dir: String,
    /// Naming pattern. Available variables: {project}, {category}, {role}, {index}, {original}
    pub naming_pattern: String,
    /// Whether to copy files (true) or create symlinks (false).
    pub copy_files: bool,
    /// File format to convert to (None = keep original).
    pub convert_format: Option<String>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            output_dir: ".".to_string(),
            naming_pattern: "{project}_{role}_{index}".to_string(),
            copy_files: true,
            convert_format: None,
        }
    }
}

/// Export a project to a directory.
pub fn export_project(
    db: &Database,
    project_id: i64,
    options: &ExportOptions,
) -> Result<Vec<String>> {
    let project = db
        .get_project(project_id)?
        .ok_or(Error::ProjectNotFound(project_id))?;

    let project_samples = db.get_project_samples(project_id)?;

    let output_dir = Path::new(&options.output_dir);
    if !output_dir.exists() {
        std::fs::create_dir_all(output_dir)?;
    }

    let mut exported_paths = Vec::new();
    let mut role_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for ps in project_samples {
        let sample = match db.get_sample(ps.sample_id)? {
            Some(s) => s,
            None => continue,
        };

        let role = ps.role.as_deref().unwrap_or("sample");
        let index = role_counts.entry(role.to_string()).or_insert(0);
        *index += 1;

        // Build output filename
        let original_name = Path::new(&sample.path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("sample");

        let ext = Path::new(&sample.path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("wav");

        let new_name = options
            .naming_pattern
            .replace("{project}", &project.name)
            .replace("{category}", sample.sample_type.as_deref().unwrap_or("unknown"))
            .replace("{role}", role)
            .replace("{index}", &index.to_string())
            .replace("{original}", original_name);

        let output_path = output_dir.join(format!("{}.{}", new_name, ext));

        // Copy or symlink
        if options.copy_files {
            std::fs::copy(&sample.path, &output_path)?;
        } else {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&sample.path, &output_path)?;

            #[cfg(not(unix))]
            std::fs::copy(&sample.path, &output_path)?;
        }

        exported_paths.push(output_path.to_string_lossy().to_string());
    }

    Ok(exported_paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_crud() {
        let db = Database::open_in_memory().unwrap();

        // Create project
        let project = db
            .create_project(
                "Test Project",
                Some("A test project"),
                Some(128.0),
                Some("Am"),
            )
            .unwrap();

        assert_eq!(project.name, "Test Project");
        assert_eq!(project.bpm_target, Some(128.0));

        // Get project
        let fetched = db.get_project(project.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Test Project");

        // Update project
        let updated = db
            .update_project(project.id, Some("Renamed Project"), None, None, None)
            .unwrap();
        assert_eq!(updated.name, "Renamed Project");

        // Delete project
        db.delete_project(project.id).unwrap();
        assert!(db.get_project(project.id).unwrap().is_none());
    }

    #[test]
    fn test_project_samples() {
        let db = Database::open_in_memory().unwrap();

        // Create project
        let project = db
            .create_project("Test Project", None, None, None)
            .unwrap();

        // Create a sample
        db.connection()
            .execute(
                "INSERT INTO samples (path, source_type) VALUES ('test.wav', 'imported')",
                [],
            )
            .unwrap();
        let sample_id = 1;

        // Add sample to project
        db.add_sample_to_project(project.id, sample_id, Some("Main kick"), Some("kick"))
            .unwrap();

        // Check sample is in project
        assert!(db.is_sample_in_project(project.id, sample_id).unwrap());

        // Get project samples
        let samples = db.get_project_samples(project.id).unwrap();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].notes, Some("Main kick".to_string()));

        // Remove sample
        db.remove_sample_from_project(project.id, sample_id)
            .unwrap();
        assert!(!db.is_sample_in_project(project.id, sample_id).unwrap());
    }
}
