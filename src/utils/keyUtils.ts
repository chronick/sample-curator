/**
 * Key/pitch utilities for the Spectral Color Wheel.
 * Maps musical keys to hue angles on a chromatic circle.
 */

/** Chromatic note hues: C at 0 degrees, each semitone +30 degrees. */
export const NOTE_HUES: Record<string, number> = {
  C: 0,
  "C#": 30,
  Db: 30,
  D: 60,
  "D#": 90,
  Eb: 90,
  E: 120,
  F: 150,
  "F#": 180,
  Gb: 180,
  G: 210,
  "G#": 240,
  Ab: 240,
  A: 270,
  "A#": 300,
  Bb: 300,
  B: 330,
};

/** All 12 canonical note names for display around the wheel. */
export const CHROMATIC_NOTES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export interface ParsedKey {
  root: string;
  mode: "major" | "minor";
}

/**
 * Parse a key string like "Am", "C# minor", "Bb major", "D" into root + mode.
 * Returns null if the key cannot be parsed.
 */
export function parseKey(key: string | null): ParsedKey | null {
  if (!key) return null;

  const trimmed = key.trim();
  // Match patterns like "Am", "A minor", "A min", "A", "C#m", "C# major", "Bbm"
  const match = trimmed.match(
    /^([A-G][#b]?)\s*(m|min|minor|maj|major|M)?$/i
  );
  if (!match) return null;

  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const modeStr = (match[2] || "").toLowerCase();
  const mode: "major" | "minor" =
    modeStr === "m" || modeStr === "min" || modeStr === "minor"
      ? "minor"
      : "major";

  // Verify root is valid
  if (!(root in NOTE_HUES)) return null;

  return { root, mode };
}

/** Get hue degrees for a key string. Returns null if key is unparseable. */
export function keyToHue(key: string | null): number | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  return NOTE_HUES[parsed.root] ?? null;
}

/** Get an HSL color string for a key. Returns grey for null/unparseable keys. */
export function keyToColor(key: string | null, saturation = 70, lightness = 55): string {
  const hue = keyToHue(key);
  if (hue === null) return `hsl(0, 0%, 40%)`;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/** Semitone index (0=C, 1=C#, ..., 11=B). */
function noteToSemitone(note: string): number | null {
  const idx = CHROMATIC_NOTES.indexOf(note as typeof CHROMATIC_NOTES[number]);
  if (idx >= 0) return idx;
  // Handle flats
  const flatMap: Record<string, number> = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };
  return flatMap[note] ?? null;
}

/** Major scale intervals in semitones. */
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
/** Natural minor scale intervals in semitones. */
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

/**
 * Get scale notes for a given root and mode.
 * Returns semitone indices (0-11) that belong to the scale.
 */
export function getScaleNotes(
  root: string,
  mode: "major" | "minor"
): number[] {
  const rootSemitone = noteToSemitone(root);
  if (rootSemitone === null) return [];
  const intervals = mode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  return intervals.map((i) => (rootSemitone + i) % 12);
}

/**
 * Check if a sample's key is compatible with a given filter key/mode.
 * Compatible means the sample's root note belongs to the filter scale.
 */
export function isKeyCompatible(
  sampleKey: string | null,
  filterKey: string,
  filterMode: "major" | "minor"
): boolean {
  const sampleParsed = parseKey(sampleKey);
  if (!sampleParsed) return false;

  const sampleSemitone = noteToSemitone(sampleParsed.root);
  if (sampleSemitone === null) return false;

  const scaleNotes = getScaleNotes(filterKey, filterMode);
  return scaleNotes.includes(sampleSemitone);
}
