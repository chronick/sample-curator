import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PackTree } from "./PackTree";
import type { Pack } from "../api/types";

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 1,
    name: "Techno Pack",
    path: "/samples/techno",
    source_type: "imported",
    vendor: null,
    sample_count: 50,
    avg_quality_score: null,
    created_at: "2024-01-01",
    ...overrides,
  };
}

describe("PackTree", () => {
  const defaultProps = {
    packs: [makePack()],
    typeCounts: [["kick", 100], ["snare", 50]] as Array<[string, number]>,
    totalSamples: 500,
    activeFilter: null,
    onFilterByType: vi.fn(),
    onFilterByPack: vi.fn(),
  };

  it("renders All Samples with total count", () => {
    render(<PackTree {...defaultProps} />);
    expect(screen.getByText("All Samples")).toBeInTheDocument();
    expect(screen.getByText("(500)")).toBeInTheDocument();
  });

  it("renders type counts", () => {
    render(<PackTree {...defaultProps} />);
    expect(screen.getByText(/Kick/)).toBeInTheDocument();
    expect(screen.getByText("(100)")).toBeInTheDocument();
    expect(screen.getByText(/Snare/)).toBeInTheDocument();
    expect(screen.getAllByText("(50)").length).toBeGreaterThanOrEqual(1);
  });

  it("renders pack names", () => {
    render(<PackTree {...defaultProps} />);
    expect(screen.getByText("Techno Pack")).toBeInTheDocument();
  });

  it("clicking All Samples clears both filters", () => {
    const onFilterByType = vi.fn();
    const onFilterByPack = vi.fn();
    render(
      <PackTree
        {...defaultProps}
        onFilterByType={onFilterByType}
        onFilterByPack={onFilterByPack}
      />
    );
    fireEvent.click(screen.getByText("All Samples"));
    expect(onFilterByType).toHaveBeenCalledWith(null);
    expect(onFilterByPack).toHaveBeenCalledWith(null);
  });

  it("clicking type calls onFilterByType with the type", () => {
    const onFilterByType = vi.fn();
    render(
      <PackTree {...defaultProps} onFilterByType={onFilterByType} />
    );
    fireEvent.click(screen.getByText(/Kick/));
    expect(onFilterByType).toHaveBeenCalledWith("kick");
  });

  it("clicking active type clears the filter", () => {
    const onFilterByType = vi.fn();
    render(
      <PackTree
        {...defaultProps}
        activeFilter={{ type: "kick" }}
        onFilterByType={onFilterByType}
      />
    );
    fireEvent.click(screen.getByText(/Kick/));
    expect(onFilterByType).toHaveBeenCalledWith(null);
  });

  it("clicking pack calls onFilterByPack with the pack id", () => {
    const onFilterByPack = vi.fn();
    render(
      <PackTree {...defaultProps} onFilterByPack={onFilterByPack} />
    );
    fireEvent.click(screen.getByText("Techno Pack"));
    expect(onFilterByPack).toHaveBeenCalledWith(1);
  });

  it("clicking active pack clears the filter", () => {
    const onFilterByPack = vi.fn();
    render(
      <PackTree
        {...defaultProps}
        activeFilter={{ packId: 1 }}
        onFilterByPack={onFilterByPack}
      />
    );
    fireEvent.click(screen.getByText("Techno Pack"));
    expect(onFilterByPack).toHaveBeenCalledWith(null);
  });

  it("applies active styling to active type filter", () => {
    render(
      <PackTree {...defaultProps} activeFilter={{ type: "kick" }} />
    );
    const kickBtn = screen.getByText(/Kick/).closest("button")!;
    expect(kickBtn.className).toContain("text-accent");
  });

  it("applies active styling to All Samples when no filter", () => {
    render(<PackTree {...defaultProps} activeFilter={null} />);
    const allBtn = screen.getByText("All Samples").closest("button")!;
    expect(allBtn.className).toContain("text-accent");
  });

  it("collapses By Type section when header clicked", () => {
    render(<PackTree {...defaultProps} />);
    // Types are initially visible
    expect(screen.getByText(/Kick/)).toBeInTheDocument();
    // Click "By Type" header to collapse
    fireEvent.click(screen.getByText("By Type"));
    expect(screen.queryByText(/Kick/)).toBeNull();
  });

  it("collapses By Pack section when header clicked", () => {
    render(<PackTree {...defaultProps} />);
    expect(screen.getByText("Techno Pack")).toBeInTheDocument();
    fireEvent.click(screen.getByText("By Pack"));
    expect(screen.queryByText("Techno Pack")).toBeNull();
  });

  it("formats large counts with k suffix", () => {
    render(
      <PackTree
        {...defaultProps}
        totalSamples={15000}
        typeCounts={[["kick", 2500]]}
      />
    );
    expect(screen.getByText("(15k)")).toBeInTheDocument();
    expect(screen.getByText("(2.5k)")).toBeInTheDocument();
  });
});
