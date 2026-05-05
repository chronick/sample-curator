import { useEffect } from "react";
import { useUpdaterStore } from "../store/updaterStore";

/**
 * Run a single auto-update check on app startup.
 *
 * State (status, version, error) lives in `useUpdaterStore` so the
 * banner and the Settings → Updates section can both consume it.
 *
 * Failures are surfaced via the store's `error` field — the banner
 * suppresses them by default (no-op when `status === 'error'`); the
 * Settings section shows them so manual checks can debug.
 */
export function useUpdater() {
  const check = useUpdaterStore((s) => s.check);
  useEffect(() => {
    void check();
  }, [check]);
}
