import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "../../store/updaterStore";
import { Section, Row, Button } from "./shared";

export function GeneralTab() {
  const [appVersion, setAppVersion] = useState<string>("");

  const status = useUpdaterStore((s) => s.status);
  const newVersion = useUpdaterStore((s) => s.newVersion);
  const lastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const error = useUpdaterStore((s) => s.error);
  const check = useUpdaterStore((s) => s.check);
  const install = useUpdaterStore((s) => s.install);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <Section title="App">
        <Row label="Current version" value={appVersion ? `v${appVersion}` : "—"} />
      </Section>

      <Section title="Updates">
        <div className="space-y-2 text-sm">
          <Row label="Last checked" value={formatLastChecked(lastCheckedAt)} />
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => void check()}
              disabled={status === "checking" || status === "installing"}
              testId="settings-check-updates"
            >
              {status === "checking" ? "Checking…" : "Check for Updates"}
            </Button>
            {status === "available" && (
              <Button
                variant="primary"
                onClick={() => void install()}
                testId="settings-install-update"
              >
                Install v{newVersion} & Restart
              </Button>
            )}
            {status === "installing" && (
              <span className="text-xs text-gray-400">Installing… app will restart.</span>
            )}
          </div>
          <p className="text-xs text-gray-500" data-testid="settings-update-status">
            {updaterStatusMessage(status, newVersion, error)}
          </p>
        </div>
      </Section>
    </div>
  );
}

function formatLastChecked(ts: number | null): string {
  if (!ts) return "never";
  const ageMs = Date.now() - ts;
  if (ageMs < 60_000) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function updaterStatusMessage(
  status: ReturnType<typeof useUpdaterStore.getState>["status"],
  newVersion: string | null,
  error: string | null,
): string {
  switch (status) {
    case "idle":
      return "";
    case "checking":
      return "Contacting update server…";
    case "up_to_date":
      return "You're on the latest version.";
    case "available":
      return `Update available: v${newVersion ?? "?"}.`;
    case "installing":
      return "Downloading + verifying signature, then app will restart.";
    case "error":
      return `Update check failed: ${error ?? "unknown error"}`;
  }
}
