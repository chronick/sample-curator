import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IssuesBanner } from "./IssuesBanner";
import type { OllamaStatusDict } from "../types/ollama";
import { useMlFeaturesStore, type MlStatus } from "../store/mlFeaturesStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function makeLlm(overrides: Partial<OllamaStatusDict> = {}): OllamaStatusDict {
  return {
    state: "loaded",
    model: "gemma3:1b",
    available_models: ["gemma3:1b"],
    error: null,
    ...overrides,
  };
}

function makeMlStatus(overrides: Partial<MlStatus> = {}): MlStatus {
  return {
    features: [],
    models: [],
    ...overrides,
  };
}

function setMlStatus(status: MlStatus | null) {
  useMlFeaturesStore.setState({ status });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(makeMlStatus());
  setMlStatus(null);
});

afterEach(() => {
  setMlStatus(null);
});

describe("IssuesBanner", () => {
  it("renders nothing when no issues", () => {
    setMlStatus(makeMlStatus());
    const { container } = render(<IssuesBanner llmStatus={makeLlm()} onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the LLM message when ollama not loaded and no ML issues", () => {
    setMlStatus(makeMlStatus());
    render(<IssuesBanner llmStatus={makeLlm({ state: "not_loaded", model: null })} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/LLM not loaded/);
  });

  it("aggregates LLM + ML feature issues into a count when multiple", () => {
    setMlStatus(
      makeMlStatus({
        features: [
          {
            feature_id: "embedding_similarity",
            label: "Embedding similarity",
            description: "",
            kind: "embedding",
            default_model_id: "laion/clap-htsat-unfused",
            enabled: true,
            model_id: "laion/clap-htsat-unfused",
          },
        ],
        models: [
          {
            model_id: "laion/clap-htsat-unfused",
            label: "CLAP (HTSAT, unfused)",
            kind: "embedding",
            size_estimate_mb: 620,
            download_strategy: "hf",
            state: "downloaded_not_loaded",
            downloaded: true,
            loaded: false,
            disk_bytes: 0,
            error: null,
          },
        ],
      }),
    );
    render(<IssuesBanner llmStatus={makeLlm({ state: "not_loaded", model: null })} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/2 issues/);
  });

  it("shows the ML feature message alone when LLM is fine", () => {
    setMlStatus(
      makeMlStatus({
        features: [
          {
            feature_id: "stem_separation",
            label: "Stem separation",
            description: "",
            kind: "stems",
            default_model_id: "facebook/htdemucs",
            enabled: true,
            model_id: "facebook/htdemucs",
          },
        ],
        models: [
          {
            model_id: "facebook/htdemucs",
            label: "Demucs (htdemucs)",
            kind: "stems",
            size_estimate_mb: 300,
            download_strategy: "lib_managed:demucs",
            state: "downloaded_not_loaded",
            downloaded: true,
            loaded: false,
            disk_bytes: 0,
            error: null,
          },
        ],
      }),
    );
    render(<IssuesBanner llmStatus={makeLlm()} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/Stem separation not loaded/);
  });

  it("ignores disabled features (no issue if user explicitly turned it off)", () => {
    setMlStatus(
      makeMlStatus({
        features: [
          {
            feature_id: "stem_separation",
            label: "Stem separation",
            description: "",
            kind: "stems",
            default_model_id: "facebook/htdemucs",
            enabled: false,
            model_id: "facebook/htdemucs",
          },
        ],
        models: [
          {
            model_id: "facebook/htdemucs",
            label: "Demucs (htdemucs)",
            kind: "stems",
            size_estimate_mb: 300,
            download_strategy: "lib_managed:demucs",
            state: "not_downloaded",
            downloaded: false,
            loaded: false,
            disk_bytes: 0,
            error: null,
          },
        ],
      }),
    );
    const { container } = render(<IssuesBanner llmStatus={makeLlm()} onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss hides until issues change", () => {
    setMlStatus(makeMlStatus());
    render(<IssuesBanner llmStatus={makeLlm({ state: "not_loaded", model: null })} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("issues-banner")).not.toBeInTheDocument();
  });

  it("Settings click invokes onShowSettings", () => {
    setMlStatus(makeMlStatus());
    const onShowSettings = vi.fn();
    render(<IssuesBanner llmStatus={makeLlm({ state: "not_loaded", model: null })} onShowSettings={onShowSettings} />);
    fireEvent.click(screen.getByTestId("issues-banner-settings"));
    expect(onShowSettings).toHaveBeenCalled();
  });
});
