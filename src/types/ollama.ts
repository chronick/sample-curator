export type OllamaState = "not_loaded" | "loading" | "loaded" | "errored";

export interface OllamaStatusDict {
  state: OllamaState;
  model: string | null;
  available_models: string[];
  error: string | null;
}

// Keep in sync with sidecar/sample_curation_api/ollama_status.py.
export const RANKED_MODELS = ["gemma4:e2b", "gemma3:1b", "qwen2.5:3b"] as const;

export const INITIAL_OLLAMA_STATUS: OllamaStatusDict = {
  state: "loading",
  model: null,
  available_models: [],
  error: null,
};
