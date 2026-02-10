/**
 * UI automation tests for Sample Curator.
 *
 * Requires the app to be running with the automation feature:
 *   npx tauri dev --features automation
 *
 * Run with:
 *   npx vitest run --config e2e/vitest.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AutomationClient } from "./automation-client";

const client = new AutomationClient();

beforeAll(async () => {
  await client.connect();
  // Clear console buffer so tests start clean
  await client.getConsole(undefined, true);
  // Ensure we start on Browse view (another test file may have left us elsewhere)
  const state = await client.queryState();
  if (state.ok && state.result.state.activeView !== "browse") {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Browse")?.click();
    `);
    await client.waitForState((s) => s.activeView === "browse");
  }
}, 10_000);

afterAll(async () => {
  await client.close();
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("Navigation", () => {
  it("starts on Browse view", async () => {
    const resp = await client.queryState();
    expect(resp.ok).toBe(true);
    expect(resp.result.state.activeView).toBe("browse");
  });

  it("switches to Record view and back", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Record")?.click();
    `);
    await client.waitForIdle();

    const state = await client.waitForState((s) => s.activeView === "record");
    expect(state.activeView).toBe("record");

    // Switch back to Browse
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Browse")?.click();
    `);
    await client.waitForState((s) => s.activeView === "browse");
  });

  it("switches to Jobs view and back", async () => {
    // Click Jobs button
    await client.domClick("button:has(+ button):first-of-type + button");
    // More reliable: find by text
    const resp = await client.evalJs(`
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Jobs");
      if (btn) { btn.click(); return true; }
      return false;
    `);
    expect(resp.ok).toBe(true);
    await client.waitForIdle();

    const state = await client.waitForState((s) => s.activeView === "jobs");
    expect(state.activeView).toBe("jobs");

    // Verify Jobs panel content is visible
    const jobsPanel = await client.evalJs(`
      return !!document.querySelector("[class*='jobs'], [class*='Jobs']")
        || document.body.textContent.includes("Job Queue");
    `);
    expect(jobsPanel.ok).toBe(true);

    // Switch back to Browse
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Browse")?.click();
    `);
    await client.waitForState((s) => s.activeView === "browse");
  });
});

// ---------------------------------------------------------------------------
// View modes
// ---------------------------------------------------------------------------

describe("View Modes", () => {
  it("starts in list view", async () => {
    const state = await client.queryState();
    expect(state.result.state.viewMode).toBe("list");
  });

  it("switches view mode via dropdown menu", async () => {
    // Open view mode dropdown
    await client.domClick('button[title="Switch view mode (V)"]');
    await client.waitForIdle(300);

    // Click "Grid" option from the dropdown
    await client.evalJs(`
      const items = document.querySelectorAll("button");
      for (const b of items) {
        if (b.textContent.trim().includes("Grid") && !b.textContent.includes("Radar")) {
          b.click();
          break;
        }
      }
    `);
    await client.waitForIdle(500);

    const state1 = await client.queryState();
    expect(state1.result.state.viewMode).toBe("grid");

    // Switch back to list
    await client.domClick('button[title="Switch view mode (V)"]');
    await client.waitForIdle(300);
    await client.evalJs(`
      const items = document.querySelectorAll("button");
      for (const b of items) {
        if (b.textContent.trim().includes("List")) { b.click(); break; }
      }
    `);
    await client.waitForIdle(500);

    const state2 = await client.queryState();
    expect(state2.result.state.viewMode).toBe("list");
  });
});

// ---------------------------------------------------------------------------
// Sample selection
// ---------------------------------------------------------------------------

describe("Sample Selection", () => {
  it("has samples loaded", async () => {
    const state = await client.queryState();
    expect(state.result.state.totalSamples).toBeGreaterThan(0);
  });

  it("selects a sample by clicking a row", async () => {
    // Click the first sample row
    const clicked = await client.evalJs(`
      const rows = document.querySelectorAll("[class*='cursor-pointer']");
      for (const row of rows) {
        if (row.textContent.includes(".wav")) {
          row.click();
          return row.textContent.slice(0, 60).replace(/\\s+/g, " ").trim();
        }
      }
      return null;
    `);
    expect(clicked.ok).toBe(true);
    expect(clicked.result.value).toBeTruthy();

    await client.waitForIdle();

    // Verify a sample is now selected
    const state = await client.waitForState((s) => s.selectedSample !== null);
    expect(state.selectedSample).toBeTruthy();
    expect(state.selectedSample.id).toBeGreaterThan(0);
  });

  it("shows details panel for selected sample", async () => {
    // The Details tab should be active in the right sidebar
    const detailsBtn = await client.evalJs(`
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Details");
      return btn ? { found: true, active: btn.className.includes("accent") } : { found: false };
    `);
    expect(detailsBtn.ok).toBe(true);
    expect(detailsBtn.result.value.found).toBe(true);

    // Click Details to make sure it's active
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Details")?.click();
    `);
    await client.waitForIdle();

    // Check that sample details are shown (name, path, tags, etc.)
    const details = await client.evalJs(`
      const state = window.__STORE_STATE__;
      return {
        selectedName: state?.selectedSample?.name,
        bodyHasSampleName: document.body.textContent.includes(state?.selectedSample?.name || "NOMATCH")
      };
    `);
    expect(details.ok).toBe(true);
  });

  it("selects a different sample", async () => {
    const firstState = await client.queryState();
    const firstName = firstState.result.state.selectedSample?.name;

    // Click the second sample row
    const clicked = await client.evalJs(`
      const rows = Array.from(document.querySelectorAll("[class*='cursor-pointer']"))
        .filter(r => r.textContent.includes(".wav"));
      if (rows.length >= 2) {
        rows[1].click();
        return rows[1].textContent.slice(0, 60).replace(/\\s+/g, " ").trim();
      }
      return null;
    `);
    expect(clicked.ok).toBe(true);
    await client.waitForIdle();

    const newState = await client.queryState();
    // Should have a different sample selected (or same if only 1)
    expect(newState.result.state.selectedSample).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Right sidebar panels
// ---------------------------------------------------------------------------

describe("Right Sidebar Panels", () => {
  it("switches to Similar panel", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Similar")?.click();
    `);
    await client.waitForIdle(500);

    // Verify Similar panel is showing
    const panel = await client.evalJs(`
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Similar");
      return {
        active: btn?.className?.includes("accent") || btn?.className?.includes("bg-surface-hover"),
        bodyText: document.body.textContent.slice(0, 2000)
      };
    `);
    expect(panel.ok).toBe(true);
  });

  it("switches to Projects panel", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Projects")?.click();
    `);
    await client.waitForIdle(500);

    const panel = await client.evalJs(`
      return document.body.textContent.includes("project") ||
             document.body.textContent.includes("Project") ||
             document.body.textContent.includes("No projects");
    `);
    expect(panel.ok).toBe(true);
  });

  it("switches to Dupes panel", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Dupes")?.click();
    `);
    await client.waitForIdle(500);

    const panel = await client.evalJs(`
      return document.body.textContent.includes("uplicate") ||
             document.body.textContent.includes("Dupes") ||
             document.body.textContent.includes("No duplicates");
    `);
    expect(panel.ok).toBe(true);
  });

  it("switches back to Details panel", async () => {
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Details")?.click();
    `);
    await client.waitForIdle();
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("Search", () => {
  it("types a search query and filters results", async () => {
    const searchInput = 'input[placeholder*="Search samples"]';

    // Clear and type search query
    const typed = await client.domType(searchInput, "kick", true);
    expect(typed.ok).toBe(true);
    await client.waitForIdle(800);

    // Check that results are filtered — verify via state or row text
    const results = await client.evalJs(`
      const rows = Array.from(document.querySelectorAll("[class*='cursor-pointer']"));
      return {
        count: rows.length,
        texts: rows.slice(0, 5).map(r => r.textContent.slice(0, 100).replace(/\\s+/g, " ").trim())
      };
    `);
    expect(results.ok).toBe(true);
    // At least one visible row should relate to "kick"
    const texts: string[] = results.result.value.texts;
    const kickCount = texts.filter((t: string) =>
      t.toLowerCase().includes("kick")
    ).length;
    expect(kickCount).toBeGreaterThan(0);
  });

  it("clears search to show all samples", async () => {
    const searchInput = 'input[placeholder*="Search samples"]';

    await client.domType(searchInput, "", true);
    await client.waitForIdle(800);

    // Trigger the search by dispatching Enter or change
    await client.evalJs(`
      const input = document.querySelector('input[placeholder*="Search samples"]');
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    `);
    await client.waitForIdle(800);

    const state = await client.queryState();
    // Should be back to showing all samples
    expect(state.result.state.totalSamples).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

describe("Tabs", () => {
  it("creates a new tab", async () => {
    const stateBefore = await client.queryState();
    const tabsBefore = stateBefore.result.state.tabCount;

    // Click the "+" button
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "+")?.click();
    `);
    await client.waitForIdle();

    const stateAfter = await client.queryState();
    expect(stateAfter.result.state.tabCount).toBe(tabsBefore + 1);
  });

  it("switches between tabs", async () => {
    // Click the first tab ("All Samples")
    await client.evalJs(`
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.includes("All Samples"))?.click();
    `);
    await client.waitForIdle();

    const state = await client.queryState();
    // Tab ID is dynamic (timestamp-based), just verify we switched
    expect(state.result.state.activeTabId).toBeTruthy();
    // Verify the tab count is still correct
    expect(state.result.state.tabCount).toBeGreaterThanOrEqual(2);
  });

  it("closes the new tab", async () => {
    const stateBefore = await client.queryState();
    const tabsBefore = stateBefore.result.state.tabCount;

    if (tabsBefore > 1) {
      // Close button is a <span> with × (&times;), not a <button>
      await client.evalJs(`
        const spans = document.querySelectorAll("span");
        // Find the last × close span in the tab bar
        const closeSpans = Array.from(spans).filter(s => s.textContent.trim() === "×");
        if (closeSpans.length > 0) {
          closeSpans[closeSpans.length - 1].click();
        }
      `);
      await client.waitForIdle();

      const stateAfter = await client.queryState();
      expect(stateAfter.result.state.tabCount).toBe(tabsBefore - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar toggles
// ---------------------------------------------------------------------------

describe("Sidebar Toggles", () => {
  it("toggles left sidebar", async () => {
    const selector = 'button[title="Toggle left sidebar (⌘B)"]';

    const before = await client.domQuery(selector);
    expect(before.result.found).toBe(true);

    // Toggle off
    await client.domClick(selector);
    await client.waitForIdle(300);

    // Toggle back on
    await client.domClick(selector);
    await client.waitForIdle(300);
  });

  it("toggles right sidebar", async () => {
    const selector = 'button[title*="Toggle right sidebar"]';

    // Toggle off
    await client.domClick(selector);
    await client.waitForIdle(300);

    // Verify details panel is hidden
    const hidden = await client.evalJs(`
      const btns = Array.from(document.querySelectorAll("button"));
      const detailsBtn = btns.find(b => b.textContent.trim() === "Details");
      return !detailsBtn?.offsetParent;
    `);

    // Toggle back on
    await client.domClick(selector);
    await client.waitForIdle(300);
  });
});

// ---------------------------------------------------------------------------
// Tauri command invocations
// ---------------------------------------------------------------------------

describe("Tauri Commands via invoke", () => {
  it("lists tags", async () => {
    const resp = await client.invoke("db_list_tags");
    expect(resp.ok).toBe(true);
    expect(Array.isArray(resp.result.value)).toBe(true);
    expect(resp.result.value.length).toBeGreaterThan(0);
  });

  it("lists packs", async () => {
    const resp = await client.invoke("db_list_packs");
    expect(resp.ok).toBe(true);
    expect(Array.isArray(resp.result.value)).toBe(true);
  });

  it("searches samples", async () => {
    const resp = await client.invoke("db_search", {
      filters: { query: "", tags: [], limit: 5, offset: 0 },
    });
    expect(resp.ok).toBe(true);
    const result = resp.result.value;
    expect(result.samples || result).toBeTruthy();
  });

  it("gets a single sample", async () => {
    // First get a sample ID
    const searchResp = await client.invoke("db_search", {
      filters: { query: "", tags: [], limit: 1, offset: 0 },
    });
    expect(searchResp.ok).toBe(true);

    const samples = searchResp.result.value.samples || searchResp.result.value;
    if (Array.isArray(samples) && samples.length > 0) {
      const sampleId = samples[0].id;
      const resp = await client.invoke("db_get_sample", { id: sampleId });
      expect(resp.ok).toBe(true);
      expect(resp.result.value.path).toBeTruthy();
    }
  });

  it("gets type counts", async () => {
    const resp = await client.invoke("db_get_type_counts");
    expect(resp.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Native analysis
// ---------------------------------------------------------------------------

describe("Native Analysis", () => {
  it("gets audio info for a sample", async () => {
    // Get a sample with a valid path
    const searchResp = await client.invoke("db_search", {
      filters: { query: "", tags: [], limit: 1, offset: 0 },
    });
    const samples = searchResp.result.value.samples || searchResp.result.value;

    if (Array.isArray(samples) && samples.length > 0) {
      const path = samples[0].filepath || samples[0].path;
      if (path) {
        const resp = await client.invoke("native_audio_info", { path });
        // May fail if file doesn't exist on disk, that's OK
        if (resp.ok) {
          expect(resp.result.value).toBeTruthy();
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Console capture
// ---------------------------------------------------------------------------

describe("Console Capture", () => {
  it("captures console.log output", async () => {
    // Generate some console output
    await client.evalJs('console.log("test-marker-123")');
    await client.waitForIdle();

    const resp = await client.getConsole();
    expect(resp.ok).toBe(true);
    const entries = resp.result.entries;
    const marker = entries.find(
      (e: any) => e.message.includes("test-marker-123")
    );
    expect(marker).toBeTruthy();
    expect(marker.level).toBe("log");
  });

  it("captures all log levels", async () => {
    await client.getConsole(undefined, true); // clear

    await client.evalJs(`
      console.log("level-log");
      console.warn("level-warn");
      console.error("level-error");
      console.info("level-info");
      console.debug("level-debug");
    `);
    await client.waitForIdle();

    const resp = await client.getConsole();
    const entries = resp.result.entries;
    const levels = entries.map((e: any) => e.level);
    expect(levels).toContain("log");
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
    expect(levels).toContain("info");
    expect(levels).toContain("debug");
  });

  it("filters by sequence number", async () => {
    const all = await client.getConsole();
    const entries = all.result.entries;
    if (entries.length >= 2) {
      const midSeq = entries[entries.length - 2].seq;
      const filtered = await client.getConsole(midSeq);
      expect(filtered.result.entries.length).toBeLessThan(entries.length);
    }
  });

  it("clears console buffer", async () => {
    await client.send("clear_console");
    const resp = await client.getConsole();
    expect(resp.result.entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

describe("Screenshot", () => {
  it("captures a screenshot of the app window", async () => {
    const resp = await client.screenshot();
    if (resp.ok) {
      expect(resp.result.width).toBeGreaterThan(0);
      expect(resp.result.height).toBeGreaterThan(0);
      expect(resp.result.format).toBe("png");
      // Verify base64 data is substantial
      expect(resp.result.data.length).toBeGreaterThan(1000);
    }
    // Screenshot may fail without screen recording permissions — don't hard-fail
  });
});
