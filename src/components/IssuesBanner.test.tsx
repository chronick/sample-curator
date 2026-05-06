import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IssuesBanner } from "./IssuesBanner";
import { useMlFeaturesStore, type MlStatus } from "../store/mlFeaturesStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

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
  it("renders nothing when no enabled features have issues", () => {
    setMlStatus(makeMlStatus());
    const { container } = render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the message for a single ML feature issue", () => {
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
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/Stem separation not loaded/);
  });

  it("aggregates multiple issues into a count", () => {
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
          {
            feature_id: "llm_naming_refinement",
            label: "LLM naming refinement",
            description: "",
            kind: "llm",
            default_model_id: "ollama:gemma3:1b",
            enabled: true,
            model_id: "ollama:gemma3:1b",
          },
        ],
        models: [
          {
            model_id: "laion/clap-htsat-unfused",
            label: "CLAP",
            kind: "embedding",
            size_estimate_mb: 620,
            download_strategy: "hf",
            state: "downloaded_not_loaded",
            downloaded: true,
            loaded: false,
            disk_bytes: 0,
            error: null,
          },
          {
            model_id: "ollama:gemma3:1b",
            label: "gemma3:1b",
            kind: "llm",
            size_estimate_mb: 0,
            download_strategy: "lib_managed:ollama",
            state: "not_downloaded",
            downloaded: false,
            loaded: false,
            disk_bytes: 0,
            error: null,
          },
        ],
      }),
    );
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner-message")).toHaveTextContent(/2 issues/);
  });

  it("ignores disabled features", () => {
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
            label: "Demucs",
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
    const { container } = render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss hides until issues change", () => {
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
            label: "Demucs",
            kind: "stems",
            size_estimate_mb: 300,
            download_strategy: "lib_managed:demucs",
            state: "error",
            downloaded: false,
            loaded: false,
            disk_bytes: 0,
            error: "lib missing",
          },
        ],
      }),
    );
    render(<IssuesBanner onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("issues-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("issues-banner")).not.toBeInTheDocument();
  });

  it("Settings click invokes onShowSettings", () => {
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
            label: "Demucs",
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
    const onShowSettings = vi.fn();
    render(<IssuesBanner onShowSettings={onShowSettings} />);
    fireEvent.click(screen.getByTestId("issues-banner-settings"));
    expect(onShowSettings).toHaveBeenCalled();
  });
});
