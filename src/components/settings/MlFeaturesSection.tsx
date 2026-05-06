import { useEffect } from "react";
import { Section, Button } from "./shared";
import {
  useMlFeaturesStore,
  type MlBackendView,
  type MlFeatureView,
  type MlModelView,
  type ModelState,
} from "../../store/mlFeaturesStore";

export function MlFeaturesSection() {
  const status = useMlFeaturesStore((s) => s.status);
  const error = useMlFeaturesStore((s) => s.error);
  const refresh = useMlFeaturesStore((s) => s.refresh);
  const stopPolling = useMlFeaturesStore((s) => s.stopPolling);

  useEffect(() => {
    void refresh();
    return () => {
      stopPolling();
    };
  }, [refresh, stopPolling]);

  return (
    <Section title="ML features">
      <div className="space-y-3" data-testid="ml-features-section">
        <p className="text-[11px] text-gray-500">
          Heavy ML weights are downloaded on demand to keep the install slim. Toggle a feature to enable —
          if its model isn't downloaded, click Download first.
        </p>
        {error && (
          <p className="text-xs text-red-400" data-testid="ml-features-error">
            {error}
          </p>
        )}
        {status ? (
          status.features.map((f) => (
            <FeatureRow
              key={f.feature_id}
              feature={f}
              models={status.models}
              backends={status.backends}
            />
          ))
        ) : (
          <p className="text-xs text-gray-500">Loading…</p>
        )}
      </div>
    </Section>
  );
}

