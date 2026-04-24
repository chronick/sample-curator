import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { Sample, ViewMode } from "../api/types";
import type { Tab } from "../components/TabBar";

function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: 1,
    path: "/samples/kick.wav",
    source_type: "imported",
    sample_type: "kick",
    bpm: 120,
    key: "C",
    duration: 0.5,
    sample_rate: 44100,
    channels: 2,
    tags: [],
    rms_db: null,
    peak_db: null,
    crest_factor: null,
    dynamic_range: null,
    clipping_detected: null,
    spectral_centroid: null,
    spectral_flatness: null,
    loop_quality: null,
    is_loopable: null,
    quality_score: null,
    applicability_score: null,
    pack_id: null,
    pack_name: null,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    analyzed_at: null,
    ...overrides,
  };
}

function defaultConfig() {
  return {
    selectedSample: makeSample() as Sample | null,
    samples: [makeSample({ id: 1 }), makeSample({ id: 2 }), makeSample({ id: 3 })],
    isPlaying: false,
    currentSample: null as string | null,
    viewMode: "list" as ViewMode,
    tabs: [{ id: "tab-1", label: "All" }] as Tab[],
    activeTabId: "tab-1",
    activeView: "browse" as "browse" | "jobs" | "record",
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    selectSample: vi.fn(),
    refresh: vi.fn(),
    setViewMode: vi.fn(),
    addTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setShowLeft: vi.fn(),
    setShowRight: vi.fn(),
    setShowPlayer: vi.fn(),
    setShowImport: vi.fn(),
    setRightPanelMode: vi.fn(),
    setActiveView: vi.fn(),
  };
}

