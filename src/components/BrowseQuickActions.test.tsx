import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowseQuickActions } from "./BrowseQuickActions";

function setup(overrides: Partial<React.ComponentProps<typeof BrowseQuickActions>> = {}) {
  const onSort = vi.fn();
  const onApplyRecent = vi.fn();
  const props = {
    sortField: "path",
    sortDirection: "asc" as const,
    onSort,
    onApplyRecent,
    ...overrides,
  };
  const utils = render(<BrowseQuickActions {...props} />);
  return { ...utils, onSort, onApplyRecent };
}

describe("BrowseQuickActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Recent button", () => {
    setup();
    expect(screen.getByTestId("browse-recent-button")).toBeInTheDocument();
  });

  it("renders sort button showing the current sort label", () => {
    setup({ sortField: "created_at", sortDirection: "desc" });
    const btn = screen.getByTestId("browse-sort-button");
    expect(btn).toHaveTextContent("Created (newest)");
    // Arrow reflects direction
    expect(btn).toHaveTextContent("\u2193");
  });

  it("falls back to raw field name when not in the preset list", () => {
    setup({ sortField: "some_unusual_field", sortDirection: "asc" });
    const btn = screen.getByTestId("browse-sort-button");
    expect(btn).toHaveTextContent("Sort: some_unusual_field");
  });

  it("click on Recent calls onApplyRecent", () => {
    const { onApplyRecent } = setup();
    fireEvent.click(screen.getByTestId("browse-recent-button"));
    expect(onApplyRecent).toHaveBeenCalledTimes(1);
  });

  it("click on sort button opens menu with all options", () => {
    setup(); // default sortField is "path" → button already shows "Name (A-Z)"
    expect(screen.queryByTestId("browse-sort-menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("browse-sort-button"));
    const menu = screen.getByTestId("browse-sort-menu");
    // Scope text lookups to the menu so we don't collide with the button label
    expect(menu).toHaveTextContent("Created (newest)");
    expect(menu).toHaveTextContent("Name (A-Z)");
    expect(menu).toHaveTextContent("Duration");
    expect(menu).toHaveTextContent("BPM");
    expect(menu).toHaveTextContent("Score");
  });

  it("selecting a new sort field calls onSort with its default direction", () => {
    const { onSort } = setup({ sortField: "path", sortDirection: "asc" });
    fireEvent.click(screen.getByTestId("browse-sort-button"));
    fireEvent.click(screen.getByText("Created (newest)"));
    expect(onSort).toHaveBeenCalledWith("created_at", "desc");
  });

  it("selecting the already-active field toggles the direction", () => {
    const { onSort } = setup({ sortField: "path", sortDirection: "asc" });
    fireEvent.click(screen.getByTestId("browse-sort-button"));
    // "Name (A-Z)" appears both in the button label and the menu option.
    // Scope the query to the menu so we click the option, not the button.
    const menu = screen.getByTestId("browse-sort-menu");
    const option = Array.from(menu.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Name (A-Z)")
    );
    expect(option).toBeTruthy();
    fireEvent.click(option!);
    expect(onSort).toHaveBeenCalledWith("path", "desc");
  });

  it("closes menu after selection", () => {
    setup();
    fireEvent.click(screen.getByTestId("browse-sort-button"));
    fireEvent.click(screen.getByText("Score"));
    expect(screen.queryByTestId("browse-sort-menu")).not.toBeInTheDocument();
  });

  it("closes menu when clicking outside", () => {
    setup();
    fireEvent.click(screen.getByTestId("browse-sort-button"));
    expect(screen.getByTestId("browse-sort-menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("browse-sort-menu")).not.toBeInTheDocument();
  });
});
