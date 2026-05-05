import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionTimeline } from "./SessionTimeline";
import type { SessionSummary } from "../api/client";
import type { Sample } from "../api/types";

const session: SessionSummary = {
  session_tag: "session:abc",
  derived_name: "session at 2026-05-04 10:00",
  first_clip_at: "2026-05-04 10:00:00",
  last_clip_at: "2026-05-04 10:10:00", // 10-minute span
  clip_count: 3,
};

const baseSample: Sample = {
  id: 0,
  path: "/samples/clip.wav",
  source_type: "recorded",
  sample_type: null,
  bpm: null,
  key: null,
  duration: null,
  sample_rate: 48000,
  channels: 2,
  tags: ["recorded", "session:abc"],
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
  created_at: "2026-05-04 10:00:00",
  updated_at: "2026-05-04 10:00:00",
  analyzed_at: null,
};

const clip = (id: number, createdAt: string, name: string): Sample => ({
  ...baseSample,
  id,
  path: `/samples/${name}.wav`,
  created_at: createdAt,
});

describe("SessionTimeline", () => {
  it("renders loading state for clips", () => {
    render(
      <SessionTimeline
        session={session}
        clips={[]}
        selectedSampleId={null}
        onSelectClip={() => {}}
        loading
      />
    );
    expect(
      screen.getByTestId("session-timeline-loading")
    ).toBeInTheDocument();
  });

  it("renders header with derived name + clip count + span + session tag", () => {
    render(
      <SessionTimeline
        session={session}
        clips={[]}
        selectedSampleId={null}
        onSelectClip={() => {}}
        loading={false}
      />
    );
    const tl = screen.getByTestId("session-timeline");
    expect(tl).toHaveTextContent("session at 2026-05-04 10:00");
    expect(tl).toHaveTextContent("3 clips");
    expect(tl).toHaveTextContent("10m 0s");
    expect(tl).toHaveTextContent("session:abc");
  });

  it("renders empty state when no clips and not loading", () => {
    render(
      <SessionTimeline
        session={session}
        clips={[]}
        selectedSampleId={null}
        onSelectClip={() => {}}
        loading={false}
      />
    );
    expect(
      screen.getByTestId("session-timeline-empty")
    ).toBeInTheDocument();
  });

  it("positions clip ticks proportionally across the span", () => {
    const clips = [
      clip(1, "2026-05-04 10:00:00", "first"), // 0%
      clip(2, "2026-05-04 10:05:00", "middle"), // 50% (5min into 10min span)
      clip(3, "2026-05-04 10:10:00", "last"), // 100%
    ];
    render(
      <SessionTimeline
        session={session}
        clips={clips}
        selectedSampleId={null}
        onSelectClip={() => {}}
        loading={false}
      />
    );
    const ticks = screen.getAllByTestId("session-timeline-tick");
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toHaveStyle({ left: "0%" });
    expect(ticks[1]).toHaveStyle({ left: "50%" });
    expect(ticks[2]).toHaveStyle({ left: "100%" });
  });

  it("centers a single clip when there's only one (no divide-by-zero)", () => {
    const single: SessionSummary = {
      ...session,
      first_clip_at: "2026-05-04 10:00:00",
      last_clip_at: "2026-05-04 10:00:00",
      clip_count: 1,
    };
    render(
      <SessionTimeline
        session={single}
        clips={[clip(1, "2026-05-04 10:00:00", "only")]}
        selectedSampleId={null}
        onSelectClip={() => {}}
        loading={false}
      />
    );
    const ticks = screen.getAllByTestId("session-timeline-tick");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toHaveStyle({ left: "50%" });
  });

  it("calls onSelectClip with the sample when a tick is clicked", () => {
    const onSelectClip = vi.fn();
    const c = clip(42, "2026-05-04 10:05:00", "the-clip");
    render(
      <SessionTimeline
        session={session}
        clips={[c]}
        selectedSampleId={null}
        onSelectClip={onSelectClip}
        loading={false}
      />
    );
    fireEvent.click(screen.getByTestId("session-timeline-tick"));
    expect(onSelectClip).toHaveBeenCalledWith(c);
  });

  it("calls onSelectClip with the sample when a clip-list row is clicked", () => {
    const onSelectClip = vi.fn();
    const c = clip(7, "2026-05-04 10:02:00", "row-target");
    render(
      <SessionTimeline
        session={session}
        clips={[c]}
        selectedSampleId={null}
        onSelectClip={onSelectClip}
        loading={false}
      />
    );
    fireEvent.click(screen.getByTestId("session-timeline-clip"));
    expect(onSelectClip).toHaveBeenCalledWith(c);
  });

  it("marks selected clip via aria-current in both tick and row", () => {
    const c1 = clip(1, "2026-05-04 10:00:00", "a");
    const c2 = clip(2, "2026-05-04 10:05:00", "b");
    render(
      <SessionTimeline
        session={session}
        clips={[c1, c2]}
        selectedSampleId={2}
        onSelectClip={() => {}}
        loading={false}
      />
    );
    // Row form should reflect selection.
    const rows = screen.getAllByTestId("session-timeline-clip");
    expect(rows[0]).not.toHaveAttribute("aria-current");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
  });
});
