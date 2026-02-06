/**
 * Shows active filter pills with dismiss buttons.
 *
 * Reads the filters object and renders colored pills for each active filter.
 * Each pill has a dismiss button that calls onRemoveFilter.
 * Shows "Clear All" button when there are active filters.
 */

import type { SearchFilters } from "../api/types";

interface FilterBreadcrumbsProps {
  filters: SearchFilters;
  onRemoveFilter: (key: string, value?: string) => void;
  onClearAll: () => void;
}

interface FilterPill {
  key: string;
  label: string;
  value?: string;
}

function getActiveFilters(filters: SearchFilters): FilterPill[] {
  const pills: FilterPill[] = [];

  if (filters.min_bpm != null) {
    pills.push({ key: "min_bpm", label: `bpm: >${filters.min_bpm}` });
  }

  if (filters.max_bpm != null) {
    pills.push({ key: "max_bpm", label: `bpm: <${filters.max_bpm}` });
  }

  if (filters.min_score != null) {
    pills.push({ key: "min_score", label: `score: >${filters.min_score}` });
  }

  if (filters.max_score != null) {
    pills.push({ key: "max_score", label: `score: <${filters.max_score}` });
  }

  if (filters.pack_id != null) {
    pills.push({ key: "pack_id", label: `pack: ${filters.pack_id}` });
  }

  if (filters.tags) {
    for (const tag of filters.tags) {
      pills.push({ key: "tags", label: `tag: ${tag}`, value: tag });
    }
  }

  if (filters.query) {
    pills.push({ key: "query", label: `query: "${filters.query}"` });
  }

  return pills;
}

export function FilterBreadcrumbs({
  filters,
  onRemoveFilter,
  onClearAll,
}: FilterBreadcrumbsProps) {
  const pills = getActiveFilters(filters);

  if (pills.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((pill, index) => (
        <span
          key={`${pill.key}-${pill.value ?? index}`}
          className="bg-accent/20 text-accent border border-accent/30 rounded-full px-2 py-0.5 text-xs flex items-center gap-1"
        >
          {pill.label}
          <button
            onClick={() => onRemoveFilter(pill.key, pill.value)}
            className="hover:text-white transition-colors"
            aria-label={`Remove ${pill.label} filter`}
          >
            &times;
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-1"
      >
        Clear All
      </button>
    </div>
  );
}

export default FilterBreadcrumbs;
