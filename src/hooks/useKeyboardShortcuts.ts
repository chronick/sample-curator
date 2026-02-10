import { useEffect } from "react";
import type { Sample, ViewMode } from "../api/types";
import type { Tab } from "../components/TabBar";

const VIEW_MODE_CYCLE: ViewMode[] = ["list", "grid", "constellation", "radar", "colorwheel"];

function isExploreMode(mode: ViewMode): boolean {
  return mode === "constellation" || mode === "radar" || mode === "colorwheel";
}

interface KeyboardShortcutsConfig {
  // State
  selectedSample: Sample | null;
  samples: Sample[];
  isPlaying: boolean;
  currentSample: string | null;
  viewMode: ViewMode;
  tabs: Tab[];
  activeTabId: string;
  activeView: "browse" | "jobs";

  // Actions
  play: (path: string) => void;
  pause: () => void;
  resume: () => void;
  selectSample: (sample: Sample) => void;
  refresh: () => void;
  setViewMode: (mode: ViewMode) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Panel toggles
  setShowLeft: (fn: (v: boolean) => boolean) => void;
  setShowRight: (fn: (v: boolean) => boolean) => void;
  setShowPlayer: (fn: (v: boolean) => boolean) => void;
  setShowImport: (v: boolean) => void;
  setRightPanelMode: (mode: "details" | "similar" | "projects" | "duplicates") => void;
  setActiveView: (view: "browse" | "jobs") => void;
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Panel toggle shortcuts (Cmd/Ctrl combos)
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        config.setShowLeft((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j" && !e.shiftKey) {
        e.preventDefault();
        config.setShowPlayer((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && e.shiftKey) {
        e.preventDefault();
        config.setShowRight((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j" && e.shiftKey) {
        e.preventDefault();
        config.setActiveView(config.activeView === "jobs" ? "browse" : "jobs");
        return;
      }

      switch (e.key) {
        case " ": // Space - Play/Pause
          e.preventDefault();
          if (config.selectedSample) {
            if (config.isPlaying && config.currentSample === config.selectedSample.path) {
              config.pause();
            } else if (config.currentSample === config.selectedSample.path) {
              config.resume();
            } else {
              config.play(config.selectedSample.path);
            }
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (config.samples.length > 0) {
            const currentIndex = config.selectedSample
              ? config.samples.findIndex((s) => s.id === config.selectedSample!.id)
              : -1;
            const nextIndex = Math.min(currentIndex + 1, config.samples.length - 1);
            config.selectSample(config.samples[nextIndex]);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (config.samples.length > 0) {
            const currentIndex = config.selectedSample
              ? config.samples.findIndex((s) => s.id === config.selectedSample!.id)
              : 1;
            const prevIndex = Math.max(currentIndex - 1, 0);
            config.selectSample(config.samples[prevIndex]);
          }
          break;

        case "s":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            config.setRightPanelMode("similar");
          }
          break;

        case "c":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            config.setRightPanelMode("similar");
          }
          break;

        case "p":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            config.setRightPanelMode("projects");
          }
          break;

        case "d":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            config.setRightPanelMode("duplicates");
          }
          break;

        case "f":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
          }
          break;

        case "i":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            config.setShowImport(true);
          }
          break;

        case "r":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            config.refresh();
          }
          break;

        case "t":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            config.addTab();
          }
          break;

        case "w":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            config.closeTab(config.activeTabId);
          }
          break;

        case "g":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (isExploreMode(config.viewMode)) {
              config.setViewMode("list");
            } else {
              config.setViewMode(config.viewMode === "list" ? "grid" : "list");
            }
          }
          break;

        case "v":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const currentIdx = VIEW_MODE_CYCLE.indexOf(config.viewMode);
            const nextIdx = (currentIdx + 1) % VIEW_MODE_CYCLE.length;
            config.setViewMode(VIEW_MODE_CYCLE[nextIdx]);
          }
          break;

        case "Escape":
          if (isExploreMode(config.viewMode)) {
            e.preventDefault();
            config.setViewMode("list");
          }
          break;
      }

      // Tab switching with Cmd+1-9
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < config.tabs.length) {
          config.setActiveTab(config.tabs[tabIndex].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [config]);
}
