/**
 * Derives 8 normalized [0,1] perceptual attributes from Sample analysis fields.
 * Null-honest: returns null for any attribute whose source data is missing.
 */

import type { Sample } from "../api/types";

export interface PerceptualAttributes {
  brightness: number | null;
  energy: number | null;
  percussiveness: number | null;
  tonality: number | null;
  complexity: number | null;
  attack: number | null;
  width: number | null;
  regularity: number | null;
}

export interface AttrDef {
  key: keyof PerceptualAttributes;
  label: string;
  shortLabel: string;
}

export const ATTR_DEFS: AttrDef[] = [
  { key: "brightness", label: "Brightness", shortLabel: "BRI" },
  { key: "energy", label: "Energy", shortLabel: "NRG" },
  { key: "percussiveness", label: "Percussiveness", shortLabel: "PER" },
  { key: "tonality", label: "Tonality", shortLabel: "TON" },
  { key: "complexity", label: "Complexity", shortLabel: "CMP" },
  { key: "attack", label: "Attack", shortLabel: "ATK" },
  { key: "width", label: "Stereo Width", shortLabel: "WID" },
  { key: "regularity", label: "Regularity", shortLabel: "REG" },
];

/** Category color palette for sample_type values. */
export const CATEGORY_COLORS: Record<string, string> = {
  kick: "#ff3e3e",
  snare: "#ff9f1c",
  hihat: "#f5e663",
  clap: "#e85d9a",
  perc: "#c77dff",
  bass: "#3e8bff",
  synth: "#00e5a0",
  pad: "#00b4d8",
  vocal: "#ff6b9d",
  ambient: "#8ecae6",
  fx: "#b8b8ff",
  loop: "#95d5b2",
  lead: "#00e5a0",
  tom: "#c77dff",
  cymbal: "#f5e663",
  hat: "#f5e663",
  ride: "#f5e663",
  shaker: "#c77dff",
  noise: "#8ecae6",
  texture: "#8ecae6",
  oneshot: "#b8b8ff",
};

const DEFAULT_COLOR = "#666666";

export function getCategoryColor(sampleType: string | null): string {
  if (!sampleType) return DEFAULT_COLOR;
  const key = sampleType.toLowerCase().replace(/[^a-z]/g, "");
  return CATEGORY_COLORS[key] ?? DEFAULT_COLOR;
}

/** Clamp a value to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Log-normalize a Hz value from [minHz, maxHz] to [0, 1]. */
function logNormalize(hz: number, minHz: number, maxHz: number): number {
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  return clamp01((Math.log(hz) - logMin) / (logMax - logMin));
}

/** Linear map from [srcMin, srcMax] to [0, 1]. */
function linearNormalize(value: number, srcMin: number, srcMax: number): number {
  return clamp01((value - srcMin) / (srcMax - srcMin));
}

/**
 * Derive perceptual attributes from a Sample.
 * Returns null for any attribute whose source fields are missing.
 */
export function derivePerceptualAttributes(sample: Sample): PerceptualAttributes {
  // brightness: spectral_centroid log-normalized [100, 8000] Hz
  const brightness =
    sample.spectral_centroid !== null
      ? logNormalize(sample.spectral_centroid, 100, 8000)
      : null;

  // energy: rms_db mapped [-60, 0] dB
  const energy =
    sample.rms_db !== null ? linearNormalize(sample.rms_db, -60, 0) : null;

  // percussiveness: crest_factor mapped [3, 20] dB
  const percussiveness =
    sample.crest_factor !== null
      ? linearNormalize(sample.crest_factor, 3, 20)
      : null;

  // tonality: 1 - spectral_flatness (flatness 0 = tonal, 1 = noise)
  const tonality =
    sample.spectral_flatness !== null
      ? clamp01(1 - sample.spectral_flatness)
      : null;

  // complexity: dynamic_range mapped [0, 40] dB
  const complexity =
    sample.dynamic_range !== null
      ? linearNormalize(sample.dynamic_range, 0, 40)
      : null;

  // attack: composite of crest_factor + short duration = high attack
  let attack: number | null = null;
  if (sample.crest_factor !== null && sample.duration !== null) {
    const crestNorm = linearNormalize(sample.crest_factor, 3, 20);
    const durationFactor = clamp01(1 - sample.duration / 2); // <2s → high
    attack = clamp01(crestNorm * 0.6 + durationFactor * 0.4);
  }

  // width: stereo=0.7, mono=0.3
  const width = sample.channels !== null ? (sample.channels >= 2 ? 0.7 : 0.3) : null;

  // regularity: loop_quality direct or boolean fallback
  let regularity: number | null = null;
  if (sample.loop_quality !== null) {
    regularity = clamp01(sample.loop_quality);
  } else if (sample.is_loopable !== null) {
    regularity = sample.is_loopable ? 0.7 : 0.3;
  }

  return {
    brightness,
    energy,
    percussiveness,
    tonality,
    complexity,
    attack,
    width,
    regularity,
  };
}

/**
 * Returns 0-1 fraction of non-null analysis source fields.
 * Checks the 8 source fields used for perceptual attributes.
 */
export function getAnalysisCoverage(sample: Sample): number {
  const fields: (keyof Sample)[] = [
    "spectral_centroid",
    "rms_db",
    "crest_factor",
    "spectral_flatness",
    "dynamic_range",
    "duration",
    "channels",
    "loop_quality",
  ];
  const nonNull = fields.filter((f) => sample[f] !== null && sample[f] !== undefined).length;
  return nonNull / fields.length;
}

/**
 * Count how many non-null attributes a derived PerceptualAttributes has.
 */
export function countNonNullAttrs(attrs: PerceptualAttributes): number {
  return ATTR_DEFS.filter((d) => attrs[d.key] !== null).length;
}