function fireKey(
  key: string,
  opts: Partial<KeyboardEventInit> = {}
) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useKeyboardShortcuts", () => {
  let config: ReturnType<typeof defaultConfig>;

  beforeEach(() => {
    config = defaultConfig();
  });

  it("Space plays selected sample when not playing", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey(" ");
    expect(config.play).toHaveBeenCalledWith("/samples/kick.wav");
  });

  it("Space pauses when playing the current sample", () => {
    config.isPlaying = true;
    config.currentSample = "/samples/kick.wav";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey(" ");
    expect(config.pause).toHaveBeenCalled();
  });

  it("Space resumes when paused on same sample", () => {
    config.isPlaying = false;
    config.currentSample = "/samples/kick.wav";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey(" ");
    expect(config.resume).toHaveBeenCalled();
  });

  it("Space does nothing when no sample selected", () => {
    config.selectedSample = null;
    renderHook(() => useKeyboardShortcuts(config));
    fireKey(" ");
    expect(config.play).not.toHaveBeenCalled();
    expect(config.pause).not.toHaveBeenCalled();
    expect(config.resume).not.toHaveBeenCalled();
  });

  it("ArrowDown selects next sample", () => {
    config.selectedSample = makeSample({ id: 1 });
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("ArrowDown");
    expect(config.selectSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 })
    );
  });

  it("ArrowDown does not go past last sample", () => {
    config.selectedSample = makeSample({ id: 3 });
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("ArrowDown");
    expect(config.selectSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 })
    );
  });

  it("ArrowUp selects previous sample", () => {
    config.selectedSample = makeSample({ id: 2 });
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("ArrowUp");
    expect(config.selectSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
  });

  it("ArrowUp does not go before first sample", () => {
    config.selectedSample = makeSample({ id: 1 });
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("ArrowUp");
    expect(config.selectSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
  });

  it("Cmd+B toggles left panel", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("b", { metaKey: true });
    expect(config.setShowLeft).toHaveBeenCalled();
  });

  it("Cmd+Shift+B toggles right panel", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("b", { metaKey: true, shiftKey: true });
    expect(config.setShowRight).toHaveBeenCalled();
  });

  it("g toggles list/grid", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("g");
    expect(config.setViewMode).toHaveBeenCalledWith("grid");
  });

  it("g from grid goes to list", () => {
    config.viewMode = "grid";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("g");
    expect(config.setViewMode).toHaveBeenCalledWith("list");
  });

  it("g from explore mode goes to list", () => {
    config.viewMode = "constellation";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("g");
    expect(config.setViewMode).toHaveBeenCalledWith("list");
  });

  it("v cycles through view modes", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("v");
    // list → grid
    expect(config.setViewMode).toHaveBeenCalledWith("grid");
  });

  it("Escape exits explore mode", () => {
    config.viewMode = "constellation";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("Escape");
    expect(config.setViewMode).toHaveBeenCalledWith("list");
  });

  it("Escape does nothing in non-explore mode", () => {
    config.viewMode = "list";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("Escape");
    expect(config.setViewMode).not.toHaveBeenCalled();
  });

  it("Cmd+1 switches to first tab", () => {
    config.tabs = [
      { id: "tab-1", label: "Tab 1" },
      { id: "tab-2", label: "Tab 2" },
    ] as Tab[];
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("1", { metaKey: true });
    expect(config.setActiveTab).toHaveBeenCalledWith("tab-1");
  });

  it("Cmd+2 switches to second tab", () => {
    config.tabs = [
      { id: "tab-1", label: "Tab 1" },
      { id: "tab-2", label: "Tab 2" },
    ] as Tab[];
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("2", { metaKey: true });
    expect(config.setActiveTab).toHaveBeenCalledWith("tab-2");
  });

  it("Cmd+9 does nothing with only 2 tabs", () => {
    config.tabs = [
      { id: "tab-1", label: "Tab 1" },
      { id: "tab-2", label: "Tab 2" },
    ] as Tab[];
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("9", { metaKey: true });
    expect(config.setActiveTab).not.toHaveBeenCalled();
  });

  it("shortcuts ignored when input is focused", () => {
    renderHook(() => useKeyboardShortcuts(config));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
    });
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);

    expect(config.play).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("cleans up event listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useKeyboardShortcuts(config));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("s sets right panel to similar mode", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("s");
    expect(config.setRightPanelMode).toHaveBeenCalledWith("similar");
  });

  it("p sets right panel to projects mode", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("p");
    expect(config.setRightPanelMode).toHaveBeenCalledWith("projects");
  });

  it("d sets right panel to duplicates mode", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("d");
    expect(config.setRightPanelMode).toHaveBeenCalledWith("duplicates");
  });

  it("Cmd+J toggles player panel", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("j", { metaKey: true });
    expect(config.setShowPlayer).toHaveBeenCalled();
  });

  it("Cmd+T adds a new tab", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("t", { metaKey: true });
    expect(config.addTab).toHaveBeenCalled();
  });

  it("Cmd+W closes current tab", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("w", { metaKey: true });
    expect(config.closeTab).toHaveBeenCalledWith("tab-1");
  });

  it("Cmd+R refreshes", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("r", { metaKey: true });
    expect(config.refresh).toHaveBeenCalled();
  });

  it("Cmd+I opens import", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("i", { metaKey: true });
    expect(config.setShowImport).toHaveBeenCalledWith(true);
  });

  it("Space does NOT trigger play/pause when activeView is record", () => {
    config.activeView = "record";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey(" ");
    expect(config.play).not.toHaveBeenCalled();
    expect(config.pause).not.toHaveBeenCalled();
    expect(config.resume).not.toHaveBeenCalled();
  });

  it("single-key shortcuts are ignored when activeView is record", () => {
    config.activeView = "record";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("g");
    expect(config.setViewMode).not.toHaveBeenCalled();
    fireKey("v");
    expect(config.setViewMode).not.toHaveBeenCalled();
    fireKey("s");
    expect(config.setRightPanelMode).not.toHaveBeenCalled();
    fireKey("d");
    expect(config.setRightPanelMode).not.toHaveBeenCalled();
    fireKey("p");
    expect(config.setRightPanelMode).not.toHaveBeenCalled();
  });

  it("Cmd+B still works when activeView is record", () => {
    config.activeView = "record";
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("b", { metaKey: true });
    expect(config.setShowLeft).toHaveBeenCalled();
  });

  it("Cmd+Shift+J toggles jobs view", () => {
    renderHook(() => useKeyboardShortcuts(config));
    fireKey("j", { metaKey: true, shiftKey: true });
    expect(config.setActiveView).toHaveBeenCalled();
  });
});
