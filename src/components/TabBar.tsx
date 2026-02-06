/**
 * Multi-tab bar with independent filters per tab.
 */

import { useCallback } from "react";
import type { SearchFilters } from "../api/types";

export interface Tab {
  id: string;
  label: string;
  filters: SearchFilters;
  scrollPosition: number;
  viewMode: "list" | "grid";
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
}

function getTabLabel(tab: Tab): string {
  if (tab.label) return tab.label;

  const { filters } = tab;

  if (filters.query) {
    return `\u{1F50D} ${filters.query}`;
  }

  if (filters.tags && filters.tags.length > 0) {
    return filters.tags[0];
  }

  return "All Samples";
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onNewTab,
  onCloseTab,
}: TabBarProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab]
  );

  return (
    <div className="flex items-center bg-surface border-b border-surface-border overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const label = getTabLabel(tab);

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              isActive
                ? "bg-surface-hover text-accent border-b-2 border-accent"
                : "text-gray-400 hover:text-gray-200 hover:bg-surface-hover"
            }`}
          >
            <span className="truncate max-w-[150px]">{label}</span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => handleClose(e, tab.id)}
                className="ml-1 text-gray-500 hover:text-white text-xs leading-none"
              >
                &times;
              </span>
            )}
          </button>
        );
      })}

      <button
        onClick={onNewTab}
        className="px-3 py-2 text-gray-500 hover:text-gray-200 hover:bg-surface-hover text-sm transition-colors"
        title="New tab"
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
