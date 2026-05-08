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
  type DepsStatus,
  type MlBackendView,
  type MlFeatureView,
  type MlModelView,
  type MlStatus,
} from "../../store/mlFeaturesStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  // Stub listener — returns a no-op unsub. Tests that need to drive
  // events use the store actions directly instead of going through Tauri.
  listen: vi.fn(async () => () => {}),
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
      required_extras: [],
    },
    {
      backend_id: "ollama",
      label: "Ollama",
      description: "Local daemon",
      available: opts.ollamaAvail ?? true,
      unavailable_reason: opts.ollamaAvail === false ? "Daemon unreachable" : null,
      required_extras: ["llm_ollama"],
    },
    {
      backend_id: "hf",
      label: "HuggingFace Transformers",
      description: "In-app",
      available: true,
      unavailable_reason: null,
      required_extras: ["llm_hf"],
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
    required_extras: [],
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
    required_extras: ["embedding"],
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

function setDeps(deps: DepsStatus | null) {
  useMlFeaturesStore.setState({ deps });
}

function setInstall(partial: Partial<ReturnType<typeof useMlFeaturesStore.getState>["install"]>) {
  useMlFeaturesStore.setState({
    install: {
      running: false,
      pendingExtras: [],
      log: [],
      lastResult: null,
      ...partial,
    },
  });
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
  // Install state leaks across tests (zustand singleton). Reset to
  // pristine so e.g. a leftover ``running: true`` from one test
  // doesn't short-circuit ``installDeps`` in the next.
  setInstall({});
});

