import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { DirectoryEntry } from "../api/types";

interface FileBrowserProps {
  onSelectSample: (sampleId: number) => void;
  onPlayFile: (path: string) => void;
}

interface TreeNode {
  path: string;
  name: string;
  isExpanded: boolean;
  children: DirectoryEntry[] | null; // null = not loaded yet
}

export function FileBrowser({ onSelectSample, onPlayFile }: FileBrowserProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Map<string, DirectoryEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  // Load browse roots on mount
  useEffect(() => {
    api.getBrowseRoots().then((paths) => {
      setRoots(
        paths.map((p) => ({
          path: p,
          name: p.split("/").pop() || p,
          isExpanded: false,
          children: null,
        }))
      );
    }).catch((err) => console.error("Failed to load browse roots:", err));
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/api/dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        const name = selected.split("/").pop() || selected;
        setRoots((prev) => {
          if (prev.some((r) => r.path === selected)) return prev;
          return [...prev, { path: selected, name, isExpanded: false, children: null }];
        });
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, []);

  const toggleExpand = useCallback(async (path: string) => {
    if (expandedPaths.has(path)) {
      // Collapse
      setExpandedPaths((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      return;
    }

    // Expand - load children
    setLoading((prev) => new Set(prev).add(path));
    try {
      const entries = await api.listDirectory(path);
      setExpandedPaths((prev) => new Map(prev).set(path, entries));
    } catch (err) {
      console.error("Failed to list directory:", err);
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [expandedPaths]);

  const handleFileClick = useCallback((entry: DirectoryEntry) => {
    if (entry.sample_id) {
      onSelectSample(entry.sample_id);
    } else {
      onPlayFile(entry.path);
    }
  }, [onSelectSample, onPlayFile]);

  const renderDirectory = (path: string, depth: number = 0) => {
    const children = expandedPaths.get(path);

    if (!children) return null;

    return children.map((entry) => {
      if (entry.is_directory) {
        const childExpanded = expandedPaths.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              className="w-full flex items-center gap-1 px-2 py-1 text-xs hover:bg-surface-hover transition-colors text-left"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              onClick={() => toggleExpand(entry.path)}
            >
              <span className="text-gray-500 w-3 text-center shrink-0">
                {loading.has(entry.path) ? "..." : childExpanded ? "\u25BE" : "\u25B8"}
              </span>
              <span className="text-yellow-500 shrink-0">&#128193;</span>
              <span className="truncate">{entry.name}</span>
            </button>
            {childExpanded && renderDirectory(entry.path, depth + 1)}
          </div>
        );
      } else {
        return (
          <button
            key={entry.path}
            className={`w-full flex items-center gap-1 px-2 py-1 text-xs hover:bg-surface-hover transition-colors text-left ${
              entry.sample_id ? "text-gray-300" : "text-gray-500"
            }`}
            style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            onClick={() => handleFileClick(entry)}
            onDoubleClick={() => onPlayFile(entry.path)}
          >
            <span className="w-3 shrink-0" />
            <span className="shrink-0">{entry.sample_id ? "\u266B" : "\u266A"}</span>
            <span className="truncate">{entry.name}</span>
          </button>
        );
      }
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <span className="text-xs font-medium text-gray-400 uppercase">Files</span>
        <button
          onClick={handleOpenFolder}
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          Open Folder
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {roots.length === 0 ? (
          <div className="p-4 text-xs text-gray-500 text-center">
            <p>No directories configured.</p>
            <p className="mt-1">Add watch directories in Settings or click "Open Folder".</p>
          </div>
        ) : (
          roots.map((root) => {
            const isExpanded = expandedPaths.has(root.path);
            return (
              <div key={root.path}>
                <button
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors text-left"
                  onClick={() => toggleExpand(root.path)}
                >
                  <span className="text-gray-500 w-3 text-center shrink-0">
                    {loading.has(root.path) ? "..." : isExpanded ? "\u25BE" : "\u25B8"}
                  </span>
                  <span className="text-yellow-500 shrink-0">&#128193;</span>
                  <span className="truncate">{root.name}</span>
                </button>
                {isExpanded && renderDirectory(root.path)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default FileBrowser;
