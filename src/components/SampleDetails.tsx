import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { Sample } from "../api/types";
import { AcousticBadges } from "./AcousticBadges";
import { MiniRadar } from "./RadarComparator";
import { derivePerceptualAttributes, getAnalysisCoverage, getCategoryColor } from "../utils/perceptualAttributes";

export function SampleDetails({ sample, acousticTags, onUpdate }: { sample: Sample; acousticTags: string[]; onUpdate: (sample: Sample) => void }) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newTag, setNewTag] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Load all tags for autocomplete
  useEffect(() => {
    api.listTags().then(setAllTags).catch(() => {});
  }, []);

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const saveEdit = async () => {
    if (!editingField) return;
    try {
      const updates: Partial<Sample> = {};
      switch (editingField) {
        case "bpm":
          updates.bpm = editValue ? parseFloat(editValue) : null;
          break;
        case "key":
          updates.key = editValue || null;
          break;
      }
      const updated = await api.updateSample(sample.id, updates);
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to update sample:", err);
    }
    setEditingField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleAddTag = async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag || (sample.tags || []).includes(tag)) {
      setNewTag("");
      return;
    }
    try {
      const updated = await api.addTags(sample.id, [tag]);
      onUpdate(updated);
      setNewTag("");
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    try {
      const updated = await api.removeTags(sample.id, [tag]);
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  const handleTagInputChange = (value: string) => {
    setNewTag(value);
    if (value.length > 0) {
      const filtered = allTags
        .filter((t) => t.toLowerCase().startsWith(value.toLowerCase()))
        .filter((t) => !(sample.tags || []).includes(t))
        .slice(0, 5);
      setTagSuggestions(filtered);
    } else {
      setTagSuggestions([]);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (tagSuggestions.length > 0) {
        setNewTag(tagSuggestions[0]);
        setTagSuggestions([]);
        // Add it directly
        const tag = tagSuggestions[0].trim().toLowerCase();
        if (tag && !(sample.tags || []).includes(tag)) {
          api.addTags(sample.id, [tag]).then(onUpdate).catch(console.error);
          setNewTag("");
        }
      } else {
        handleAddTag();
      }
    } else if (e.key === "Escape") {
      setNewTag("");
      setTagSuggestions([]);
    }
  };

  const renderEditableField = (label: string, field: string, value: string | number | null, suffix?: string) => {
    const displayValue = value !== null && value !== undefined ? String(value) : "";
    const isEditing = editingField === field;

    return (
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              type={field === "bpm" ? "number" : "text"}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={saveEdit}
              autoFocus
              className="w-full px-1 py-0.5 text-sm bg-surface border border-accent rounded focus:outline-none"
            />
          </div>
        ) : (
          <div
            className="text-sm cursor-pointer hover:text-accent transition-colors group"
            onClick={() => startEdit(field, displayValue)}
            title="Click to edit"
          >
            {displayValue ? `${field === "bpm" ? Math.round(Number(displayValue)) : displayValue}${suffix || ""}` : "-"}
            <span className="ml-1 opacity-0 group-hover:opacity-50 text-xs">&#9998;</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <div className="text-xs text-gray-400 mb-1">File</div>
        <div className="text-sm truncate" title={sample.path}>
          {sample.path.split("/").pop()}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {renderEditableField("BPM", "bpm", sample.bpm)}
        {renderEditableField("Key", "key", sample.key)}
        {sample.duration && (
          <div>
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{sample.duration.toFixed(2)}s</div>
          </div>
        )}
      </div>

      {/* Mini radar (perceptual profile) */}
      {getAnalysisCoverage(sample) > 0.3 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Perceptual Profile</div>
          <div className="flex justify-center">
            <MiniRadar
              attrs={derivePerceptualAttributes(sample)}
              color={getCategoryColor(sample.sample_type)}
              size={120}
              showLabels={true}
              highlight={false}
              unanalyzed={getAnalysisCoverage(sample) < 0.5}
            />
          </div>
        </div>
      )}

      {/* Acoustic badges */}
      {acousticTags.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Acoustic</div>
          <AcousticBadges tags={acousticTags} />
        </div>
      )}

      {/* Quality metrics */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Quality</div>
        <div className="space-y-1 text-xs">
          {sample.quality_score !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Quality Score</span>
              <span>{Math.round(sample.quality_score)}</span>
            </div>
          )}
          {sample.rms_db !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">RMS</span>
              <span>{sample.rms_db.toFixed(1)} dB</span>
            </div>
          )}
          {sample.crest_factor !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Crest Factor</span>
              <span>{sample.crest_factor.toFixed(1)} dB</span>
            </div>
          )}
        </div>
      </div>

      {/* Spectral */}
      {sample.spectral_centroid !== null && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Spectral</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Centroid</span>
              <span>{Math.round(sample.spectral_centroid)} Hz</span>
            </div>
            {sample.spectral_flatness !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Flatness</span>
                <span>{(sample.spectral_flatness * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editable Tags */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Tags</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {(sample.tags || []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-700 rounded group"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={newTag}
            onChange={(e) => handleTagInputChange(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="Add tag..."
            className="w-full px-2 py-1 text-xs bg-surface border border-surface-border rounded focus:outline-none focus:border-accent"
          />
          {tagSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-surface-border rounded shadow-lg">
              {tagSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="w-full px-2 py-1 text-xs text-left hover:bg-surface-hover"
                  onClick={() => {
                    const tag = suggestion.trim().toLowerCase();
                    if (tag && !(sample.tags || []).includes(tag)) {
                      api.addTags(sample.id, [tag]).then(onUpdate).catch(console.error);
                    }
                    setNewTag("");
                    setTagSuggestions([]);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
