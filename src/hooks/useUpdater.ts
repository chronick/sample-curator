import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

/**
 * Run a single auto-update check on app startup.
 *
 * If a newer release is available on the configured GitHub Releases
 * endpoint, prompt the user. On accept, download + install + relaunch.
 *
 * Failures are surfaced via console only (no modal) — common cases are
 * "endpoint unreachable" (offline, GH down), which shouldn't pop a
 * dialog every launch.
 */
export function useUpdater() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;

        const accepted = await ask(
          `Sample Curator ${update.version} is available.\n\nCurrent version: ${update.currentVersion}.\n\nInstall and restart now?`,
          {
            title: "Update available",
            kind: "info",
            okLabel: "Install",
            cancelLabel: "Later",
          }
        );
        if (!accepted) return;

        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        console.warn("[updater] check failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
