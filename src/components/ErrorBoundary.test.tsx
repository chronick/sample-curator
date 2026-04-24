import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// Component that throws during render
function ThrowingComponent({ message }: { message: string }): ReactNode {
  throw new Error(message);
  return null;
}

describe("ErrorBoundary", () => {
  // Suppress console.error from React error boundary logging
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders error message when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="test error" />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("test error")).toBeInTheDocument();
  });

  it("displays error in a pre tag", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="formatted error" />
      </ErrorBoundary>
    );
    const pre = screen.getByText("formatted error");
    expect(pre.tagName).toBe("PRE");
  });

  it("logs error to console", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="logged error" />
      </ErrorBoundary>
    );
    expect(console.error).toHaveBeenCalled();
  });
});
