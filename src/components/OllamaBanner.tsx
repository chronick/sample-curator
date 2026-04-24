import { useState } from "react";
import type { OllamaStatusDict } from "../types/ollama";

interface OllamaBannerProps {
  status: OllamaStatusDict;
  onShowSettings: () => void;
}

export function OllamaBanner({ status, onShowSettings }: OllamaBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || status.state === "loaded" || status.state === "loading") {
    return null;
  }

  const message =
    status.state === "errored"
      ? `LLM unavailable: ${status.error ?? "unknown error"}`
      : "LLM not loaded — vocal naming requires a local model.";

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-300 text-sm"
      data-testid="ollama-banner"
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={onShowSettings}
        className="underline hover:text-yellow-100 shrink-0"
      >
        Settings
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-yellow-400/60 hover:text-yellow-200 shrink-0 text-base leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
