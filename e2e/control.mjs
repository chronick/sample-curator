#!/usr/bin/env node
/**
 * macOS native control harness for Sample Curator.
 *
 * Uses screencapture + osascript to control the real app window.
 * Automatically manages the Vite dev server (debug builds need it).
 *
 * Usage:
 *   node e2e/control.mjs start              # Start Vite + launch app
 *   node e2e/control.mjs ss [label]          # Screenshot the app window
 *   node e2e/control.mjs key <key>           # Send keystroke (return, tab, escape, cmd+a)
 *   node e2e/control.mjs type <text>         # Type text into focused element
 *   node e2e/control.mjs click <x> <y>       # Click at x,y within the app window
 *   node e2e/control.mjs focus               # Bring app window to front
 *   node e2e/control.mjs stop                # Kill Vite + app
 */

import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const STATE_FILE = resolve(__dirname, ".control-state.json");
const SCREENSHOT_DIR = resolve(__dirname, "screenshots");
const APP_BINARY = resolve(PROJECT_ROOT, "src-tauri/target/debug/sample-curator");
const APP_NAME = "sample-curator";
const VITE_PORT = 1420;

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return {};
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function osascript(script) {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

async function waitForPort(port, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      if (res.ok) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Port ${port} did not respond within ${timeoutMs}ms`);
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStart() {
  const state = loadState();

  // Check if already running
  if (isProcessAlive(state.appPid)) {
    console.log(`App already running (PID ${state.appPid})`);
    cmdFocus();
    return;
  }

  // 1. Start Vite dev server (debug builds connect to devUrl)
  let vitePid = state.vitePid;
  if (!isProcessAlive(vitePid)) {
    console.log("Starting Vite dev server...");
    const vite = spawn("npx", ["vite", "--port", String(VITE_PORT)], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    vite.unref();
    vitePid = vite.pid;

    // Drain stdout/stderr so the process doesn't block
    vite.stdout.resume();
    vite.stderr.resume();

    await waitForPort(VITE_PORT);
    console.log(`Vite ready on :${VITE_PORT} (PID ${vitePid})`);
  } else {
    console.log(`Vite already running (PID ${vitePid})`);
  }

  // 2. Launch the Tauri debug binary
  console.log(`Launching: ${APP_BINARY}`);
  const app = spawn(APP_BINARY, [], {
    stdio: "ignore",
    detached: true,
  });
  app.unref();

  saveState({ appPid: app.pid, vitePid });

  // Wait for window to appear
  sleep(3000);
  cmdFocus();
  console.log(`App started (PID ${app.pid}). Ready.`);
}

function cmdStop() {
  const state = loadState();

  if (state.appPid) {
    try {
      process.kill(state.appPid, "SIGTERM");
      console.log(`App killed (PID ${state.appPid})`);
    } catch {
      console.log("App already dead.");
    }
  }

  if (state.vitePid) {
    try {
      // Kill the process group (Vite spawns child processes)
      process.kill(-state.vitePid, "SIGTERM");
      console.log(`Vite killed (PID ${state.vitePid})`);
    } catch {
      try {
        process.kill(state.vitePid, "SIGTERM");
        console.log(`Vite killed (PID ${state.vitePid})`);
      } catch {
        console.log("Vite already dead.");
      }
    }
  }

  clearState();
}

function cmdFocus() {
  try {
    osascript(
      `tell application "System Events" to set frontmost of process "${APP_NAME}" to true`
    );
    console.log("App focused.");
  } catch (e) {
    console.error("Could not focus app:", e.message);
  }
}

function cmdScreenshot(label) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = label ? `${label}.png` : `screenshot-${ts}.png`;
  const outPath = resolve(SCREENSHOT_DIR, name);

  // Window-specific capture via Swift + CGWindowList
  try {
    const winId = execSync(
      `swift -e '
import Cocoa
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String,
       owner == "${APP_NAME}",
       let name = w["kCGWindowName"] as? String,
       !name.isEmpty {
        print(w["kCGWindowNumber"]!)
        break
    }
}
'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();

    if (winId) {
      execSync(`screencapture -l ${winId} -o -x "${outPath}"`, { timeout: 5_000 });
      console.log(outPath);
      return;
    }
  } catch {
    // fallback
  }

  // Fallback: full screen capture
  cmdFocus();
  sleep(300);
  execSync(`screencapture -x "${outPath}"`, { timeout: 5_000 });
  console.log(outPath);
}

