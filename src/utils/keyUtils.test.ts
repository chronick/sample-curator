import { describe, it, expect } from "vitest";
import {
  parseKey,
  keyToHue,
  keyToColor,
  getScaleNotes,
  isKeyCompatible,
  NOTE_HUES,
  CHROMATIC_NOTES,
} from "./keyUtils";

describe("parseKey", () => {
  it("parses simple major key (D)", () => {
    expect(parseKey("D")).toEqual({ root: "D", mode: "major" });
  });

  it("parses minor key with m suffix (Am)", () => {
    expect(parseKey("Am")).toEqual({ root: "A", mode: "minor" });
  });

  it("parses minor key with 'minor' suffix", () => {
    expect(parseKey("A minor")).toEqual({ root: "A", mode: "minor" });
  });

  it("parses minor key with 'min' suffix", () => {
    expect(parseKey("A min")).toEqual({ root: "A", mode: "minor" });
  });

  it("parses major key with 'major' suffix", () => {
    expect(parseKey("C major")).toEqual({ root: "C", mode: "major" });
  });

  it("parses major key with 'maj' suffix", () => {
    expect(parseKey("C maj")).toEqual({ root: "C", mode: "major" });
  });

  it("parses sharp key (C#)", () => {
    expect(parseKey("C#")).toEqual({ root: "C#", mode: "major" });
  });

  it("parses sharp minor key (C#m)", () => {
    expect(parseKey("C#m")).toEqual({ root: "C#", mode: "minor" });
  });

  it("parses flat key (Bb)", () => {
    expect(parseKey("Bb")).toEqual({ root: "Bb", mode: "major" });
  });

  it("parses flat major key (Bb major)", () => {
    expect(parseKey("Bb major")).toEqual({ root: "Bb", mode: "major" });
  });

  it("returns null for null input", () => {
    expect(parseKey(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseKey("")).toBeNull();
  });

  it("returns null for invalid strings", () => {
    expect(parseKey("X")).toBeNull();
    expect(parseKey("H minor")).toBeNull();
    expect(parseKey("123")).toBeNull();
    expect(parseKey("not a key")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseKey("  Am  ")).toEqual({ root: "A", mode: "minor" });
  });

  it("is case-insensitive for mode", () => {
    expect(parseKey("A Minor")).toEqual({ root: "A", mode: "minor" });
    expect(parseKey("C Major")).toEqual({ root: "C", mode: "major" });
  });
});

describe("keyToHue", () => {
  it("returns correct hue for all 12 chromatic notes", () => {
    expect(keyToHue("C")).toBe(0);
    expect(keyToHue("C#")).toBe(30);
    expect(keyToHue("D")).toBe(60);
    expect(keyToHue("D#")).toBe(90);
    expect(keyToHue("E")).toBe(120);
    expect(keyToHue("F")).toBe(150);
    expect(keyToHue("F#")).toBe(180);
    expect(keyToHue("G")).toBe(210);
    expect(keyToHue("G#")).toBe(240);
    expect(keyToHue("A")).toBe(270);
    expect(keyToHue("A#")).toBe(300);
    expect(keyToHue("B")).toBe(330);
  });

  it("handles enharmonic equivalents", () => {
    expect(keyToHue("C#")).toBe(keyToHue("Db"));
    expect(keyToHue("D#")).toBe(keyToHue("Eb"));
    expect(keyToHue("F#")).toBe(keyToHue("Gb"));
    expect(keyToHue("G#")).toBe(keyToHue("Ab"));
    expect(keyToHue("A#")).toBe(keyToHue("Bb"));
  });

  it("returns null for null/invalid", () => {
    expect(keyToHue(null)).toBeNull();
    expect(keyToHue("")).toBeNull();
    expect(keyToHue("X")).toBeNull();
  });

  it("ignores mode for hue calculation", () => {
    expect(keyToHue("Am")).toBe(270);
    expect(keyToHue("A")).toBe(270);
  });
});

describe("keyToColor", () => {
  it("returns HSL color for valid key", () => {
    expect(keyToColor("C")).toBe("hsl(0, 70%, 55%)");
    expect(keyToColor("A")).toBe("hsl(270, 70%, 55%)");
  });

  it("returns grey for null key", () => {
    expect(keyToColor(null)).toBe("hsl(0, 0%, 40%)");
  });

  it("returns grey for invalid key", () => {
    expect(keyToColor("invalid")).toBe("hsl(0, 0%, 40%)");
  });

  it("accepts custom saturation and lightness", () => {
    expect(keyToColor("C", 50, 60)).toBe("hsl(0, 50%, 60%)");
  });
});

describe("getScaleNotes", () => {
  it("returns C major scale notes", () => {
    const notes = getScaleNotes("C", "major");
    // C D E F G A B = semitones 0 2 4 5 7 9 11
    expect(notes).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("returns A minor scale notes", () => {
    const notes = getScaleNotes("A", "minor");
    // A B C D E F G = semitones 9 11 0 2 4 5 7
    expect(notes).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it("returns G major scale notes", () => {
    const notes = getScaleNotes("G", "major");
    // G A B C D E F# = semitones 7 9 11 0 2 4 6
    expect(notes).toEqual([7, 9, 11, 0, 2, 4, 6]);
  });

  it("returns empty array for invalid root", () => {
    expect(getScaleNotes("X", "major")).toEqual([]);
  });
});

describe("isKeyCompatible", () => {
  it("returns true for compatible keys (C in C major)", () => {
    expect(isKeyCompatible("C", "C", "major")).toBe(true);
  });

  it("returns true for G in C major (fifth)", () => {
    expect(isKeyCompatible("G", "C", "major")).toBe(true);
  });

  it("returns true for A minor in C major (relative minor)", () => {
    expect(isKeyCompatible("Am", "C", "major")).toBe(true);
  });

  it("returns false for incompatible keys (F# in C major)", () => {
    expect(isKeyCompatible("F#", "C", "major")).toBe(false);
  });

  it("returns false for null sample key", () => {
    expect(isKeyCompatible(null, "C", "major")).toBe(false);
  });

  it("returns false for invalid sample key", () => {
    expect(isKeyCompatible("invalid", "C", "major")).toBe(false);
  });
});

describe("NOTE_HUES", () => {
  it("has 17 entries (12 notes + 5 enharmonic flats)", () => {
    expect(Object.keys(NOTE_HUES)).toHaveLength(17);
  });
});

describe("CHROMATIC_NOTES", () => {
  it("has 12 notes", () => {
    expect(CHROMATIC_NOTES).toHaveLength(12);
  });

  it("starts with C and ends with B", () => {
    expect(CHROMATIC_NOTES[0]).toBe("C");
    expect(CHROMATIC_NOTES[11]).toBe("B");
  });
});
