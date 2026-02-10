import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import type { Tab } from "./TabBar";

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    label: "All Samples",
    filters: { query: "", tags: [], limit: 100, offset: 0 },
    scrollPosition: 0,
    viewMode: "list",
    ...overrides,
  };
}

describe("TabBar", () => {
  const defaultProps = {
    tabs: [makeTab()],
    activeTabId: "tab-1",
    onSelectTab: vi.fn(),
    onNewTab: vi.fn(),
    onCloseTab: vi.fn(),
  };

  it("renders tab with its label", () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText("All Samples")).toBeInTheDocument();
  });

  it("renders + button for new tab", () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByTitle("New tab")).toBeInTheDocument();
  });

  it("calls onSelectTab when tab is clicked", () => {
    const onSelectTab = vi.fn();
    render(<TabBar {...defaultProps} onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByText("All Samples"));
    expect(onSelectTab).toHaveBeenCalledWith("tab-1");
  });

  it("calls onNewTab when + is clicked", () => {
    const onNewTab = vi.fn();
    render(<TabBar {...defaultProps} onNewTab={onNewTab} />);
    fireEvent.click(screen.getByTitle("New tab"));
    expect(onNewTab).toHaveBeenCalled();
  });

  it("hides close button when only 1 tab", () => {
    const { container } = render(<TabBar {...defaultProps} />);
    // The × character should not be in the DOM
    expect(container.querySelector("span.ml-1")).toBeNull();
  });

  it("shows close button when multiple tabs", () => {
    const tabs = [makeTab(), makeTab({ id: "tab-2", label: "Kicks" })];
    const { container } = render(
      <TabBar {...defaultProps} tabs={tabs} />
    );
    const closeButtons = container.querySelectorAll("span.ml-1");
    expect(closeButtons.length).toBe(2);
  });

  it("calls onCloseTab when close button is clicked", () => {
    const onCloseTab = vi.fn();
    const tabs = [makeTab(), makeTab({ id: "tab-2", label: "Kicks" })];
    const { container } = render(
      <TabBar {...defaultProps} tabs={tabs} onCloseTab={onCloseTab} />
    );
    const closeButtons = container.querySelectorAll("span.ml-1");
    fireEvent.click(closeButtons[1]);
    expect(onCloseTab).toHaveBeenCalledWith("tab-2");
  });

  it("shows query as label fallback when no explicit label", () => {
    const tab = makeTab({
      label: "",
      filters: { query: "dark techno", tags: [], limit: 100, offset: 0 },
    });
    render(<TabBar {...defaultProps} tabs={[tab]} />);
    expect(screen.getByText(/dark techno/)).toBeInTheDocument();
  });

  it("shows first tag as label fallback when no label or query", () => {
    const tab = makeTab({
      label: "",
      filters: { query: "", tags: ["kick"], limit: 100, offset: 0 },
    });
    render(<TabBar {...defaultProps} tabs={[tab]} />);
    expect(screen.getByText("kick")).toBeInTheDocument();
  });

  it('shows "All Samples" as label fallback when no filters', () => {
    const tab = makeTab({
      label: "",
      filters: { query: "", tags: [], limit: 100, offset: 0 },
    });
    render(<TabBar {...defaultProps} tabs={[tab]} />);
    expect(screen.getByText("All Samples")).toBeInTheDocument();
  });

  it("applies active styling to the active tab", () => {
    const tabs = [makeTab(), makeTab({ id: "tab-2", label: "Kicks" })];
    render(<TabBar {...defaultProps} tabs={tabs} activeTabId="tab-2" />);

    const kicksButton = screen.getByText("Kicks").closest("button")!;
    expect(kicksButton.className).toContain("text-accent");

    const allButton = screen.getByText("All Samples").closest("button")!;
    expect(allButton.className).toContain("text-gray-400");
  });
});
