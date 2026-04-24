import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OllamaBanner } from "./OllamaBanner";
import type { OllamaStatusDict } from "../types/ollama";

function makeStatus(overrides: Partial<OllamaStatusDict> = {}): OllamaStatusDict {
  return {
    state: "not_loaded",
    model: null,
    available_models: [],
    error: null,
    ...overrides,
  };
}

describe("OllamaBanner", () => {
  it("renders nothing when state is loaded", () => {
    render(<OllamaBanner status={makeStatus({ state: "loaded", model: "gemma3:1b" })} onShowSettings={vi.fn()} />);
    expect(screen.queryByTestId("ollama-banner")).not.toBeInTheDocument();
  });

  it("renders nothing when state is loading", () => {
    render(<OllamaBanner status={makeStatus({ state: "loading" })} onShowSettings={vi.fn()} />);
    expect(screen.queryByTestId("ollama-banner")).not.toBeInTheDocument();
  });

  it("renders banner when state is not_loaded", () => {
    render(<OllamaBanner status={makeStatus({ state: "not_loaded" })} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("ollama-banner")).toBeInTheDocument();
    expect(screen.getByText(/vocal naming requires a local model/)).toBeInTheDocument();
  });

  it("renders banner with error message when state is errored", () => {
    render(<OllamaBanner status={makeStatus({ state: "errored", error: "daemon crash" })} onShowSettings={vi.fn()} />);
    expect(screen.getByTestId("ollama-banner")).toBeInTheDocument();
    expect(screen.getByText(/daemon crash/)).toBeInTheDocument();
  });

  it("falls back to 'unknown error' when errored with no error string", () => {
    render(<OllamaBanner status={makeStatus({ state: "errored", error: null })} onShowSettings={vi.fn()} />);
    expect(screen.getByText(/unknown error/)).toBeInTheDocument();
  });

  it("hides banner after dismiss button is clicked", () => {
    render(<OllamaBanner status={makeStatus({ state: "not_loaded" })} onShowSettings={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("ollama-banner")).not.toBeInTheDocument();
  });

  it("calls onShowSettings when Settings link is clicked", () => {
    const onShowSettings = vi.fn();
    render(<OllamaBanner status={makeStatus({ state: "not_loaded" })} onShowSettings={onShowSettings} />);
    fireEvent.click(screen.getByText("Settings"));
    expect(onShowSettings).toHaveBeenCalledOnce();
  });
});
