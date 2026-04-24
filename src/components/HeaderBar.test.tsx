import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderBar } from "./HeaderBar";
import type { OllamaStatusDict } from "../types/ollama";

function makeLlmStatus(overrides: Partial<OllamaStatusDict> = {}): OllamaStatusDict {
  return {
    state: "loaded",
    model: "gemma3:1b",
    available_models: ["gemma3:1b"],
    error: null,
    ...overrides,
  };
}

function defaultProps() {
  return {
    activeView: "browse" as const,
    showLeft: false,
    showRight: false,
    showPlayer: false,
    llmStatus: makeLlmStatus(),
    onSetActiveView: vi.fn(),
    onToggleLeft: vi.fn(),
    onToggleRight: vi.fn(),
    onTogglePlayer: vi.fn(),
    onShowSettings: vi.fn(),
    onShowImport: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe("HeaderBar", () => {
  it("renders title", () => {
    render(<HeaderBar {...defaultProps()} />);
    expect(screen.getByText("Sample Curator")).toBeInTheDocument();
  });

  it("renders Browse and Jobs view buttons", () => {
    render(<HeaderBar {...defaultProps()} />);
    expect(screen.getByText("Browse")).toBeInTheDocument();
    expect(screen.getByText("Jobs")).toBeInTheDocument();
  });

  it("applies active style to Browse when activeView is browse", () => {
    render(<HeaderBar {...defaultProps()} />);
    const browseBtn = screen.getByText("Browse");
    expect(browseBtn.className).toContain("text-accent");
    const jobsBtn = screen.getByText("Jobs");
    expect(jobsBtn.className).toContain("text-gray-400");
  });

  it("applies active style to Jobs when activeView is jobs", () => {
    render(<HeaderBar {...defaultProps()} activeView="jobs" />);
    const jobsBtn = screen.getByText("Jobs");
    expect(jobsBtn.className).toContain("text-accent");
  });

  it("calls onSetActiveView with 'browse' when Browse clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByText("Browse"));
    expect(props.onSetActiveView).toHaveBeenCalledWith("browse");
  });

  it("calls onSetActiveView with 'jobs' when Jobs clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByText("Jobs"));
    expect(props.onSetActiveView).toHaveBeenCalledWith("jobs");
  });

  it("calls onShowSettings when Settings button clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByTitle("Settings"));
    expect(props.onShowSettings).toHaveBeenCalled();
  });

  it("calls onToggleLeft when left sidebar button clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByTitle(/Toggle left sidebar/));
    expect(props.onToggleLeft).toHaveBeenCalled();
  });

  it("calls onToggleRight when right sidebar button clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByTitle(/Toggle right sidebar/));
    expect(props.onToggleRight).toHaveBeenCalled();
  });

  it("calls onTogglePlayer when player button clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByTitle(/Toggle player/));
    expect(props.onTogglePlayer).toHaveBeenCalled();
  });

  it("calls onShowImport when Import clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByText("Import"));
    expect(props.onShowImport).toHaveBeenCalled();
  });

  it("calls onRefresh when Refresh clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByText("Refresh"));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("highlights left sidebar button when showLeft is true", () => {
    render(<HeaderBar {...defaultProps()} showLeft={true} />);
    const btn = screen.getByTitle(/Toggle left sidebar/);
    expect(btn.className).toContain("text-accent");
  });

  it("highlights right sidebar button when showRight is true", () => {
    render(<HeaderBar {...defaultProps()} showRight={true} />);
    const btn = screen.getByTitle(/Toggle right sidebar/);
    expect(btn.className).toContain("text-accent");
  });

  it("highlights player button when showPlayer is true", () => {
    render(<HeaderBar {...defaultProps()} showPlayer={true} />);
    const btn = screen.getByTitle(/Toggle player/);
    expect(btn.className).toContain("text-accent");
  });

  it("renders Record button", () => {
    render(<HeaderBar {...defaultProps()} />);
    expect(screen.getByText("Record")).toBeInTheDocument();
  });

  it("calls onSetActiveView with 'record' when Record clicked", () => {
    const props = defaultProps();
    render(<HeaderBar {...props} />);
    fireEvent.click(screen.getByText("Record"));
    expect(props.onSetActiveView).toHaveBeenCalledWith("record");
  });

  it("applies active style to Record when activeView is record", () => {
    render(<HeaderBar {...defaultProps()} activeView="record" />);
    const recordBtn = screen.getByText("Record");
    expect(recordBtn.className).toContain("text-accent");
  });

  it("hides sidebar toggles when activeView is record", () => {
    render(<HeaderBar {...defaultProps()} activeView="record" />);
    expect(screen.queryByTitle(/Toggle left sidebar/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Toggle right sidebar/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Toggle player/)).not.toBeInTheDocument();
    expect(screen.queryByText("Import")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
  });

  it("shows sidebar toggles when activeView is browse", () => {
    render(<HeaderBar {...defaultProps()} activeView="browse" />);
    expect(screen.getByTitle(/Toggle left sidebar/)).toBeInTheDocument();
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });

  describe("LLM status dot", () => {
    it("shows green dot when loaded", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "loaded", model: "gemma3:1b" })} />);
      const dot = screen.getByTestId("llm-status-dot");
      expect(dot.className).toContain("bg-green-500");
    });

    it("shows pulsing yellow dot when loading", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "loading", model: null })} />);
      const dot = screen.getByTestId("llm-status-dot");
      expect(dot.className).toContain("bg-yellow-400");
      expect(dot.className).toContain("animate-pulse");
    });

    it("shows grey dot when not_loaded", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "not_loaded", model: null })} />);
      const dot = screen.getByTestId("llm-status-dot");
      expect(dot.className).toContain("bg-gray-500");
    });

    it("shows red dot when errored", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "errored", model: null, error: "daemon crash" })} />);
      const dot = screen.getByTestId("llm-status-dot");
      expect(dot.className).toContain("bg-red-500");
    });

    it("tooltip says LLM ready with model when loaded", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "loaded", model: "gemma3:1b" })} />);
      expect(screen.getByTitle("LLM ready: gemma3:1b")).toBeInTheDocument();
    });

    it("tooltip says LLM loading with model when loading and model known", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "loading", model: "gemma3:1b" })} />);
      expect(screen.getByTitle("LLM loading: gemma3:1b…")).toBeInTheDocument();
    });

    it("tooltip says detecting when loading and no model", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "loading", model: null })} />);
      expect(screen.getByTitle("LLM loading: detecting…")).toBeInTheDocument();
    });

    it("tooltip says click Settings when not_loaded", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "not_loaded", model: null })} />);
      expect(screen.getByTitle("LLM not loaded — click Settings to configure")).toBeInTheDocument();
    });

    it("tooltip shows error message when errored", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "errored", model: null, error: "daemon crash" })} />);
      expect(screen.getByTitle("LLM error: daemon crash")).toBeInTheDocument();
    });

    it("tooltip falls back to 'unknown' when errored with no error message", () => {
      render(<HeaderBar {...defaultProps()} llmStatus={makeLlmStatus({ state: "errored", model: null, error: null })} />);
      expect(screen.getByTitle("LLM error: unknown")).toBeInTheDocument();
    });
  });
});
