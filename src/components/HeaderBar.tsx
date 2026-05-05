import type { OllamaStatusDict } from "../types/ollama";

type ActiveView = "browse" | "jobs" | "record" | "sessions";

interface HeaderBarProps {
  activeView: ActiveView;
  showLeft: boolean;
  showRight: boolean;
  showPlayer: boolean;
  llmStatus: OllamaStatusDict;
  appVersion?: string;
  onSetActiveView: (view: ActiveView) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onTogglePlayer: () => void;
  onShowSettings: () => void;
  onShowImport: () => void;
  onRefresh: () => void;
}

function llmDotClass(state: OllamaStatusDict["state"]): string {
  switch (state) {
    case "loaded":
      return "bg-green-500";
    case "loading":
      return "bg-yellow-400 animate-pulse";
    case "errored":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

function llmTooltip(status: OllamaStatusDict): string {
  switch (status.state) {
    case "loaded":
      return `LLM ready: ${status.model}`;
    case "loading":
      return `LLM loading: ${status.model ?? "detecting"}…`;
    case "errored":
      return `LLM error: ${status.error ?? "unknown"}`;
    default:
      return "LLM not loaded — click Settings to configure";
  }
}

export function HeaderBar({
  activeView,
  showLeft,
  showRight,
  showPlayer,
  llmStatus,
  appVersion,
  onSetActiveView,
  onToggleLeft,
  onToggleRight,
  onTogglePlayer,
  onShowSettings,
  onShowImport,
  onRefresh,
}: HeaderBarProps) {
  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-surface-border bg-surface-raised">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">
          Sample Curator
          {appVersion && (
            <span
              className="ml-2 text-xs font-normal text-gray-500 tabular-nums"
              data-testid="app-version"
            >
              v{appVersion}
            </span>
          )}
        </h1>
        {/* Top-level view tabs */}
        <div className="flex items-center border border-surface-border rounded overflow-hidden ml-2">
          <button
            onClick={() => onSetActiveView("record")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeView === "record"
                ? "bg-accent/20 text-accent"
                : "hover:bg-surface-hover text-gray-400"
            }`}
          >
            Record
          </button>
          <button
            onClick={() => onSetActiveView("browse")}
            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-surface-border ${
              activeView === "browse"
                ? "bg-accent/20 text-accent"
                : "hover:bg-surface-hover text-gray-400"
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => onSetActiveView("sessions")}
            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-surface-border ${
              activeView === "sessions"
                ? "bg-accent/20 text-accent"
                : "hover:bg-surface-hover text-gray-400"
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => onSetActiveView("jobs")}
            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-surface-border ${
              activeView === "jobs"
                ? "bg-accent/20 text-accent"
                : "hover:bg-surface-hover text-gray-400"
            }`}
          >
            Jobs
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`w-3 h-3 rounded-full flex-shrink-0 ${llmDotClass(llmStatus.state)}`}
          title={llmTooltip(llmStatus)}
          data-testid="llm-status-dot"
        />
        {/* Settings */}
        <button
          onClick={onShowSettings}
          className="px-2 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        {activeView !== "record" && <>
        {/* Toggle left sidebar */}
        <button
          onClick={onToggleLeft}
          className={`px-2 py-1.5 border rounded text-sm transition-colors ${
            showLeft
              ? "bg-accent/20 border-accent text-accent"
              : "bg-surface hover:bg-surface-hover border-surface-border text-gray-500"
          }`}
          title={`Toggle left sidebar (${navigator.platform.includes("Mac") ? "\u2318" : "Ctrl+"}B)`}
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="1" width="5" height="14" rx="1" fill="currentColor" opacity="0.5" />
          </svg>
        </button>
        {/* Toggle player panel */}
        <button
          onClick={onTogglePlayer}
          className={`px-2 py-1.5 border rounded text-sm transition-colors ${
            showPlayer
              ? "bg-accent/20 border-accent text-accent"
              : "bg-surface hover:bg-surface-hover border-surface-border text-gray-500"
          }`}
          title={`Toggle player (${navigator.platform.includes("Mac") ? "\u2318" : "Ctrl+"}J)`}
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="10" width="14" height="5" rx="1" fill="currentColor" opacity="0.5" />
          </svg>
        </button>
        {/* Toggle right sidebar */}
        <button
          onClick={onToggleRight}
          className={`px-2 py-1.5 border rounded text-sm transition-colors ${
            showRight
              ? "bg-accent/20 border-accent text-accent"
              : "bg-surface hover:bg-surface-hover border-surface-border text-gray-500"
          }`}
          title={`Toggle right sidebar (${navigator.platform.includes("Mac") ? "\u2318\u21e7" : "Ctrl+Shift+"}B)`}
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="10" y="1" width="5" height="14" rx="1" fill="currentColor" opacity="0.5" />
          </svg>
        </button>
        <button
          onClick={onShowImport}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover rounded text-sm font-medium transition-colors"
        >
          Import
        </button>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border rounded text-sm transition-colors"
        >
          Refresh
        </button>
        </>}
      </div>
    </header>
  );
}
