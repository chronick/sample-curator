import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SplitDialog } from "./SplitDialog";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("SplitDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <SplitDialog
        sampleIds={[1, 2]}
        open={false}
        onClose={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders with sample count and default selections when open", () => {
    render(
      <SplitDialog
        sampleIds={[1, 2, 3]}
        open
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("split-dialog")).toBeInTheDocument();
    expect(screen.getByText(/3 samples will be split/i)).toBeInTheDocument();
    expect(screen.getByTestId("split-mode-silence")).toHaveClass("text-accent");
    expect(screen.getByTestId("split-dialog-submit")).toHaveTextContent(
      "Split 3"
    );
  });

  it("uses singular 'sample' for one selection", () => {
    render(
      <SplitDialog sampleIds={[42]} open onClose={() => {}} />
    );
    expect(screen.getByText(/^1 sample will be split/i)).toBeInTheDocument();
    expect(screen.getByTestId("split-dialog-submit")).toHaveTextContent(
      "Split 1"
    );
  });

  it("toggles mode between silence and changepoint", () => {
    render(
      <SplitDialog sampleIds={[1]} open onClose={() => {}} />
    );
    fireEvent.click(screen.getByTestId("split-mode-changepoint"));
    expect(screen.getByTestId("split-mode-changepoint")).toHaveClass(
      "text-accent"
    );
    expect(screen.getByTestId("split-mode-silence")).not.toHaveClass(
      "text-accent"
    );
  });

  it("calls split_samples with selected mode + min secs + delete_source flag", async () => {
    mockInvoke.mockResolvedValueOnce({
      job_id: "abc-123",
      total_samples: 2,
    });
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(
      <SplitDialog
        sampleIds={[10, 20]}
        open
        onClose={onClose}
        onSubmitted={onSubmitted}
      />
    );
    fireEvent.click(screen.getByTestId("split-mode-changepoint"));
    fireEvent.change(screen.getByLabelText(/min chunk length/i), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByTestId("split-delete-source"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("split-dialog-submit"));
    });

    expect(mockInvoke).toHaveBeenCalledWith("split_samples", {
      sampleIds: [10, 20],
      params: {
        mode: "changepoint",
        min_chunk_secs: 2.5,
        delete_source: true,
      },
    });
    expect(onSubmitted).toHaveBeenCalledWith("abc-123", 2);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows backend error and stays open on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("DB locked"));
    const onClose = vi.fn();
    render(
      <SplitDialog
        sampleIds={[1]}
        open
        onClose={onClose}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("split-dialog-submit"));
    });
    expect(screen.getByTestId("split-dialog-error")).toHaveTextContent(
      /DB locked/
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel calls onClose without invoking backend", () => {
    const onClose = vi.fn();
    render(
      <SplitDialog sampleIds={[1]} open onClose={onClose} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
