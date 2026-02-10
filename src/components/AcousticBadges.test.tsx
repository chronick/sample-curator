import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AcousticBadges } from "./AcousticBadges";

describe("AcousticBadges", () => {
  it("returns null for empty tags array", () => {
    const { container } = render(<AcousticBadges tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each tag", () => {
    render(<AcousticBadges tags={["dark", "heavy"]} />);
    expect(screen.getByText(/dark/)).toBeInTheDocument();
    expect(screen.getByText(/heavy/)).toBeInTheDocument();
  });

  it("renders tags in a flex container", () => {
    const { container } = render(<AcousticBadges tags={["dark"]} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("flex");
  });

  it("renders each tag as a badge with styling", () => {
    const { container } = render(<AcousticBadges tags={["dark"]} />);
    const badge = container.querySelector("span");
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain("rounded");
    expect(badge!.className).toContain("border");
  });
});
