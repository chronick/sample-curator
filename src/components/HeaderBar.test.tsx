import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderBar } from "./HeaderBar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ features: [], models: [] }),
}));

function defaultProps() {
  return {
    activeView: "browse" as const,
    showLeft: false,
    showRight: false,
    showPlayer: false,
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

  it("renders the ML status indicator (replaces former LLM dot)", () => {
    render(<HeaderBar {...defaultProps()} />);
    expect(screen.getByTestId("ml-status-indicator")).toBeInTheDocument();
  });
});
