import { useCallback, useEffect, useState } from "react";
import { api, type AppVersions } from "../../api/client";
import { Section, Row } from "./shared";

export function AboutTab() {
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVersions(await api.getAppVersions());
    } catch (err) {
      console.warn("getAppVersions failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <Section
        title="Versions"
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="text-[10px] px-2 py-0.5 bg-surface hover:bg-surface-hover border border-surface-border rounded transition-colors disabled:opacity-50"
            title="Re-query sidecar version (useful after first ML call wakes it)"
          >
            {loading ? "…" : "↻"}
          </button>
        }
      >
        <div className="space-y-1">
          <Row label="App" value={versions ? `v${versions.app}` : "—"} />
          <Row label="Tauri" value={versions ? `v${versions.tauri}` : "—"} />
          <Row label="OS / arch" value={versions?.os ?? "—"} mono />
          {versions?.sidecar ? (
            <>
              <Row
                label="Sidecar"
                value={`v${versions.sidecar.package_version}${versions.sidecar.is_frozen ? " (bundled)" : " (dev)"}`}
              />
              <Row
                label="Python"
                value={`${versions.sidecar.python_implementation} ${versions.sidecar.python_version}`}
              />
            </>
          ) : (
            <Row
              label="Sidecar"
              value={loading ? "Loading…" : "Not started"}
              hint={!loading ? "Starts on first ML call (auto-naming, captioning)" : undefined}
            />
          )}
        </div>
      </Section>
    </div>
  );
}