function cmdKey(key) {
  cmdFocus();
  sleep(100);

  // Special key name → macOS key code mapping
  const specialKeys = {
    return: 36, enter: 36, tab: 48, escape: 53, esc: 53,
    delete: 51, backspace: 51, space: 49,
    up: 126, down: 125, left: 123, right: 124,
  };

  // Check for modifier combos like "cmd+a", "shift+tab"
  const parts = key.split("+");
  if (parts.length > 1) {
    const modifiers = parts.slice(0, -1).map((m) => {
      const map = { cmd: "command", ctrl: "control", alt: "option", shift: "shift" };
      return map[m.toLowerCase()] || m;
    });
    const actualKey = parts[parts.length - 1];
    const modStr = modifiers.map((m) => `${m} down`).join(", ");
    const code = specialKeys[actualKey.toLowerCase()];
    if (code !== undefined) {
      osascript(
        `tell application "System Events" to key code ${code} using {${modStr}}`
      );
    } else {
      osascript(
        `tell application "System Events" to keystroke "${actualKey}" using {${modStr}}`
      );
    }
  } else {
    const code = specialKeys[key.toLowerCase()];
    if (code !== undefined) {
      osascript(`tell application "System Events" to key code ${code}`);
    } else {
      osascript(`tell application "System Events" to keystroke "${key}"`);
    }
  }
  console.log(`Key: ${key}`);
}

function cmdType(text) {
  cmdFocus();
  sleep(100);
  osascript(
    `tell application "System Events" to keystroke "${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  );
  console.log(`Typed: "${text}"`);
}

function cmdClick(x, y) {
  cmdFocus();
  sleep(100);

  try {
    const posStr = osascript(
      `tell application "System Events" to tell process "${APP_NAME}" to get position of window 1`
    );
    const [winX, winY] = posStr.split(", ").map(Number);
    const absX = winX + Number(x);
    const absY = winY + Number(y);

    // Use cliclick if available, otherwise Swift + CGEvent
    try {
      execSync("which cliclick", { stdio: "ignore" });
      execSync(`cliclick c:${absX},${absY}`, { timeout: 5_000 });
    } catch {
      execSync(
        `swift -e '
import Cocoa
let point = CGPoint(x: ${absX}, y: ${absY})
let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
down.post(tap: .cghidEventTap)
usleep(50000)
up.post(tap: .cghidEventTap)
'`,
        { timeout: 5_000 }
      );
    }
    console.log(`Clicked: (${x}, ${y}) → absolute (${absX}, ${absY})`);
  } catch (e) {
    console.error("Click failed:", e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "start":
      await cmdStart();
      break;
    case "stop":
      cmdStop();
      break;
    case "focus":
      cmdFocus();
      break;
    case "screenshot":
    case "ss":
      cmdScreenshot(args[0]);
      break;
    case "key":
      cmdKey(args[0]);
      break;
    case "type":
      cmdType(args.join(" "));
      break;
    case "click":
      cmdClick(args[0], args[1]);
      break;
    default:
      console.log(`Usage: control.mjs <command> [args]

  start              Start Vite dev server + launch app
  stop               Kill app + Vite
  focus              Bring app to front
  ss [label]         Screenshot app window → e2e/screenshots/
  key <key>          Send keystroke (return, tab, escape, cmd+a, etc.)
  type <text>        Type text into focused element
  click <x> <y>     Click at x,y relative to app window`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
