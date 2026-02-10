import { describe, it, expect } from "vitest";
import {
  derivePerceptualAttributes,
  getCategoryColor,
  getAnalysisCoverage,
  countNonNullAttrs,
  CATEGORY_COLORS,
  ATTR_DEFS,
} from "./perceptualAttributes";
import type { Sample } from "../api/types";

/** Helper to create a mock sample with all nullable fields set to null. */
function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: 1,
    path: "/samples/kick.wav",
    source_type: "imported",
    sample_type: "kick",
    bpm: 120,
    key: "C",
    duration: null,
    sample_rate: 44100,
    channels: null,
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

describe("derivePerceptualAttributes", () => {
  it("returns all null for sample with no analysis data", () => {
    const attrs = derivePerceptualAttributes(makeSample());
    expect(attrs.brightness).toBeNull();
    expect(attrs.energy).toBeNull();
    expect(attrs.percussiveness).toBeNull();
    expect(attrs.tonality).toBeNull();
    expect(attrs.complexity).toBeNull();
    expect(attrs.attack).toBeNull();
    expect(attrs.width).toBeNull();
    expect(attrs.regularity).toBeNull();
  });

  it("derives brightness from spectral_centroid", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ spectral_centroid: 4000 })
    );
    expect(attrs.brightness).toBeGreaterThan(0);
    expect(attrs.brightness).toBeLessThanOrEqual(1);
  });

  it("brightness is 0 at 100 Hz", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ spectral_centroid: 100 })
    );
    expect(attrs.brightness).toBeCloseTo(0, 1);
  });

  it("brightness is 1 at 8000 Hz", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ spectral_centroid: 8000 })
    );
    expect(attrs.brightness).toBeCloseTo(1, 1);
  });

  it("derives energy from rms_db", () => {
    const attrs = derivePerceptualAttributes(makeSample({ rms_db: -30 }));
    expect(attrs.energy).toBeCloseTo(0.5, 1);
  });

  it("energy is 0 at -60 dB", () => {
    const attrs = derivePerceptualAttributes(makeSample({ rms_db: -60 }));
    expect(attrs.energy).toBeCloseTo(0, 1);
  });

  it("energy is 1 at 0 dB", () => {
    const attrs = derivePerceptualAttributes(makeSample({ rms_db: 0 }));
    expect(attrs.energy).toBeCloseTo(1, 1);
  });

  it("derives percussiveness from crest_factor", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ crest_factor: 11.5 })
    );
    expect(attrs.percussiveness).toBeCloseTo(0.5, 1);
  });

  it("derives tonality from spectral_flatness", () => {
    // flatness=0 → tonal → tonality=1
    const tonal = derivePerceptualAttributes(
      makeSample({ spectral_flatness: 0 })
    );
    expect(tonal.tonality).toBeCloseTo(1, 1);

    // flatness=1 → noise → tonality=0
    const noisy = derivePerceptualAttributes(
      makeSample({ spectral_flatness: 1 })
    );
    expect(noisy.tonality).toBeCloseTo(0, 1);
  });

  it("derives complexity from dynamic_range", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ dynamic_range: 20 })
    );
    expect(attrs.complexity).toBeCloseTo(0.5, 1);
  });

  it("derives attack from crest_factor + duration", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ crest_factor: 20, duration: 0.1 })
    );
    expect(attrs.attack).toBeGreaterThan(0.5);
    expect(attrs.attack).toBeLessThanOrEqual(1);
  });

  it("attack is null when crest_factor is missing", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ duration: 0.1 })
    );
    expect(attrs.attack).toBeNull();
  });

  it("attack is null when duration is missing", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ crest_factor: 10 })
    );
    expect(attrs.attack).toBeNull();
  });

  it("derives width from channels", () => {
    const stereo = derivePerceptualAttributes(makeSample({ channels: 2 }));
    expect(stereo.width).toBe(0.7);

    const mono = derivePerceptualAttributes(makeSample({ channels: 1 }));
    expect(mono.width).toBe(0.3);
  });

  it("derives regularity from loop_quality", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ loop_quality: 0.8 })
    );
    expect(attrs.regularity).toBe(0.8);
  });

  it("falls back to is_loopable for regularity", () => {
    const loopable = derivePerceptualAttributes(
      makeSample({ is_loopable: true })
    );
    expect(loopable.regularity).toBe(0.7);

    const notLoopable = derivePerceptualAttributes(
      makeSample({ is_loopable: false })
    );
    expect(notLoopable.regularity).toBe(0.3);
  });

  it("clamps all values to [0, 1]", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({
        spectral_centroid: 100000, // way above 8000
        rms_db: 100, // way above 0
        crest_factor: 100, // way above 20
        dynamic_range: 100, // way above 40
        loop_quality: 5, // way above 1
        duration: 0.01,
        channels: 2,
        spectral_flatness: -1, // below 0
      })
    );
    expect(attrs.brightness).toBeLessThanOrEqual(1);
    expect(attrs.energy).toBeLessThanOrEqual(1);
    expect(attrs.percussiveness).toBeLessThanOrEqual(1);
    expect(attrs.complexity).toBeLessThanOrEqual(1);
    expect(attrs.regularity).toBeLessThanOrEqual(1);
    expect(attrs.attack).toBeLessThanOrEqual(1);
    expect(attrs.tonality).toBeLessThanOrEqual(1);
  });

  it("derives full attributes for fully-analyzed sample", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({
        spectral_centroid: 2000,
        rms_db: -20,
        crest_factor: 10,
        spectral_flatness: 0.3,
        dynamic_range: 15,
        duration: 0.5,
        channels: 2,
        loop_quality: 0.6,
      })
    );
    // All 8 attributes should be non-null numbers
    for (const def of ATTR_DEFS) {
      expect(attrs[def.key]).not.toBeNull();
      expect(typeof attrs[def.key]).toBe("number");
    }
  });
});

