/**
 * Panel for managing duplicate samples.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DuplicateSample {
  id: number;
  path: string;
  size_bytes: number;
  quality_score: number | null;
  created_at: string | null;
}

interface DuplicateGroup {
  fingerprint_hash: string;
  samples: DuplicateSample[];
  total_size_bytes: number;
  potential_savings_bytes: number;
}

interface DuplicateStats {
  total_groups: number;
  total_duplicates: number;
  potential_savings_bytes: number;
}

interface Props {
  onSelectSample: (sampleId: number) => void;
}

export function DuplicatesPanel({ onSelectSample }: Props) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [stats, setStats] = useState<DuplicateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DuplicateGroup | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [groupsResult, statsResult] = await Promise.all([
        invoke<DuplicateGroup[]>("get_duplicate_groups"),
        invoke<DuplicateStats>("get_duplicate_stats"),
      ]);

      setGroups(groupsResult);
      setStats(statsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDuplicates();
  }, [loadDuplicates]);

  const handleKeepSample = async (group: DuplicateGroup, keepId: number) => {
    const deleteIds = group.samples
      .filter((s) => s.id !== keepId)
      .map((s) => s.id);

    if (deleteIds.length === 0) return;

    const confirmed = confirm(
      `Delete ${deleteIds.length} duplicate(s)${deleteFiles ? " and their files" : ""}?`
    );

    if (!confirmed) return;

    try {
      await invoke("resolve_duplicate_group", {
        keep_sample_id: keepId,
        delete_sample_ids: deleteIds,
        delete_files: deleteFiles,
      });

      // Refresh list
      await loadDuplicates();
      setSelectedGroup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve duplicates");
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading duplicates...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats */}
      <div className="p-3 border-b border-surface-border bg-surface">
        <h3 className="font-medium mb-2">Duplicate Management</h3>
        {stats && (
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Duplicate groups</span>
              <span>{stats.total_groups}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total duplicates</span>
              <span>{stats.total_duplicates}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Potential savings</span>
              <span className="text-green-400">{formatBytes(stats.potential_savings_bytes)}</span>
            </div>
          </div>
        )}

        {/* Delete files toggle */}
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent"
          />
          <span className="text-xs text-gray-400">Also delete files from disk</span>
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-900/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Groups list or detail view */}
      <div className="flex-1 overflow-y-auto">
        {selectedGroup ? (
          <GroupDetail
            group={selectedGroup}
            onBack={() => setSelectedGroup(null)}
            onKeep={(id) => handleKeepSample(selectedGroup, id)}
            onSelectSample={onSelectSample}
            formatBytes={formatBytes}
          />
        ) : groups.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No duplicates found
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {groups.map((group) => (
              <button
                key={group.fingerprint_hash}
                className="w-full p-3 text-left hover:bg-surface-hover transition-colors"
                onClick={() => setSelectedGroup(group)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">
                    {group.samples.length} duplicates
                  </span>
                  <span className="text-xs text-green-400">
                    Save {formatBytes(group.potential_savings_bytes)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {group.samples[0].path.split("/").pop()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupDetail({
  group,
  onBack,
  onKeep,
  onSelectSample,
  formatBytes,
}: {
  group: DuplicateGroup;
  onBack: () => void;
  onKeep: (sampleId: number) => void;
  onSelectSample: (sampleId: number) => void;
  formatBytes: (bytes: number) => string;
}) {
  // Sort by quality score (highest first) or size if no score
  const sortedSamples = [...group.samples].sort((a, b) => {
    if (a.quality_score !== null && b.quality_score !== null) {
      return b.quality_score - a.quality_score;
    }
    return b.size_bytes - a.size_bytes;
  });

  const recommended = sortedSamples[0];

  return (
    <div className="p-3">
      <button
        className="text-xs text-accent hover:text-accent-hover mb-3 flex items-center gap-1"
        onClick={onBack}
      >
        ← Back to groups
      </button>

      <div className="text-xs text-gray-400 mb-2">
        {group.samples.length} identical samples
      </div>

      <div className="space-y-2">
        {sortedSamples.map((sample) => (
          <div
            key={sample.id}
            className={`p-2 rounded border ${
              sample.id === recommended.id
                ? "border-green-600 bg-green-900/20"
                : "border-gray-700 bg-gray-800"
            }`}
          >
            <div className="flex items-start justify-between mb-1">
              <button
                className="text-sm hover:text-accent transition-colors truncate flex-1 text-left"
                onClick={() => onSelectSample(sample.id)}
                title={sample.path}
              >
                {sample.path.split("/").pop()}
              </button>
              {sample.id === recommended.id && (
                <span className="text-xs text-green-400 ml-2">Recommended</span>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{formatBytes(sample.size_bytes)}</span>
              {sample.quality_score !== null && (
                <span>Quality: {Math.round(sample.quality_score)}</span>
              )}
            </div>

            <button
              className={`w-full mt-2 px-2 py-1 text-xs rounded transition-colors ${
                sample.id === recommended.id
                  ? "bg-green-600 hover:bg-green-500"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
              onClick={() => onKeep(sample.id)}
            >
              Keep this, delete others
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
