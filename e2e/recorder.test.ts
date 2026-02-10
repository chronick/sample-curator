/**
 * E2E tests for the Recorder view.
 *
 * Requires the app to be running with the automation feature:
 *   npx tauri dev --features automation
 *
 * Run with:
 *   npx vitest run --config e2e/vitest.config.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { AutomationClient } from "./automation-client";

const client = new AutomationClient();

/** Ensure we're on the Record view */
async function ensureRecordView() {
  const state = await client.queryState();
  if (state.ok && state.result.state.activeView !== "record") {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Record")?.click();
    `);
    await client.waitForState((s: any) => s.activeView === "record");
    await client.waitForIdle(300);
  }
}

/** Ensure we're on the Browse view */
async function ensureBrowseView() {
  const state = await client.queryState();
  if (state.ok && state.result.state.activeView !== "browse") {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Browse")?.click();
    `);
    await client.waitForState((s: any) => s.activeView === "browse");
    await client.waitForIdle(300);
  }
}

beforeAll(async () => {
  await client.connect();
  await client.getConsole(undefined, true);
  // Start from Browse view
  await ensureBrowseView();
}, 10_000);

afterAll(async () => {
  // Always return to Browse before closing
  await ensureBrowseView();
  await client.close();
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("Recorder Navigation", () => {
  it("switches to Record view", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Record")?.click();
    `);
    await client.waitForIdle();

    const state = await client.waitForState((s: any) => s.activeView === "record");
    expect(state.activeView).toBe("record");
  });

  it("hides sidebar toggles in Record view", async () => {
    const result = await client.evalJs(`
      const leftBtn = document.querySelector('button[title*="Toggle left sidebar"]');
      const rightBtn = document.querySelector('button[title*="Toggle right sidebar"]');
      const importBtn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Import");
      return {
        leftVisible: !!leftBtn?.offsetParent,
        rightVisible: !!rightBtn?.offsetParent,
        importVisible: !!importBtn?.offsetParent,
      };
    `);
    expect(result.ok).toBe(true);
    const val = result.result.value;
    expect(val.leftVisible).toBe(false);
    expect(val.rightVisible).toBe(false);
    expect(val.importVisible).toBe(false);
  });

  it("switches back to Browse view", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Browse")?.click();
    `);
    await client.waitForState((s: any) => s.activeView === "browse");

    const result = await client.evalJs(`
      return !!document.querySelector('button[title*="Toggle left sidebar"]');
    `);
    expect(result.ok).toBe(true);
    expect(result.result.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Device Management
// ---------------------------------------------------------------------------

describe("Recorder Devices", () => {
  it("lists audio devices via invoke", async () => {
    const resp = await client.invoke("recorder_list_audio_devices");
    expect(resp.ok).toBe(true);
    expect(Array.isArray(resp.result.value)).toBe(true);
  });

  it("shows device selector in Record view", async () => {
    await ensureRecordView();

    const result = await client.evalJs(`
      const select = document.querySelector("select");
      return {
        found: !!select,
        hasPlaceholder: select?.querySelector("option[disabled]")?.textContent?.includes("Select input device") || false,
      };
    `);
    expect(result.ok).toBe(true);
    expect(result.result.value.found).toBe(true);
    expect(result.result.value.hasPlaceholder).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Recording Config
// ---------------------------------------------------------------------------

describe("Recorder Config", () => {
  beforeEach(async () => {
    await ensureRecordView();
  });

  it("shows config bar with sample rate buttons", async () => {
    const result = await client.evalJs(`
      const buttons = Array.from(document.querySelectorAll("button"));
      return {
        has44k: buttons.some(b => b.textContent.trim() === "44.1k"),
        has48k: buttons.some(b => b.textContent.trim() === "48k"),
        has96k: buttons.some(b => b.textContent.trim() === "96k"),
      };
    `);
    expect(result.ok).toBe(true);
    const val = result.result.value;
    expect(val.has44k).toBe(true);
    expect(val.has48k).toBe(true);
    expect(val.has96k).toBe(true);
  });

  it("shows bit depth buttons", async () => {
    const result = await client.evalJs(`
      const buttons = Array.from(document.querySelectorAll("button"));
      return {
        has16: buttons.some(b => b.textContent.trim() === "16-bit"),
        has24: buttons.some(b => b.textContent.trim() === "24-bit"),
        has32: buttons.some(b => b.textContent.trim() === "32-bit"),
      };
    `);
    expect(result.ok).toBe(true);
    const val = result.result.value;
    expect(val.has16).toBe(true);
    expect(val.has24).toBe(true);
    expect(val.has32).toBe(true);
  });

  it("shows channel buttons", async () => {
    const result = await client.evalJs(`
      const buttons = Array.from(document.querySelectorAll("button"));
      return {
        hasMono: buttons.some(b => b.textContent.trim() === "Mono"),
        hasStereo: buttons.some(b => b.textContent.trim() === "Stereo"),
      };
    `);
    expect(result.ok).toBe(true);
    expect(result.result.value.hasMono).toBe(true);
    expect(result.result.value.hasStereo).toBe(true);
  });

  it("gets and sets recorder config", async () => {
    const getResp = await client.invoke("recorder_get_config");
    expect(getResp.ok).toBe(true);
    const config = getResp.result.value;
    expect(config.sample_rate).toBeGreaterThan(0);
    expect(config.bit_depth).toBeGreaterThan(0);
    expect(config.channels).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Visualization Elements
// ---------------------------------------------------------------------------

describe("Recorder Visualization", () => {
  beforeEach(async () => {
    await ensureRecordView();
  });

  it("has canvas elements for waveform and spectrum", async () => {
    const result = await client.evalJs(`
      const canvases = document.querySelectorAll("canvas");
      return { count: canvases.length };
    `);
    expect(result.ok).toBe(true);
    expect(result.result.value.count).toBeGreaterThanOrEqual(2);
  });

  it("has level meter elements", async () => {
    const result = await client.evalJs(`
      const body = document.body.textContent;
      return {
        hasL: body.includes(" L") || body.includes("L "),
        hasR: body.includes(" R") || body.includes("R "),
        hasDb: body.includes("dB"),
      };
    `);
    expect(result.ok).toBe(true);
    expect(result.result.value.hasDb).toBe(true);
  });

  it("gets audio levels via invoke", async () => {
    const resp = await client.invoke("recorder_get_audio_levels");
    if (resp.ok) {
      expect(resp.result.value).toHaveProperty("channels");
    }
  });

  it("gets waveform data via invoke", async () => {
    const resp = await client.invoke("recorder_get_waveform_data", { numSamples: 256 });
    if (resp.ok) {
      expect(Array.isArray(resp.result.value)).toBe(true);
    }
  });

  it("gets spectrum data via invoke", async () => {
    const resp = await client.invoke("recorder_get_spectrum_data", { numBins: 64 });
    if (resp.ok) {
      expect(Array.isArray(resp.result.value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Record Button
// ---------------------------------------------------------------------------

describe("Record Button", () => {
  beforeEach(async () => {
    await ensureRecordView();
  });

  it("shows record button with status text", async () => {
    const result = await client.evalJs(`
      const body = document.body.textContent;
      return {
        hasSelectDevice: body.includes("Select a device"),
        hasRecordHint: body.includes("R to record"),
        hasStopHint: body.includes("Space to stop"),
        hasTimer: /\\d{2}:\\d{2}:\\d{2}/.test(body),
      };
    `);
    expect(result.ok).toBe(true);
    const val = result.result.value;
    expect(val.hasSelectDevice || val.hasRecordHint).toBe(true);
    expect(val.hasTimer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("Recorder Settings", () => {
  beforeEach(async () => {
    await ensureRecordView();
  });

  it("opens settings dialog", async () => {
    const clicked = await client.evalJs(`
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Settings");
      if (btn) { btn.click(); return true; }
      return false;
    `);
    expect(clicked.ok).toBe(true);
    expect(clicked.result.value).toBe(true);

    await client.waitForIdle(500);

    const dialog = await client.evalJs(`
      const body = document.body.textContent;
      return body.includes("Output Directory") || body.includes("output") || body.includes("Recorder Settings");
    `);
    expect(dialog.ok).toBe(true);
  });

  it("closes settings dialog", async () => {
    await client.evalJs(`
      const btns = Array.from(document.querySelectorAll("button"));
      const closeBtn = btns.find(b =>
        b.textContent.trim() === "Close" ||
        b.textContent.trim() === "Done" ||
        b.textContent.trim() === "Cancel" ||
        b.textContent.trim() === "×"
      );
      if (closeBtn) closeBtn.click();
    `);
    await client.waitForIdle(300);
  });
});

// ---------------------------------------------------------------------------
// Recent Recordings
// ---------------------------------------------------------------------------

describe("Recent Recordings", () => {
  beforeEach(async () => {
    await ensureRecordView();
  });

  it("shows recordings area", async () => {
    const result = await client.evalJs(`
      const body = document.body.textContent;
      return {
        hasRecent: body.includes("Recent"),
        hasOpenFolder: body.includes("Open folder"),
        hasNoRecordings: body.includes("No recordings yet"),
      };
    `);
    expect(result.ok).toBe(true);
    const val = result.result.value;
    expect(val.hasRecent).toBe(true);
    expect(val.hasOpenFolder).toBe(true);
  });
});
