import { useUpdaterStore } from "../store/updaterStore";

/**
 * Top-level banner shown when an app update is available.
 *
 * Renders nothing in `idle` / `up_to_date` / `error` states (silent on
 * failure — the user can still see status in Settings → Updates).
 * `installing` keeps the banner visible with a spinner; the app
 * relaunches once `relaunch()` returns.
 *
 * "Later" dismisses for this session only — `dismissed` is in-memory
 * and resets on next launch, where startup `check()` will re-surface
 * the banner if the update is still pending.
 */
export function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const newVersion = useUpdaterStore((s) => s.newVersion);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const dismissed = useUpdaterStore((s) => s.dismissed);
  const install = useUpdaterStore((s) => s.install);
  const dismissBanner = useUpdaterStore((s) => s.dismissBanner);

  if (status !== "available" && status !== "installing") return null;
  if (dismissed && status !== "installing") return null;

  return (
    <div
      className="px-4 py-2 bg-accent/15 border-b border-accent/40 flex items-center justify-between gap-3 text-xs"
      data-testid="update-banner"
      role="status"
    >
      <div className="flex items-center gap-2 text-gray-200">
        <span aria-hidden="true">⬆</span>
        {status === "installing" ? (
          <span>
            Installing Sample Curator <span className="font-medium tabular-nums">v{newVersion}</span>
            {"… "}
            <span className="text-gray-400">app will restart automatically.</span>
          </span>
        ) : (
          <span>
            Sample Curator <span className="font-medium tabular-nums">v{newVersion}</span> is
            available
            {currentVersion && (
              <span className="text-gray-500"> (current: v{currentVersion})</span>
            )}
            .
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {status === "available" && (
          <>
            <button
              type="button"
              onClick={() => void install()}
              className="px-3 py-1 bg-accent/30 hover:bg-accent/50 text-accent border border-accent rounded text-xs font-medium transition-colors"
              data-testid="update-banner-install"
            >
              Install &amp; Restart
            </button>
            <button
              type="button"
              onClick={dismissBanner}
              className="px-2 py-1 bg-surface hover:bg-surface-hover border border-surface-border rounded text-xs text-gray-400 transition-colors"
              data-testid="update-banner-later"
            >
              Later
            </button>
          </>
        )}
        {status === "installing" && (
          <span
            className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin"
            aria-label="Installing"
          />
        )}
      </div>
    </div>
  );
}
