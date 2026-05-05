/**
 * Zustand store for auto-updater state. Shared between the
 * `UpdateBanner` (top-level prompt) and `SettingsDialog` Updates
 * section so both surfaces reflect the same check/install state.
 */

import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "installing"
  | "error";

interface UpdaterState {
  status: UpdaterStatus;
  newVersion: string | null;
  currentVersion: string | null;
  lastCheckedAt: number | null;
  error: string | null;
  /** Banner dismissed for this session — Settings still reports `available`. */
  dismissed: boolean;

  /** In-flight `Update` handle held across `check()` → `install()`. */
  _pending: Update | null;

  check: () => Promise<void>;
  install: () => Promise<void>;
  dismissBanner: () => void;
}

const STORAGE_KEY = "sample-curator:lastCheckedAt";

function readLastCheckedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastCheckedAt(ts: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    /* localStorage unavailable; non-fatal */
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  newVersion: null,
  currentVersion: null,
  lastCheckedAt: readLastCheckedAt(),
  error: null,
  dismissed: false,
  _pending: null,

  check: async () => {
    if (get().status === "checking" || get().status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      const now = Date.now();
      writeLastCheckedAt(now);
      if (update) {
        set({
          status: "available",
          newVersion: update.version,
          currentVersion: update.currentVersion,
          lastCheckedAt: now,
          dismissed: false,
          _pending: update,
        });
      } else {
        set({
          status: "up_to_date",
          newVersion: null,
          lastCheckedAt: now,
          _pending: null,
        });
      }
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  install: async () => {
    const update = get()._pending;
    if (!update) return;
    set({ status: "installing" });
    try {
      await update.downloadAndInstall();
      await relaunch();
      // relaunch() should kill this process; this line is unreachable
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  dismissBanner: () => set({ dismissed: true }),
}));
