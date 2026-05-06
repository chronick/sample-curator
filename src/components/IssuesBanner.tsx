/**
 * Generic config-issues banner. Aggregates from multiple sources:
 *
 * - Ollama daemon (LLM vocal naming refinement)
 * - ML features (CLAP, Whisper, Demucs) — any enabled feature whose
 *   model isn't `loaded` is surfaced here
 *
 * Future sources (filed as followup): library health, audio interface
 * configuration, etc. Issues are de-duplicated by id; the banner shows
 * a single full message when there's one issue, or a count + Settings
 * link when there are multiple.
 */

import { useEffect, useState } from "react";
import type { OllamaStatusDict } from "../types/ollama";
import { useMlFeaturesStore } from "../store/mlFeaturesStore";

export interface Issue {
  id: string;
  message: string;
}

function deriveIssues(llm: OllamaStatusDict, mlIssues: Issue[]): Issue[] {
  const issues: Issue[] = [];

  if (llm.state === "errored") {
    issues.push({
      id: "llm:errored",
      message: `LLM unavailable: ${llm.error ?? "unknown error"}`,
    });
  } else if (llm.state === "not_loaded") {
    issues.push({
      id: "llm:not_loaded",
      message: "LLM not loaded — vocal naming requires a local model.",
    });
  }
  // state === "loading" or "loaded" → no issue

  return issues.concat(mlIssues);
}

function deriveMlIssues(
  status: ReturnType<typeof useMlFeaturesStore.getState>["status"],
): Issue[] {
  if (!status) return [];
  const issues: Issue[] = [];
  for (const f of status.features) {
    if (!f.enabled) continue;
    const model = status.models.find((m) => m.model_id === f.model_id);
    if (!model) continue;
    if (model.state === "loaded" || model.state === "loading") continue;
    if (model.state === "downloading") continue; // user-visible inside Settings already
    issues.push({
      id: `ml:${f.feature_id}:${model.state}`,
      message:
        model.state === "error"
          ? `${f.label} failed: ${model.error ?? "unknown error"}`
          : `${f.label} not loaded (${model.state.replace(/_/g, " ")})`,
    });
  }
  return issues;
}

interface IssuesBannerProps {
  llmStatus: OllamaStatusDict;
  onShowSettings: () => void;
}

export function IssuesBanner({ llmStatus, onShowSettings }: IssuesBannerProps) {
  const mlStatus = useMlFeaturesStore((s) => s.status);
  const refreshMl = useMlFeaturesStore((s) => s.refresh);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Bootstrap ML status if not loaded yet — banner needs it to know if any
  // feature is unloaded.
  useEffect(() => {
    if (mlStatus === null) {
      void refreshMl();
    }
  }, [mlStatus, refreshMl]);

  const allIssues = deriveIssues(llmStatus, deriveMlIssues(mlStatus));
  const fingerprint = allIssues.map((i) => i.id).sort().join("|");

  // Dismissal is per-fingerprint: if the issue set changes, undismiss.
  const isDismissed = dismissed.has(fingerprint);
  const visibleIssues = isDismissed ? [] : allIssues;

  if (visibleIssues.length === 0) return null;

  const message =
    visibleIssues.length === 1
      ? visibleIssues[0].message
      : `${visibleIssues.length} issues — see Settings for details.`;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-300 text-sm"
      data-testid="issues-banner"
    >
      <span className="flex-1" data-testid="issues-banner-message">
        {message}
      </span>
      <button
        onClick={onShowSettings}
        className="underline hover:text-yellow-100 shrink-0"
        data-testid="issues-banner-settings"
      >
        Settings
      </button>
      <button
        onClick={() => setDismissed((prev) => new Set(prev).add(fingerprint))}
        className="text-yellow-400/60 hover:text-yellow-200 shrink-0 text-base leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
