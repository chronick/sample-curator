/**
 * Tag editor component with batch operations.
 */

import { useState } from "react";
import type { Sample } from "../api/types";
import { api } from "../api";
import { useStore } from "../store";
import { ScoreIndicator } from "./ScoreIndicator";

interface TagEditorProps {
  sample: Sample;
  selectedCount: number;
  onUpdate: () => void;
}

export function TagEditor({ sample, selectedCount, onUpdate }: TagEditorProps) {
  const { allTags, selectedIds } = useStore();
  const [tagInput, setTagInput] = useState("");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Add tag to sample
  const handleAddTag = async (tag: string) => {
    if (!tag.trim()) return;

    setLoading(true);
    try {
      if (selectedCount > 1) {
        // Batch add
        await api.batchAddTags(Array.from(selectedIds), [tag.trim()]);
      } else {
        await api.addTags(sample.id, [tag.trim()]);
      }
      onUpdate();
    } catch (err) {
      console.error("Failed to add tag:", err);
    } finally {
      setLoading(false);
      setTagInput("");
    }
  };

  // Remove tag from sample
  const handleRemoveTag = async (tag: string) => {
    setLoading(true);
    try {
      await api.removeTags(sample.id, [tag]);
      onUpdate();
    } catch (err) {
      console.error("Failed to remove tag:", err);
    } finally {
      setLoading(false);
    }
  };

  // Re-analyze sample
  const handleReanalyze = async () => {
    setAnalyzing(true);
    try {
      await api.analyzeSample(sample.id);
      onUpdate();
    } catch (err) {
      console.error("Failed to analyze sample:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  // Delete sample(s)
  const handleDelete = async () => {
    setLoading(true);
    try {
      if (selectedCount > 1) {
        await api.batchDelete(Array.from(selectedIds));
      } else {
        await api.deleteSample(sample.id);
      }
      onUpdate();
    } catch (err) {
      console.error("Failed to delete:", err);
    } finally {
      setLoading(false);
      setShowConfirmDelete(false);
    }
  };

  // Filtered tag suggestions
  const filteredTags = allTags.filter(
    (tag) =>
      tag.toLowerCase().includes(tagInput.toLowerCase()) &&
      !sample.tags.includes(tag)
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-medium">
          {selectedCount > 1
            ? `${selectedCount} samples selected`
            : "Sample Details"}
        </h3>
      </div>

      {/* Score summary */}
      {selectedCount <= 1 && (
        <div className="mb-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Quality</span>
            <ScoreIndicator score={sample.quality_score} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Applicability</span>
            <ScoreIndicator score={sample.applicability_score} />
          </div>
          <button
            onClick={handleReanalyze}
            disabled={analyzing}
            className="w-full mt-2 px-2 py-1 bg-surface hover:bg-surface-hover border border-surface-border rounded text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {analyzing ? "Analyzing..." : "Re-analyze"}
          </button>
        </div>
      )}

      {/* Tags */}
      <div className="flex-1 overflow-hidden">
        <label className="block text-xs font-medium text-gray-400 mb-2">
          Tags
        </label>

        {/* Current tags */}
        {selectedCount <= 1 && (sample.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {(sample.tags || []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface border border-surface-border rounded text-xs"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="text-gray-500 hover:text-white"
                  disabled={loading}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Tag input */}
        <div className="relative">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput) {
                handleAddTag(tagInput);
              }
            }}
            placeholder={
              selectedCount > 1
                ? "Add tag to selected..."
                : "Add tag..."
            }
            className="w-full px-2 py-1 bg-surface border border-surface-border rounded text-sm focus:outline-none focus:border-accent"
            disabled={loading}
          />

          {/* Suggestions dropdown */}
          {tagInput && filteredTags.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-surface-border rounded shadow-lg max-h-24 overflow-y-auto">
              {filteredTags.slice(0, 5).map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleAddTag(tag)}
                  className="w-full px-2 py-1 text-left text-xs hover:bg-surface-hover"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 pt-3 border-t border-surface-border">
        {showConfirmDelete ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              Delete {selectedCount > 1 ? `${selectedCount} samples` : "sample"}?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 px-2 py-1 bg-surface hover:bg-surface-hover border border-surface-border rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs font-medium transition-colors"
                disabled={loading}
              >
                {loading ? "..." : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmDelete(true)}
            className="w-full px-2 py-1 bg-surface hover:bg-red-900/30 border border-surface-border hover:border-red-600 rounded text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            Delete {selectedCount > 1 ? "Selected" : "Sample"}
          </button>
        )}
      </div>
    </div>
  );
}

export default TagEditor;
