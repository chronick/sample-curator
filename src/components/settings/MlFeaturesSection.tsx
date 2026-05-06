import { useEffect } from "react";
import { Section, Button } from "./shared";
import {
  useMlFeaturesStore,
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
            <FeatureRow key={f.feature_id} feature={f} models={status.models} />
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
}: {
  feature: MlFeatureView;
  models: MlModelView[];
}) {
  const setEnabled = useMlFeaturesStore((s) => s.setFeatureEnabled);
  const setModel = useMlFeaturesStore((s) => s.setFeatureModel);

  const compatibleModels = models.filter((m) => m.kind === feature.kind);
  const selectedModel = models.find((m) => m.model_id === feature.model_id);

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

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] text-gray-500 shrink-0">Model</span>
        <select
          value={feature.model_id}
          onChange={(e) => void setModel(feature.feature_id, e.target.value)}
          className="bg-surface-hover border border-surface-border rounded px-2 py-1 text-xs text-gray-300 flex-1 min-w-0 focus:outline-none focus:border-accent"
          data-testid={`ml-feature-model-${feature.feature_id}`}
        >
          {compatibleModels.map((m) => (
            <option key={m.model_id} value={m.model_id}>
              {m.label}
              {m.size_estimate_mb > 0 ? ` · ~${m.size_estimate_mb} MB` : ""}
            </option>
          ))}
        </select>
      </div>

      {selectedModel && <ModelStatusRow model={selectedModel} featureEnabled={feature.enabled} />}
    </div>
  );
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

  const isOllama = model.download_strategy === "lib_managed:ollama";
  const libName = model.download_strategy.startsWith("lib_managed:")
    ? model.download_strategy.split(":")[1]
    : null;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[11px] text-gray-500">
        <ModelStateBadge state={model.state} error={model.error} />
        {libName ? (
          <span className="ml-2 opacity-70">via {libName} {isOllama ? "daemon" : "library"}</span>
        ) : (
          model.disk_bytes > 0 && (
            <span className="ml-2 opacity-70">{formatBytes(model.disk_bytes)} on disk</span>
          )
        )}
      </div>
      <div className="flex items-center gap-1">
        {model.state === "not_downloaded" && !isOllama && (
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
            title={`Run \`ollama pull ${model.model_id.replace(/^ollama:/, "")}\` from a terminal`}
          >
            Pull via ollama
          </span>
        )}
        {model.state === "downloading" && (
          <Button onClick={() => void cancel(model.model_id)} variant="danger">
            Cancel
          </Button>
        )}
        {(model.state === "loaded" || model.state === "error") && (
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
          !isOllama && (
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
        {model.state === "error" && !isOllama && (
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
