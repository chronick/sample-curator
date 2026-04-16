/**
 * Quick sort + preset buttons for the Browse view toolbar.
 *
 * - "Recent" preset: clears tag filters, sorts by created_at desc, scrolls to top.
 *   The one-click path from "I just recorded something" → "see it at the top".
 * - Sort menu: small dropdown exposing the handful of sort fields that make
 *   sense for the whole library (Created, Name, Duration, BPM, Score).
 *   Column-header clicks still work for power users; this is for discoverability.
 */

import { useState, useRef, useEffect } from "react";

const SORT_OPTIONS: Array<{ field: string; label: string; defaultDir: "asc" | "desc" }> = [
  { field: "created_at", label: "Created (newest)", defaultDir: "desc" },
  { field: "path", label: "Name (A-Z)", defaultDir: "asc" },
  { field: "duration", label: "Duration", defaultDir: "desc" },
  { field: "bpm", label: "BPM", defaultDir: "asc" },
  { field: "applicability_score", label: "Score", defaultDir: "desc" },
];

interface Props {
  sortField: string;
  sortDirection: "asc" | "desc";
  onSort: (field: string, direction: "asc" | "desc") => void;
  /**
   * Applies the Recent preset: clears filters + sorts by created_at desc.
   * Implementation lives in the parent so it can reach both setFilters and
   * setSort without threading extra props through the dropdown.
   */
  onApplyRecent: () => void;
}

export function BrowseQuickActions({ sortField, sortDirection, onSort, onApplyRecent }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the menu when clicking anywhere outside.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const currentLabel =
    SORT_OPTIONS.find((o) => o.field === sortField)?.label ??
    `Sort: ${sortField}`;

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <button
        onClick={onApplyRecent}
        className="px-2.5 py-1 text-xs rounded border border-surface-border bg-surface-raised text-gray-300 hover:bg-surface-hover hover:text-white transition-colors"
        title="Sort by most recently created and clear filters"
        data-testid="browse-recent-button"
      >
        Recent
      </button>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="px-2.5 py-1 text-xs rounded border border-surface-border bg-surface-raised text-gray-300 hover:bg-surface-hover hover:text-white transition-colors min-w-[140px] text-left flex items-center justify-between gap-2"
          data-testid="browse-sort-button"
        >
          <span className="truncate">{currentLabel}</span>
          <span className="text-gray-500">
            {sortDirection === "asc" ? "\u2191" : "\u2193"}
          </span>
        </button>
        {menuOpen && (
          <div
            className="absolute z-20 mt-1 right-0 w-48 rounded border border-surface-border bg-surface-raised shadow-lg py-1"
            data-testid="browse-sort-menu"
          >
            {SORT_OPTIONS.map((opt) => {
              const active = sortField === opt.field;
              return (
                <button
                  key={opt.field}
                  onClick={() => {
                    // Toggle direction when re-picking the active field;
                    // otherwise apply the option's default direction so the
                    // first click lands on the sensible order (newest first,
                    // A-Z for Name, etc.).
                    const nextDir: "asc" | "desc" = active
                      ? sortDirection === "asc"
                        ? "desc"
                        : "asc"
                      : opt.defaultDir;
                    onSort(opt.field, nextDir);
                    setMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors ${
                    active ? "text-accent" : "text-gray-300"
                  }`}
                >
                  <span>{opt.label}</span>
                  {active && (
                    <span className="ml-2 text-gray-500">
                      {sortDirection === "asc" ? "\u2191" : "\u2193"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
