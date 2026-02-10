import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import type { DirectoryEntry } from "../api/types";
import { parseQuery } from "./QueryBar";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchPaths, setSearchMatchPaths] = useState<Set<string> | null>(null);

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

  // Structured search: detect field:value syntax and search API
  useEffect(() => {
    if (!searchQuery || !searchQuery.includes(":")) {
      setSearchMatchPaths(null);
      return;
    }

    const parsed = parseQuery(searchQuery);
    // Only trigger API search if parseQuery found structured filters
    const hasStructured = parsed.tags?.length || parsed.min_bpm != null || parsed.max_bpm != null ||
                          parsed.min_score != null || parsed.pack_id != null;
    if (!hasStructured) {
      setSearchMatchPaths(null);
      return;
    }

    let cancelled = false;
    api.search({ ...parsed, limit: 200, offset: 0 }).then((result) => {
      if (cancelled) return;
      // Build ancestor path set from matching sample paths
      const paths = new Set<string>();
      for (const sample of result.samples) {
        const parts = sample.path.split("/");
        // Add the full path and all ancestor directories
        let current = "";
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          paths.add(current);
        }
        // Also add with leading slash for absolute paths
        paths.add(sample.path);
      }
      setSearchMatchPaths(paths);
    }).catch(() => {
      if (!cancelled) setSearchMatchPaths(null);
    });

    return () => { cancelled = true; };
  }, [searchQuery]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
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

  const hasMatchingDescendants = useCallback((dirPath: string, query: string): boolean => {
    const children = expandedPaths.get(dirPath);
    if (!children) return true; // Not loaded yet, show it so user can expand
    return children.some((entry) => {
      if (entry.is_directory) return hasMatchingDescendants(entry.path, query);
      return entry.name.toLowerCase().includes(query);
    });
  }, [expandedPaths]);

  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    if (searchMatchPaths !== null) {
      // Count files only (not directories) that match the API search results
      let count = 0;
      for (const entries of expandedPaths.values()) {
        count += entries.filter(e => !e.is_directory && searchMatchPaths.has(e.path)).length;
      }
      return count;
    }
    const query = searchQuery.toLowerCase();
    let count = 0;
    for (const entries of expandedPaths.values()) {
      count += entries.filter(e => !e.is_directory && e.name.toLowerCase().includes(query)).length;
    }
    return count;
  }, [searchQuery, expandedPaths, searchMatchPaths]);

  const renderDirectory = (path: string, depth: number = 0) => {
    const children = expandedPaths.get(path);

    if (!children) return null;

    const query = searchQuery.toLowerCase();
    const filteredChildren = searchQuery
      ? children.filter((entry) => {
          if (searchMatchPaths !== null) {
            // API search mode: filter by matching paths
            return searchMatchPaths.has(entry.path);
          }
          // Filename filter mode
          if (entry.is_directory) {
            return hasMatchingDescendants(entry.path, query);
          }
          return entry.name.toLowerCase().includes(query);
        })
      : children;

    return filteredChildren.map((entry) => {
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
      {/* Search input */}
      <div className="px-2 py-1.5 border-b border-surface-border">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-7 pr-7 py-1 bg-surface-raised border border-surface-border rounded text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-accent"
          />
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
            >
              &times;
            </button>
          )}
        </div>
      </div>
      {searchQuery && (
        <div className="px-3 py-1 text-[10px] text-gray-500">
          {matchCount} {matchCount === 1 ? "match" : "matches"}
        </div>
      )}
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
