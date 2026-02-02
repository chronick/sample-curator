/**
 * Panel for managing projects (curated sample collections).
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { Project, ProjectSample } from "../api/types";

interface Props {
  selectedSampleIds: Set<number>;
  onSelectSample: (sampleId: number) => void;
}

export function ProjectsPanel({ selectedSampleIds, onSelectSample }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectSamples, setProjectSamples] = useState<ProjectSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New project form
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const result = await api.listProjects();
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load project samples when a project is selected
  useEffect(() => {
    if (selectedProject) {
      loadProjectSamples(selectedProject.id);
    } else {
      setProjectSamples([]);
    }
  }, [selectedProject]);

  const loadProjectSamples = async (projectId: number) => {
    try {
      const samples = await api.getProjectSamples(projectId);
      setProjectSamples(samples);
    } catch (err) {
      console.error("Failed to load project samples:", err);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const project = await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      });
      setProjects([project, ...projects]);
      setSelectedProject(project);
      setShowNewProject(false);
      setNewProjectName("");
      setNewProjectDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: number) => {
    if (!confirm("Delete this project?")) return;

    try {
      await api.deleteProject(projectId);
      setProjects(projects.filter((p) => p.id !== projectId));
      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  const handleAddSelectedSamples = async () => {
    if (!selectedProject || selectedSampleIds.size === 0) return;

    setLoading(true);

    try {
      for (const sampleId of selectedSampleIds) {
        await api.addSampleToProject(selectedProject.id, sampleId);
      }
      await loadProjectSamples(selectedProject.id);
      await loadProjects(); // Refresh sample counts
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add samples");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSample = async (sampleId: number) => {
    if (!selectedProject) return;

    try {
      await api.removeSampleFromProject(selectedProject.id, sampleId);
      setProjectSamples(projectSamples.filter((ps) => ps.sample_id !== sampleId));
      await loadProjects(); // Refresh sample counts
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove sample");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-surface-border flex items-center justify-between">
        <h3 className="font-medium">Projects</h3>
        <button
          className="text-xs px-2 py-1 bg-accent hover:bg-accent-hover rounded transition-colors"
          onClick={() => setShowNewProject(true)}
        >
          New
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-900/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* New project form */}
      {showNewProject && (
        <div className="p-3 border-b border-surface-border bg-surface space-y-2">
          <input
            type="text"
            placeholder="Project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded focus:border-accent focus:outline-none"
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded focus:border-accent focus:outline-none resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              className="flex-1 px-2 py-1 text-xs bg-accent hover:bg-accent-hover rounded transition-colors disabled:opacity-50"
              onClick={handleCreateProject}
              disabled={loading || !newProjectName.trim()}
            >
              Create
            </button>
            <button
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              onClick={() => setShowNewProject(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No projects yet. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`p-3 cursor-pointer transition-colors ${
                  selectedProject?.id === project.id
                    ? "bg-accent/20"
                    : "hover:bg-surface-hover"
                }`}
                onClick={() => setSelectedProject(project)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{project.name}</span>
                  <span className="text-xs text-gray-500">
                    {project.sample_count} samples
                  </span>
                </div>
                {project.description && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                    {project.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected project actions */}
      {selectedProject && (
        <div className="border-t border-surface-border p-3 space-y-2 bg-surface">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selectedProject.name}</span>
            <button
              className="text-xs text-red-400 hover:text-red-300"
              onClick={() => handleDeleteProject(selectedProject.id)}
            >
              Delete
            </button>
          </div>

          {selectedSampleIds.size > 0 && (
            <button
              className="w-full px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover rounded transition-colors disabled:opacity-50"
              onClick={handleAddSelectedSamples}
              disabled={loading}
            >
              Add {selectedSampleIds.size} selected sample{selectedSampleIds.size > 1 ? "s" : ""}
            </button>
          )}

          {/* Project samples */}
          {projectSamples.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto">
              <div className="text-xs text-gray-400 mb-1">Samples in project:</div>
              <div className="space-y-1">
                {projectSamples.map((ps) => (
                  <div
                    key={ps.sample_id}
                    className="flex items-center justify-between text-xs bg-gray-800 rounded px-2 py-1"
                  >
                    <button
                      className="hover:text-accent transition-colors"
                      onClick={() => onSelectSample(ps.sample_id)}
                    >
                      #{ps.sample_id}
                      {ps.role && <span className="text-gray-500 ml-1">({ps.role})</span>}
                    </button>
                    <button
                      className="text-gray-500 hover:text-red-400 transition-colors"
                      onClick={() => handleRemoveSample(ps.sample_id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
