import { useState } from "react";
import { type OllamaStatusDict } from "../types/ollama";
import type { OrphanedRecording } from "./OrphanedRecordingsDialog";
import { GeneralTab } from "./settings/GeneralTab";
import { AudioTab } from "./settings/AudioTab";
import { FilesTab } from "./settings/FilesTab";
import { AnalysisMlTab } from "./settings/AnalysisMlTab";
import { LibraryTab } from "./settings/LibraryTab";
import { AboutTab } from "./settings/AboutTab";

type TabId = "general" | "audio" | "files" | "analysis-ml" | "library" | "about";

const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "audio", label: "Audio" },
  { id: "files", label: "Files" },
  { id: "analysis-ml", label: "Analysis & ML" },
  { id: "library", label: "Library" },
  { id: "about", label: "About" },
];

interface SettingsDialogProps {
  onClose: () => void;
  llmStatus: OllamaStatusDict;
  onRefreshLlm: () => Promise<void>;
  onSetLlmModel: (model: string | null) => Promise<void>;
  onShowOrphans: (orphans: OrphanedRecording[]) => void;
  initialTab?: TabId;
}

export function SettingsDialog({
  onClose,
  llmStatus,
  onRefreshLlm,
  onSetLlmModel,
  onShowOrphans,
  initialTab = "general",
}: SettingsDialogProps) {
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-raised border border-surface-border rounded-lg w-[720px] max-w-[95vw] h-[640px] max-h-[90vh] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
            aria-label="Close settings"
          >
            &times;
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav
            className="w-[160px] shrink-0 border-r border-surface-border p-3 space-y-1"
            role="tablist"
            aria-label="Settings sections"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`settings-panel-${t.id}`}
                id={`settings-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                data-testid={`settings-tab-${t.id}`}
                className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                  tab === t.id
                    ? "bg-accent/20 text-white"
                    : "text-gray-400 hover:bg-surface hover:text-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div
            className="flex-1 overflow-y-auto p-6"
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
          >
            {tab === "general" && <GeneralTab />}
            {tab === "audio" && <AudioTab />}
            {tab === "files" && (
              <FilesTab onClose={onClose} onShowOrphans={onShowOrphans} />
            )}
            {tab === "analysis-ml" && (
              <AnalysisMlTab
                llmStatus={llmStatus}
                onRefreshLlm={onRefreshLlm}
                onSetLlmModel={onSetLlmModel}
              />
            )}
            {tab === "library" && <LibraryTab />}
            {tab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsDialog;
