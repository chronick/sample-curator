import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBreadcrumbs } from "./FilterBreadcrumbs";
import type { SearchFilters } from "../api/types";

const emptyFilters: SearchFilters = {
  query: "",
  tags: [],
  limit: 100,
  offset: 0,
};

describe("FilterBreadcrumbs", () => {
  const defaultProps = {
    filters: emptyFilters,
    onRemoveFilter: vi.fn(),
    onClearAll: vi.fn(),
  };

  it("returns null when no filters are active", () => {
    const { container } = render(<FilterBreadcrumbs {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders pill for min_bpm filter", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, min_bpm: 120 }}
      />
    );
    expect(screen.getByText("bpm: >120")).toBeInTheDocument();
  });

  it("renders pill for max_bpm filter", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, max_bpm: 140 }}
      />
    );
    expect(screen.getByText("bpm: <140")).toBeInTheDocument();
  });

  it("renders pill for min_score filter", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, min_score: 70 }}
      />
    );
    expect(screen.getByText("score: >70")).toBeInTheDocument();
  });

  it("renders pill for max_score filter", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, max_score: 90 }}
      />
    );
    expect(screen.getByText("score: <90")).toBeInTheDocument();
  });

  it("renders pill for pack_id filter", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, pack_id: 5 }}
      />
    );
    expect(screen.getByText("pack: 5")).toBeInTheDocument();
  });

  it("renders pill for each tag", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, tags: ["dark", "heavy"] }}
      />
    );
    expect(screen.getByText("tag: dark")).toBeInTheDocument();
    expect(screen.getByText("tag: heavy")).toBeInTheDocument();
  });

  it("renders pill for query", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, query: "kick" }}
      />
    );
    expect(screen.getByText('query: "kick"')).toBeInTheDocument();
  });

  it("calls onRemoveFilter when dismiss button clicked", () => {
    const onRemoveFilter = vi.fn();
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        onRemoveFilter={onRemoveFilter}
        filters={{ ...emptyFilters, min_bpm: 120 }}
      />
    );
    fireEvent.click(screen.getByLabelText("Remove bpm: >120 filter"));
    expect(onRemoveFilter).toHaveBeenCalledWith("min_bpm", undefined);
  });

  it("calls onRemoveFilter with tag value for tag pills", () => {
    const onRemoveFilter = vi.fn();
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        onRemoveFilter={onRemoveFilter}
        filters={{ ...emptyFilters, tags: ["dark"] }}
      />
    );
    fireEvent.click(screen.getByLabelText("Remove tag: dark filter"));
    expect(onRemoveFilter).toHaveBeenCalledWith("tags", "dark");
  });

  it("shows Clear All button when filters are active", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{ ...emptyFilters, min_bpm: 120 }}
      />
    );
    expect(screen.getByText("Clear All")).toBeInTheDocument();
  });

  it("calls onClearAll when Clear All clicked", () => {
    const onClearAll = vi.fn();
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        onClearAll={onClearAll}
        filters={{ ...emptyFilters, min_bpm: 120 }}
      />
    );
    fireEvent.click(screen.getByText("Clear All"));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("renders multiple pills for combined filters", () => {
    render(
      <FilterBreadcrumbs
        {...defaultProps}
        filters={{
          ...emptyFilters,
          min_bpm: 120,
          max_bpm: 140,
          tags: ["kick"],
          query: "deep",
        }}
      />
    );
    expect(screen.getByText("bpm: >120")).toBeInTheDocument();
    expect(screen.getByText("bpm: <140")).toBeInTheDocument();
    expect(screen.getByText("tag: kick")).toBeInTheDocument();
    expect(screen.getByText('query: "deep"')).toBeInTheDocument();
  });
});
