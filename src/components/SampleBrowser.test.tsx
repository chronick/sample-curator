import { describe, it, expect } from "vitest";
import { formatRelativeTime, isFreshlyRecorded } from "./SampleBrowser";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-04-16T12:00:00Z");

  it('returns "-" for null/empty input', () => {
    expect(formatRelativeTime(null, now)).toBe("-");
    expect(formatRelativeTime("", now)).toBe("-");
  });

  it('returns "-" for unparseable input', () => {
    expect(formatRelativeTime("not a date", now)).toBe("-");
  });

  it('returns "just now" for ≤ 10 seconds ago', () => {
    expect(formatRelativeTime("2026-04-16T12:00:00Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-04-16T11:59:55Z", now)).toBe("just now");
  });

  it("returns seconds for < 60s", () => {
    expect(formatRelativeTime("2026-04-16T11:59:15Z", now)).toBe("45s ago");
  });

  it("returns minutes for < 60min", () => {
    expect(formatRelativeTime("2026-04-16T11:45:00Z", now)).toBe("15m ago");
  });

  it("returns hours for < 24h", () => {
    expect(formatRelativeTime("2026-04-16T05:00:00Z", now)).toBe("7h ago");
  });

  it("returns days for < 30d", () => {
    expect(formatRelativeTime("2026-04-12T12:00:00Z", now)).toBe("4d ago");
  });

  it("returns months for < 12mo", () => {
    expect(formatRelativeTime("2026-02-16T12:00:00Z", now)).toBe("1mo ago");
  });

  it("returns years for > 12mo", () => {
    expect(formatRelativeTime("2024-04-16T12:00:00Z", now)).toBe("2y ago");
  });

  it('returns "just now" for future timestamps (clock skew tolerance)', () => {
    expect(formatRelativeTime("2026-04-16T12:05:00Z", now)).toBe("just now");
  });
});

describe("isFreshlyRecorded", () => {
  const now = Date.parse("2026-04-16T12:00:00Z");

  it("returns true within 5 min window", () => {
    expect(isFreshlyRecorded("2026-04-16T11:58:00Z", now)).toBe(true);
    expect(isFreshlyRecorded("2026-04-16T12:00:00Z", now)).toBe(true);
  });

  it("returns false just past 5 min window", () => {
    expect(isFreshlyRecorded("2026-04-16T11:54:59Z", now)).toBe(false);
  });

  it("returns false for null/invalid input", () => {
    expect(isFreshlyRecorded(null, now)).toBe(false);
    expect(isFreshlyRecorded("not a date", now)).toBe(false);
  });

  it("returns false for future timestamps (clock skew)", () => {
    expect(isFreshlyRecorded("2026-04-16T12:01:00Z", now)).toBe(false);
  });
});
