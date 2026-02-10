import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreIndicator } from "./ScoreIndicator";

describe("ScoreIndicator", () => {
  it("renders dash for null score", () => {
    render(<ScoreIndicator score={null} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("renders score number by default", () => {
    render(<ScoreIndicator score={85} />);
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("rounds score to integer", () => {
    render(<ScoreIndicator score={72.6} />);
    expect(screen.getByText("73")).toBeInTheDocument();
  });

  it("hides number when showNumber is false", () => {
    const { container } = render(
      <ScoreIndicator score={85} showNumber={false} />
    );
    expect(screen.queryByText("85")).toBeNull();
    // Bar should still be rendered
    expect(container.querySelector("div[style]")).toBeTruthy();
  });

  it("applies high score color class for score >= 70", () => {
    const { container } = render(<ScoreIndicator score={85} />);
    const scoreText = screen.getByText("85");
    expect(scoreText.className).toContain("text-score-high");
    const bar = container.querySelector("div[style]")!;
    expect(bar.className).toContain("bg-score-high");
  });

  it("applies medium score color class for score 40-69", () => {
    const { container } = render(<ScoreIndicator score={55} />);
    const scoreText = screen.getByText("55");
    expect(scoreText.className).toContain("text-score-medium");
    const bar = container.querySelector("div[style]")!;
    expect(bar.className).toContain("bg-score-medium");
  });

  it("applies low score color class for score < 40", () => {
    const { container } = render(<ScoreIndicator score={20} />);
    const scoreText = screen.getByText("20");
    expect(scoreText.className).toContain("text-score-low");
    const bar = container.querySelector("div[style]")!;
    expect(bar.className).toContain("bg-score-low");
  });

  it("sets bar width to score percentage", () => {
    const { container } = render(<ScoreIndicator score={75} />);
    const bar = container.querySelector("div[style]") as HTMLElement;
    expect(bar.style.width).toBe("75%");
  });

  it("handles boundary score of exactly 70", () => {
    render(<ScoreIndicator score={70} />);
    const scoreText = screen.getByText("70");
    expect(scoreText.className).toContain("text-score-high");
  });

  it("handles boundary score of exactly 40", () => {
    render(<ScoreIndicator score={40} />);
    const scoreText = screen.getByText("40");
    expect(scoreText.className).toContain("text-score-medium");
  });

  it("handles zero score", () => {
    const { container } = render(<ScoreIndicator score={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    const bar = container.querySelector("div[style]") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });
});
