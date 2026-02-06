/**
 * Collapsible sidebar tree showing packs and types with counts.
 */

import { useState } from "react";
import type { Pack } from "../api/types";
import { getTypeEmoji } from "../utils/emoji";

interface PackTreeProps {
  packs: Pack[];
  typeCounts: Array<[string, number]>;
  totalSamples: number;
  activeFilter: { type?: string; packId?: number } | null;
  onFilterByType: (sampleType: string | null) => void;
  onFilterByPack: (packId: number | null) => void;
}

function formatCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return count.toLocaleString();
}

export function PackTree({
  packs,
  typeCounts,
  totalSamples,
  activeFilter,
  onFilterByType,
  onFilterByPack,
}: PackTreeProps) {
  const [typeExpanded, setTypeExpanded] = useState(true);
  const [packExpanded, setPackExpanded] = useState(true);

  const isAllActive = !activeFilter?.type && !activeFilter?.packId;

  return (
    <div className="py-2 text-sm select-none">
      {/* All Samples */}
      <button
        onClick={() => {
          onFilterByType(null);
          onFilterByPack(null);
        }}
        className={`w-full flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-surface-hover rounded transition-colors ${
          isAllActive ? "text-accent font-medium" : "text-gray-300"
        }`}
      >
        <span>All Samples</span>
        <span className="text-xs text-gray-500">
          ({formatCount(totalSamples)})
        </span>
      </button>

      {/* By Type */}
      <div className="mt-2">
        <button
          onClick={() => setTypeExpanded(!typeExpanded)}
          className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
        >
          <span className="text-[10px]">{typeExpanded ? "\u25BC" : "\u25B6"}</span>
          <span>By Type</span>
        </button>

        {typeExpanded && (
          <div className="ml-2">
            {typeCounts.map(([type, count]) => {
              const isActive = activeFilter?.type === type;
              const emoji = getTypeEmoji(type);
              const label = type.charAt(0).toUpperCase() + type.slice(1);

              return (
                <button
                  key={type}
                  onClick={() => onFilterByType(isActive ? null : type)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-surface-hover rounded transition-colors ${
                    isActive ? "text-accent font-medium" : "text-gray-300"
                  }`}
                >
                  <span>
                    {emoji && `${emoji} `}{label}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({formatCount(count)})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* By Pack */}
      <div className="mt-2">
        <button
          onClick={() => setPackExpanded(!packExpanded)}
          className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
        >
          <span className="text-[10px]">{packExpanded ? "\u25BC" : "\u25B6"}</span>
          <span>By Pack</span>
        </button>

        {packExpanded && (
          <div className="ml-2">
            {packs.map((pack) => {
              const isActive = activeFilter?.packId === pack.id;

              return (
                <button
                  key={pack.id}
                  onClick={() => onFilterByPack(isActive ? null : pack.id)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-surface-hover rounded transition-colors ${
                    isActive ? "text-accent font-medium" : "text-gray-300"
                  }`}
                >
                  <span className="truncate mr-2">{pack.name}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    ({formatCount(pack.sample_count)})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default PackTree;
