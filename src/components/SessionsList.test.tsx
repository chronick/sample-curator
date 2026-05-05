import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionsList } from "./SessionsList";
import type { SessionSummary, CurrentSessionContext } from "../api/client";

const session = (
  overrides: Partial<SessionSummary> = {}
): SessionSummary => ({
  session_tag: "session:default-uuid",
  derived_name: "session at 2026-05-04 10:00",
  first_clip_at: "2026-05-04 10:00:00",
  last_clip_at: "2026-05-04 10:05:00",
  clip_count: 5,
  ...overrides,
});

const armed = (sessionTag: string): CurrentSessionContext => ({
  session_tag: sessionTag,
  started_at: "2026-05-05T15:30:00Z",
  stem_separation_enabled: false,
});

describe("SessionsList", () => {
  it("renders loading placeholder while fetching", () => {
    render(
      <SessionsList
        sessions={[]}
        activeSession={null}
        selectedTag={null}
        onSelect={() => {}}
        loading
      />
    );
    expect(screen.getByTestId("sessions-list-loading")).toBeInTheDocument();
  });

  it("renders empty state when no sessions and no active arm", () => {
    render(
      <SessionsList
        sessions={[]}
        activeSession={null}
        selectedTag={null}
        onSelect={() => {}}
        loading={false}
      />
    );
    expect(screen.getByTestId("sessions-list-empty")).toBeInTheDocument();
  });

  it("renders one row per session, ordered as given (desc by start)", () => {
    const sessions = [
      session({ session_tag: "session:a", derived_name: "newer" }),
      session({ session_tag: "session:b", derived_name: "older" }),
    ];
    render(
      <SessionsList
        sessions={sessions}
        activeSession={null}
        selectedTag={null}
        onSelect={() => {}}
        loading={false}
      />
    );
    const rows = screen.getAllByTestId("sessions-list-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("newer");
    expect(rows[1]).toHaveTextContent("older");
  });

  it("calls onSelect with session_tag when row clicked", () => {
    const onSelect = vi.fn();
    render(
      <SessionsList
        sessions={[session({ session_tag: "session:abc" })]}
        activeSession={null}
        selectedTag={null}
        onSelect={onSelect}
        loading={false}
      />
    );
    fireEvent.click(screen.getByTestId("sessions-list-row").querySelector("button")!);
    expect(onSelect).toHaveBeenCalledWith("session:abc");
  });

  it("highlights the selected row via aria-current", () => {
    render(
      <SessionsList
        sessions={[
          session({ session_tag: "session:a" }),
          session({ session_tag: "session:b", derived_name: "second" }),
        ]}
        activeSession={null}
        selectedTag="session:b"
        onSelect={() => {}}
        loading={false}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).not.toHaveAttribute("aria-current");
    expect(buttons[1]).toHaveAttribute("aria-current", "true");
  });

  it("renders active-session placeholder when armed with no clips yet", () => {
    render(
      <SessionsList
        sessions={[]}
        activeSession={armed("session:in-progress")}
        selectedTag={null}
        onSelect={() => {}}
        loading={false}
      />
    );
    const placeholder = screen.getByTestId("sessions-list-active-placeholder");
    expect(placeholder).toHaveTextContent("In progress");
    expect(placeholder).toHaveTextContent("0 clips");
    expect(placeholder).toHaveTextContent("session:in-progress");
  });

  it("does NOT render placeholder when active session already has clips in list", () => {
    const tag = "session:already-has-clips";
    render(
      <SessionsList
        sessions={[session({ session_tag: tag, clip_count: 2 })]}
        activeSession={armed(tag)}
        selectedTag={null}
        onSelect={() => {}}
        loading={false}
      />
    );
    expect(
      screen.queryByTestId("sessions-list-active-placeholder")
    ).not.toBeInTheDocument();
  });

  it("renders 'clip' singular at count 1 and 'clips' plural otherwise", () => {
    render(
      <SessionsList
        sessions={[
          session({ session_tag: "session:one", clip_count: 1 }),
          session({ session_tag: "session:many", clip_count: 7 }),
        ]}
        activeSession={null}
        selectedTag={null}
        onSelect={() => {}}
        loading={false}
      />
    );
    const rows = screen.getAllByTestId("sessions-list-row");
    expect(rows[0]).toHaveTextContent("1 clip");
    expect(rows[1]).toHaveTextContent("7 clips");
  });
});
