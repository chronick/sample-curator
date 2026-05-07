/**
 * Tests for the ML features section, with focus on the new vault-3ume
 * two-level backend → model selector. The component consumes the
 * ``mlFeaturesStore`` directly; tests seed the store via ``setState``
 * (matches the pattern used in ``IssuesBanner.test.tsx``).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MlFeaturesSection } from "./MlFeaturesSection";
import {
  useMlFeaturesStore,
  type MlBackendView,
  type MlFeatureView,
  type MlModelView,
  type MlStatus,
} from "../../store/mlFeaturesStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function backends(opts: {
  foundationAvail?: boolean;
  ollamaAvail?: boolean;
} = {}): MlBackendView[] {
  return [
    {
      backend_id: "foundation",
      label: "Apple Foundation Models",
      description: "Built into macOS",
      available: opts.foundationAvail ?? false,
      unavailable_reason: opts.foundationAvail
        ? null
        : "Requires macOS 26.0 or later.",
    },
    {
      backend_id: "ollama",
      label: "Ollama",
      description: "Local daemon",
      available: opts.ollamaAvail ?? true,
      unavailable_reason: opts.ollamaAvail === false ? "Daemon unreachable" : null,
    },
    {
      backend_id: "hf",
      label: "HuggingFace Transformers",
      description: "In-app",
      available: true,
      unavailable_reason: null,
    },
  ];
}

function llmFeature(overrides: Partial<MlFeatureView> = {}): MlFeatureView {
  return {
    feature_id: "llm_naming_refinement",
    label: "LLM naming refinement",
    description: "Local LLM refines transcript-derived filenames",
    kind: "llm",
    backends: ["foundation", "ollama", "hf"],
    default_backend: "ollama",
    default_model_id: "gemma3:1b",
    enabled: false,
    backend: "hf",
    model_id: "Qwen/Qwen2.5-0.5B-Instruct",
    ...overrides,
  };
}

function clapFeature(overrides: Partial<MlFeatureView> = {}): MlFeatureView {
  return {
    feature_id: "embedding_similarity",
    label: "Embedding similarity",
    description: "CLAP",
    kind: "embedding",
    backends: ["hf"],
    default_backend: "hf",
    default_model_id: "laion/clap-htsat-unfused",
    enabled: false,
    backend: "hf",
    model_id: "laion/clap-htsat-unfused",
    ...overrides,
  };
}

function model(overrides: Partial<MlModelView> = {}): MlModelView {
  return {
    model_id: overrides.model_id ?? "Qwen/Qwen2.5-0.5B-Instruct",
    label: overrides.label ?? "Qwen 2.5 0.5B Instruct",
    kind: overrides.kind ?? "llm",
    size_estimate_mb: overrides.size_estimate_mb ?? 1000,
    backend: overrides.backend ?? "hf",
    download_strategy: overrides.download_strategy ?? "hf",
    state: overrides.state ?? "downloaded_not_loaded",
    downloaded: overrides.downloaded ?? true,
    loaded: overrides.loaded ?? false,
    disk_bytes: overrides.disk_bytes ?? 0,
    error: overrides.error ?? null,
  };
}

function setStatus(status: MlStatus | null) {
  useMlFeaturesStore.setState({ status, error: null });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    features: [],
    models: [],
    backends: backends(),
  });
  setStatus(null);
});

afterEach(() => {
  setStatus(null);
});

describe("MlFeaturesSection — backend selector (vault-3ume)", () => {
  it("renders the backend dropdown only for multi-backend features", () => {
    setStatus({
      features: [llmFeature(), clapFeature()],
      models: [
        model(),
        model({
          model_id: "laion/clap-htsat-unfused",
          label: "CLAP",
          kind: "embedding",
          backend: "hf",
        }),
      ],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    // LLM feature: backend selector present
    expect(
      screen.queryByTestId("ml-feature-backend-llm_naming_refinement"),
    ).toBeInTheDocument();

    // CLAP feature: backends.length === 1, no backend selector
    expect(
      screen.queryByTestId("ml-feature-backend-embedding_similarity"),
    ).not.toBeInTheDocument();
  });

  it("lists all three backends and disables unavailable ones", () => {
    setStatus({
      features: [llmFeature()],
      models: [model()],
      backends: backends({ foundationAvail: false, ollamaAvail: false }),
    });

    render(<MlFeaturesSection />);

    const select = screen.getByTestId("ml-feature-backend-llm_naming_refinement") as HTMLSelectElement;
    const options = Array.from(select.options);
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toEqual([
      "Apple Foundation Models · unavailable",
      "Ollama · unavailable",
      "HuggingFace Transformers",
    ]);

    const fmOpt = options.find((o) => o.value === "foundation")!;
    const ollamaOpt = options.find((o) => o.value === "ollama")!;
    const hfOpt = options.find((o) => o.value === "hf")!;
    expect(fmOpt.disabled).toBe(true);
    expect(ollamaOpt.disabled).toBe(true);
    expect(hfOpt.disabled).toBe(false);
  });

  it("shows the unavailable reason inline when the selected backend is unavailable", () => {
    setStatus({
      features: [llmFeature({ backend: "foundation", model_id: "apple/foundation-models" })],
      models: [
        model({
          model_id: "apple/foundation-models",
          label: "System default",
          kind: "llm",
          backend: "foundation",
          download_strategy: "system",
          state: "not_available",
          downloaded: false,
          size_estimate_mb: 0,
        }),
      ],
      backends: backends({ foundationAvail: false }),
    });

    render(<MlFeaturesSection />);

    const warning = screen.getByTestId("ml-feature-backend-warning-llm_naming_refinement");
    expect(warning).toHaveTextContent(/Requires macOS 26.0/);
  });

  it("changing backend dropdown invokes ml_set_feature_backend", async () => {
    setStatus({
      features: [llmFeature({ backend: "hf" })],
      models: [model()],
      backends: backends(),
    });
    invokeMock.mockResolvedValueOnce({
      features: [llmFeature({ backend: "ollama", model_id: "gemma3:1b" })],
      models: [
        model({
          model_id: "gemma3:1b",
          label: "gemma3:1b",
          backend: "ollama",
          download_strategy: "lib_managed:ollama",
          size_estimate_mb: 0,
          state: "not_downloaded",
          downloaded: false,
        }),
      ],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    fireEvent.change(
      screen.getByTestId("ml-feature-backend-llm_naming_refinement"),
      { target: { value: "ollama" } },
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ml_set_feature_backend", {
        featureId: "llm_naming_refinement",
        backend: "ollama",
      });
    });
  });

  it("model dropdown lists only models matching the active backend + kind", () => {
    setStatus({
      features: [llmFeature({ backend: "hf" })],
      models: [
        // HF LLM — should appear
        model(),
        // Ollama LLM — different backend, should NOT appear
        model({
          model_id: "gemma3:1b",
          label: "gemma3:1b",
          backend: "ollama",
          download_strategy: "lib_managed:ollama",
          size_estimate_mb: 0,
        }),
        // HF embedding — different kind, should NOT appear
        model({
          model_id: "laion/clap-htsat-unfused",
          label: "CLAP",
          kind: "embedding",
          backend: "hf",
        }),
      ],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const modelSelect = screen.getByTestId(
      "ml-feature-model-llm_naming_refinement",
    ) as HTMLSelectElement;
    const values = Array.from(modelSelect.options).map((o) => o.value);
    expect(values).toEqual(["Qwen/Qwen2.5-0.5B-Instruct"]);
  });

  it("model dropdown shows empty-state hint when no models for the backend", () => {
    setStatus({
      features: [llmFeature({ backend: "ollama", model_id: "" })],
      models: [], // No ollama models pulled
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const modelSelect = screen.getByTestId(
      "ml-feature-model-llm_naming_refinement",
    ) as HTMLSelectElement;
    expect(modelSelect.disabled).toBe(true);
    expect(modelSelect.options[0].textContent).toMatch(/No ollama models pulled/);
  });

  it("Foundation model row hides Download / Reload / Remove buttons", () => {
    setStatus({
      features: [
        llmFeature({
          backend: "foundation",
          model_id: "apple/foundation-models",
          enabled: true,
        }),
      ],
      models: [
        model({
          model_id: "apple/foundation-models",
          label: "System default",
          kind: "llm",
          backend: "foundation",
          download_strategy: "system",
          state: "loaded",
          downloaded: true,
          loaded: true,
          size_estimate_mb: 0,
        }),
      ],
      backends: backends({ foundationAvail: true }),
    });

    render(<MlFeaturesSection />);

    expect(
      screen.queryByTestId("ml-model-download-apple/foundation-models"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ml-model-reload-apple/foundation-models"),
    ).not.toBeInTheDocument();
    // The "Loaded · ready" badge confirms the row rendered
    expect(screen.getByText(/Loaded · ready/)).toBeInTheDocument();
  });
});
