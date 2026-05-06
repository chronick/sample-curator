import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IssuesBanner } from "./IssuesBanner";
import {
  useMlFeaturesStore,
  type MlBackendView,
  type MlFeatureView,
  type MlModelView,
  type MlStatus,
} from "../store/mlFeaturesStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function makeBackends(): MlBackendView[] {
  return [
    {
      backend_id: "foundation",
      label: "Apple Foundation Models",
      description: "Built into macOS",
      available: false,
      unavailable_reason: "Not yet wired",
    },
    {
      backend_id: "ollama",
      label: "Ollama",
      description: "Local daemon",
      available: true,
      unavailable_reason: null,
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

function makeStatus(features: MlFeatureView[], models: MlModelView[]): MlStatus {
  return { features, models, backends: makeBackends() };
}

function feat(overrides: Partial<MlFeatureView>): MlFeatureView {
  return {
    feature_id: overrides.feature_id ?? "stem_separation",
    label: overrides.label ?? "Stem separation",
    description: overrides.description ?? "",
    kind: overrides.kind ?? "stems",
    backends: overrides.backends ?? ["hf"],
    default_backend: overrides.default_backend ?? "hf",
    default_model_id: overrides.default_model_id ?? "facebook/htdemucs",
    enabled: overrides.enabled ?? true,
    backend: overrides.backend ?? "hf",
    model_id: overrides.model_id ?? "facebook/htdemucs",
  };
}

function model(overrides: Partial<MlModelView>): MlModelView {
  return {
    model_id: overrides.model_id ?? "facebook/htdemucs",
    label: overrides.label ?? "Demucs",
    kind: overrides.kind ?? "stems",
    size_estimate_mb: overrides.size_estimate_mb ?? 300,
    backend: overrides.backend ?? "hf",
    download_strategy: overrides.download_strategy ?? "lib_managed:demucs",
    state: overrides.state ?? "downloaded_not_loaded",
    downloaded: overrides.downloaded ?? true,
    loaded: overrides.loaded ?? false,
    disk_bytes: overrides.disk_bytes ?? 0,
    error: overrides.error ?? null,
  };
}

function setMlStatus(status: MlStatus | null) {
  useMlFeaturesStore.setState({ status });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(makeStatus([], []));
  setMlStatus(null);
});

afterEach(() => {
  setMlStatus(null);
});

describe("IssuesBanner", () => {
  it("renders nothing when no enabled features have issues", () => {
    setMlStatus(makeStatus([], []));
    const { container } = render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the message for a single ML feature issue", () => {
    setMlStatus(
      makeStatus(
        [feat({ enabled: true, backend: "hf", model_id: "facebook/htdemucs" })],
        [model({ state: "downloaded_not_loaded" })],
      ),
    );
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/Stem separation not loaded/);
  });

  it("aggregates multiple issues into a count", () => {
    setMlStatus(
      makeStatus(
        [
          feat({
            feature_id: "embedding_similarity",
            label: "Embedding similarity",
            kind: "embedding",
            default_model_id: "laion/clap-htsat-unfused",
            model_id: "laion/clap-htsat-unfused",
            enabled: true,
          }),
          feat({
            feature_id: "llm_naming_refinement",
            label: "LLM naming refinement",
            kind: "llm",
            backends: ["foundation", "ollama", "hf"],
            default_backend: "ollama",
            default_model_id: "gemma3:1b",
            backend: "ollama",
            model_id: "gemma3:1b",
            enabled: true,
          }),
        ],
        [
          model({
            model_id: "laion/clap-htsat-unfused",
            label: "CLAP",
            kind: "embedding",
            size_estimate_mb: 620,
            download_strategy: "hf",
            state: "downloaded_not_loaded",
          }),
          model({
            model_id: "gemma3:1b",
            label: "gemma3:1b",
            kind: "llm",
            backend: "ollama",
            download_strategy: "lib_managed:ollama",
            state: "not_downloaded",
            downloaded: false,
          }),
        ],
      ),
    );
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/2 issues/);
  });

  it("ignores disabled features", () => {
    setMlStatus(
      makeStatus(
        [feat({ enabled: false })],
        [model({ state: "not_downloaded", downloaded: false })],
      ),
    );
    const { container } = render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("ignores not_available state (surfaced inline in Settings)", () => {
    setMlStatus(
      makeStatus(
        [
          feat({
            feature_id: "llm_naming_refinement",
            label: "LLM naming refinement",
            kind: "llm",
            backends: ["foundation", "ollama", "hf"],
            default_backend: "ollama",
            default_model_id: "gemma3:1b",
            backend: "foundation",
            model_id: "apple/foundation-models",
            enabled: true,
          }),
        ],
        [
          model({
            model_id: "apple/foundation-models",
            label: "System default",
            kind: "llm",
            backend: "foundation",
            download_strategy: "system",
            state: "not_available",
            downloaded: false,
          }),
        ],
      ),
    );
    const { container } = render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss hides until issues change", () => {
    setMlStatus(
      makeStatus(
        [feat({ enabled: true })],
        [model({ state: "error", downloaded: false, error: "lib missing" })],
      ),
    );
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("issues-banner")).not.toBeInTheDocument();
  });

  it("Settings click invokes onShowSettings", () => {
    setMlStatus(
      makeStatus(
        [feat({ enabled: true })],
        [model({ state: "downloaded_not_loaded" })],
      ),
    );
    const onShowSettings = vi.fn();
    render(<IssuesBanner onShowSettings={onShowSettings} />);
    fireEvent.click(screen.getByTestId("issues-banner-settings"));
    expect(onShowSettings).toHaveBeenCalled();
  });
});