function FeatureRow({
  feature,
  models,
  backends,
}: {
  feature: MlFeatureView;
  models: MlModelView[];
  backends: MlBackendView[];
}) {
  const setEnabled = useMlFeaturesStore((s) => s.setFeatureEnabled);
  const setBackend = useMlFeaturesStore((s) => s.setFeatureBackend);
  const setModel = useMlFeaturesStore((s) => s.setFeatureModel);

  const showBackendSelector = feature.backends.length > 1;
  const allowedBackends = backends.filter((b) => feature.backends.includes(b.backend_id));
  const selectedBackend = backends.find((b) => b.backend_id === feature.backend);

  // Models scoped to the feature's selected backend AND kind.
  const compatibleModels = models.filter(
    (m) => m.kind === feature.kind && m.backend === feature.backend,
  );
  const selectedModel = models.find(
    (m) => m.model_id === feature.model_id && m.backend === feature.backend,
  );

  return (
    <div
      className="bg-surface border border-surface-border rounded p-3 space-y-2"
      data-testid={`ml-feature-${feature.feature_id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-200">{feature.label}</div>
          <p className="text-[11px] text-gray-500 mt-0.5">{feature.description}</p>
        </div>
        <FeatureToggle
          enabled={feature.enabled}
          onChange={(v) => void setEnabled(feature.feature_id, v)}
          testId={`ml-feature-toggle-${feature.feature_id}`}
        />
      </div>

      {showBackendSelector && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-gray-500 shrink-0 w-12">Backend</span>
          <select
            value={feature.backend}
            onChange={(e) => void setBackend(feature.feature_id, e.target.value)}
            className="bg-surface-hover border border-surface-border rounded px-2 py-1 text-xs text-gray-300 flex-1 min-w-0 focus:outline-none focus:border-accent"
            data-testid={`ml-feature-backend-${feature.feature_id}`}
          >
            {allowedBackends.map((b) => (
              <option
                key={b.backend_id}
                value={b.backend_id}
                disabled={!b.available}
                title={b.available ? b.description : b.unavailable_reason ?? ""}
              >
                {b.label}
                {!b.available ? " · unavailable" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {showBackendSelector && selectedBackend && !selectedBackend.available && (
        <p
          className="text-[11px] text-yellow-500 pl-14"
          data-testid={`ml-feature-backend-warning-${feature.feature_id}`}
        >
          {selectedBackend.unavailable_reason ?? `${selectedBackend.label} is unavailable`}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] text-gray-500 shrink-0 w-12">Model</span>
        <select
          value={feature.model_id}
          onChange={(e) => void setModel(feature.feature_id, e.target.value)}
          className="bg-surface-hover border border-surface-border rounded px-2 py-1 text-xs text-gray-300 flex-1 min-w-0 focus:outline-none focus:border-accent"
          data-testid={`ml-feature-model-${feature.feature_id}`}
          disabled={compatibleModels.length === 0}
        >
          {compatibleModels.length === 0 ? (
            <option value="">{emptyModelHint(feature.backend)}</option>
          ) : (
            compatibleModels.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {m.label}
                {m.size_estimate_mb > 0 ? ` · ~${m.size_estimate_mb} MB` : ""}
              </option>
            ))
          )}
        </select>
      </div>

      {selectedModel && <ModelStatusRow model={selectedModel} featureEnabled={feature.enabled} />}
    </div>
  );
}

function emptyModelHint(backend: string): string {
  switch (backend) {
    case "ollama":
      return "No ollama models pulled — run `ollama pull <model>` from a terminal";
    case "foundation":
      return "Foundation Models unavailable on this system";
    default:
      return "No models available for this backend";
  }
}

function FeatureToggle({
  enabled,
  onChange,
  testId,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      data-testid={testId}
      onClick={() => onChange(!enabled)}
      className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? "bg-accent" : "bg-surface-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ModelStatusRow({
  model,
  featureEnabled,
}: {
  model: MlModelView;
  featureEnabled: boolean;
}) {
  const download = useMlFeaturesStore((s) => s.download);
  const cancel = useMlFeaturesStore((s) => s.cancel);
  const remove = useMlFeaturesStore((s) => s.remove);
  const reload = useMlFeaturesStore((s) => s.reload);

  const isOllama = model.backend === "ollama";
  const isFoundation = model.backend === "foundation";
  const libName = model.download_strategy.startsWith("lib_managed:")
    ? model.download_strategy.split(":")[1]
    : null;
  const isSystem = model.download_strategy === "system";

  const sublabel = (() => {
    if (isSystem) return "via macOS";
    if (libName) return `via ${libName} ${isOllama ? "daemon" : "library"}`;
    if (model.disk_bytes > 0) return `${formatBytes(model.disk_bytes)} on disk`;
    return null;
  })();

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[11px] text-gray-500">
        <ModelStateBadge state={model.state} error={model.error} />
        {sublabel && <span className="ml-2 opacity-70">{sublabel}</span>}
      </div>
      <div className="flex items-center gap-1">
        {model.state === "not_downloaded" && !isOllama && !isFoundation && (
          <Button
            onClick={() => void download(model.model_id)}
            testId={`ml-model-download-${model.model_id}`}
          >
            Download
          </Button>
        )}
        {model.state === "not_downloaded" && isOllama && (
          <span
            className="text-[11px] text-gray-500"
            title={`Run \`ollama pull ${model.model_id}\` from a terminal`}
          >
            Pull via ollama
          </span>
        )}
        {model.state === "downloading" && (
          <Button onClick={() => void cancel(model.model_id)} variant="danger">
            Cancel
          </Button>
        )}
        {(model.state === "loaded" || model.state === "error") && !isFoundation && (
          <Button
            onClick={() => void reload(model.model_id)}
            testId={`ml-model-reload-${model.model_id}`}
            title="Reload the model (re-runs init or warmup)"
          >
            Reload
          </Button>
        )}
        {(model.state === "downloaded_not_loaded" ||
          model.state === "loaded" ||
          model.state === "error") &&
          !isOllama &&
          !isFoundation && (
            <Button
              onClick={() => void remove(model.model_id)}
              disabled={featureEnabled}
              variant="danger"
              title={
                featureEnabled
                  ? "Disable the feature first to remove its model"
                  : "Delete this model from disk"
              }
            >
              Remove
            </Button>
          )}
        {model.state === "error" && !isOllama && !isFoundation && (
          <Button
            onClick={() => void download(model.model_id)}
            testId={`ml-model-retry-${model.model_id}`}
          >
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function ModelStateBadge({ state, error }: { state: ModelState; error: string | null }) {
  const map: Record<ModelState, { label: string; cls: string }> = {
    not_downloaded: { label: "Not downloaded", cls: "text-gray-500" },
    downloading: { label: "Downloading…", cls: "text-yellow-400" },
    downloaded_not_loaded: { label: "Downloaded · not loaded", cls: "text-gray-400" },
    loading: { label: "Loading…", cls: "text-yellow-400" },
    loaded: { label: "Loaded · ready", cls: "text-green-400" },
    update_available: { label: "Update available", cls: "text-blue-400" },
    error: { label: error ? `Error: ${error}` : "Error", cls: "text-red-400" },
    not_available: { label: "Not available on this system", cls: "text-gray-500" },
  };
  const entry = map[state];
  return <span className={entry.cls}>{entry.label}</span>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