describe("getCategoryColor", () => {
  it("returns correct color for known types", () => {
    expect(getCategoryColor("kick")).toBe("#ff3e3e");
    expect(getCategoryColor("snare")).toBe("#ff9f1c");
    expect(getCategoryColor("hihat")).toBe("#f5e663");
    expect(getCategoryColor("bass")).toBe("#3e8bff");
  });

  it("is case-insensitive", () => {
    expect(getCategoryColor("KICK")).toBe("#ff3e3e");
    expect(getCategoryColor("Snare")).toBe("#ff9f1c");
  });

  it("strips non-alpha characters", () => {
    expect(getCategoryColor("hi-hat")).toBe("#f5e663");
  });

  it("returns default grey for unknown type", () => {
    expect(getCategoryColor("unknown")).toBe("#666666");
  });

  it("returns default grey for null", () => {
    expect(getCategoryColor(null)).toBe("#666666");
  });
});

describe("getAnalysisCoverage", () => {
  it("returns 0 when no analysis fields are set", () => {
    expect(getAnalysisCoverage(makeSample())).toBe(0);
  });

  it("returns 1 when all 8 analysis fields are set", () => {
    const coverage = getAnalysisCoverage(
      makeSample({
        spectral_centroid: 1000,
        rms_db: -20,
        crest_factor: 10,
        spectral_flatness: 0.5,
        dynamic_range: 15,
        duration: 1.0,
        channels: 2,
        loop_quality: 0.5,
      })
    );
    expect(coverage).toBe(1);
  });

  it("returns fractional coverage for partial analysis", () => {
    const coverage = getAnalysisCoverage(
      makeSample({
        rms_db: -20,
        duration: 1.0,
        channels: 2,
        spectral_centroid: 1000,
      })
    );
    expect(coverage).toBe(0.5);
  });
});

describe("countNonNullAttrs", () => {
  it("returns 0 for all-null attributes", () => {
    const attrs = derivePerceptualAttributes(makeSample());
    expect(countNonNullAttrs(attrs)).toBe(0);
  });

  it("returns 8 for fully-analyzed sample", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({
        spectral_centroid: 2000,
        rms_db: -20,
        crest_factor: 10,
        spectral_flatness: 0.3,
        dynamic_range: 15,
        duration: 0.5,
        channels: 2,
        loop_quality: 0.6,
      })
    );
    expect(countNonNullAttrs(attrs)).toBe(8);
  });

  it("returns partial count", () => {
    const attrs = derivePerceptualAttributes(
      makeSample({ rms_db: -20, channels: 2 })
    );
    expect(countNonNullAttrs(attrs)).toBe(2);
  });
});

describe("ATTR_DEFS", () => {
  it("has 8 attribute definitions", () => {
    expect(ATTR_DEFS).toHaveLength(8);
  });

  it("each has key, label, and shortLabel", () => {
    for (const def of ATTR_DEFS) {
      expect(def.key).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.shortLabel).toBeTruthy();
    }
  });
});

describe("CATEGORY_COLORS", () => {
  it("has entries for common sample types", () => {
    const expectedTypes = [
      "kick", "snare", "hihat", "clap", "perc", "bass",
      "synth", "pad", "vocal", "ambient", "fx", "loop",
    ];
    for (const type of expectedTypes) {
      expect(CATEGORY_COLORS[type]).toBeDefined();
    }
  });
});
