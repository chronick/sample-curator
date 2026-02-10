import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderBar } from "./HeaderBar";

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
});