afterEach(() => {
  setStatus(null);
  setInstall({});
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

describe("MlFeaturesSection — deps gating (vault-347l)", () => {
  it("renders the Dependencies card with installed/missing per extra", () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["transformers", "torch"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: false, missing: ["demucs", "torch"] },
        llm_hf: { installed: false, missing: ["transformers", "torch", "accelerate"] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({
      features: [clapFeature()],
      models: [],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const card = screen.getByTestId("ml-deps-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("ml-deps-summary")).toHaveTextContent(/2 of 5 installed/);
    // installed extras render with ✓
    expect(screen.getByTestId("ml-deps-extra-transcription")).toHaveTextContent(/✓/);
    expect(screen.getByTestId("ml-deps-extra-llm_ollama")).toHaveTextContent(/✓/);
    // missing extras render with ✗ and the missing module list
    expect(screen.getByTestId("ml-deps-extra-embedding")).toHaveTextContent(/✗/);
    expect(screen.getByTestId("ml-deps-extra-embedding")).toHaveTextContent(/transformers/);
  });

  it("greys the toggle when required extras are missing", () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["laion_clap"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({
      features: [clapFeature()],
      models: [],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const toggle = screen.getByTestId("ml-feature-toggle-embedding_similarity");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    // Install CTA renders with the missing extras listed
    const cta = screen.getByTestId("ml-feature-deps-cta-embedding_similarity");
    expect(cta).toHaveTextContent(/embedding/);
  });

  it("does not grey the toggle when feature deps are installed", () => {
    setDeps({
      extras: {
        embedding: { installed: true, missing: [] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({
      features: [clapFeature()],
      models: [],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const toggle = screen.getByTestId("ml-feature-toggle-embedding_similarity");
    expect(toggle).toHaveAttribute("aria-disabled", "false");
    expect(
      screen.queryByTestId("ml-feature-deps-cta-embedding_similarity"),
    ).not.toBeInTheDocument();
  });

  it("does not grey non-LLM features when only backend (LLM) extras are missing", () => {
    // Regression: previously the toggle for embedding_similarity (kind=embedding,
    // backend=hf) was incorrectly greyed because the helper unconditionally
    // unioned backend.required_extras (`llm_hf`) into the feature's required
    // set. Non-LLM features share the HF code path for model loading but
    // declare their actual substrate via feature.required_extras.
    setDeps({
      extras: {
        embedding: { installed: true, missing: [] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: false, missing: ["accelerate"] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({
      features: [clapFeature()],
      models: [],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const toggle = screen.getByTestId("ml-feature-toggle-embedding_similarity");
    expect(toggle).toHaveAttribute("aria-disabled", "false");
    expect(
      screen.queryByTestId("ml-feature-deps-cta-embedding_similarity"),
    ).not.toBeInTheDocument();
  });

  it("greys the LLM toggle for the active backend's missing extras (per-backend gating)", () => {
    // Only HF deps missing — feature default in fixture is hf backend
    setDeps({
      extras: {
        embedding: { installed: true, missing: [] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: false, missing: ["transformers"] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({
      features: [llmFeature({ backend: "hf" })],
      models: [],
      backends: backends(),
    });

    render(<MlFeaturesSection />);

    const toggle = screen.getByTestId("ml-feature-toggle-llm_naming_refinement");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
  });

  it("foundation backend never reports missing extras even when others miss", () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["all"] },
        transcription: { installed: false, missing: ["all"] },
        stems: { installed: false, missing: ["all"] },
        llm_hf: { installed: false, missing: ["all"] },
        llm_ollama: { installed: false, missing: ["all"] },
      },
    });
    setStatus({
      features: [llmFeature({ backend: "foundation" })],
      models: [],
      backends: backends({ foundationAvail: true }),
    });

    render(<MlFeaturesSection />);

    const toggle = screen.getByTestId("ml-feature-toggle-llm_naming_refinement");
    expect(toggle).toHaveAttribute("aria-disabled", "false");
  });
});

describe("MlFeaturesSection — install workflow (vault-347l Phase 2 slice 5)", () => {
  it("renders Install buttons next to missing extras", () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["transformers"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: false, missing: ["demucs"] },
        llm_hf: { installed: false, missing: ["transformers"] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);

    expect(screen.getByTestId("ml-deps-install-embedding")).toBeInTheDocument();
    expect(screen.getByTestId("ml-deps-install-stems")).toBeInTheDocument();
    expect(screen.getByTestId("ml-deps-install-llm_hf")).toBeInTheDocument();
    // Installed extras get an Uninstall, not Install.
    expect(screen.queryByTestId("ml-deps-install-transcription")).not.toBeInTheDocument();
    expect(screen.getByTestId("ml-deps-uninstall-transcription")).toBeInTheDocument();
    expect(screen.getByTestId("ml-deps-uninstall-llm_ollama")).toBeInTheDocument();
  });

  it("clicking Install invokes deps_install with the extra", async () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["transformers"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);
    invokeMock.mockClear();
    fireEvent.click(screen.getByTestId("ml-deps-install-embedding"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("deps_install", { extras: ["embedding"] });
    });
  });

  it("clicking Uninstall invokes deps_uninstall with the extra", async () => {
    setDeps({
      extras: {
        embedding: { installed: true, missing: [] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);
    invokeMock.mockClear();
    fireEvent.click(screen.getByTestId("ml-deps-uninstall-embedding"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("deps_uninstall", { extras: ["embedding"] });
    });
  });

  it("disables Install/Uninstall buttons while another install is running", () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["transformers"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setInstall({ running: true, pendingExtras: ["transcription"] });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);

    // Both install AND uninstall buttons should reflect the busy state
    expect(screen.getByTestId("ml-deps-install-embedding")).toBeDisabled();
    expect(screen.getByTestId("ml-deps-uninstall-transcription")).toBeDisabled();
  });

  it("renders the install progress modal when install is running", () => {
    setInstall({
      running: true,
      pendingExtras: ["embedding"],
      log: [
        { kind: "info", line: "Running uv sync --extra embedding" },
        { kind: "stdout", line: "Resolved 14 packages" },
        { kind: "stdout", line: "Downloaded transformers-4.45.0" },
      ],
    });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);

    expect(screen.getByTestId("ml-install-progress-modal")).toBeInTheDocument();
    const log = screen.getByTestId("ml-install-progress-log");
    expect(log).toHaveTextContent(/Running uv sync/);
    expect(log).toHaveTextContent(/Resolved 14 packages/);
    expect(log).toHaveTextContent(/Downloaded transformers/);
    // Close button is hidden while running
    expect(screen.queryByTestId("ml-install-progress-close")).not.toBeInTheDocument();
  });

  it("modal shows error and a Close button on failed install", () => {
    setInstall({
      running: false,
      pendingExtras: ["stems"],
      log: [{ kind: "stderr", line: "error: failed to fetch demucs" }],
      lastResult: { success: false, error: "uv sync exited with code 1" },
    });
    setStatus({ features: [], models: [], backends: backends() });

    render(<MlFeaturesSection />);

    expect(screen.getByText(/Install failed/)).toBeInTheDocument();
    expect(screen.getByText(/uv sync exited with code 1/)).toBeInTheDocument();
    expect(screen.getByTestId("ml-install-progress-dismiss")).toBeInTheDocument();
  });

  it("per-feature CTA install button calls deps_install with the missing extras", async () => {
    setDeps({
      extras: {
        embedding: { installed: false, missing: ["laion_clap"] },
        transcription: { installed: true, missing: [] },
        stems: { installed: true, missing: [] },
        llm_hf: { installed: true, missing: [] },
        llm_ollama: { installed: true, missing: [] },
      },
    });
    setStatus({ features: [clapFeature()], models: [], backends: backends() });

    render(<MlFeaturesSection />);
    invokeMock.mockClear();
    fireEvent.click(screen.getByTestId("ml-feature-install-deps-embedding_similarity"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("deps_install", { extras: ["embedding"] });
    });
  });
});
