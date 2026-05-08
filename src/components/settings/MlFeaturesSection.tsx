import { useEffect } from "react";
import { Section, Button } from "./shared";
import {
  missingExtrasForFeature,
  useMlFeaturesStore,
  type DepsStatus,
  type MlBackendView,
  type MlFeatureView,
  type MlModelView,
  type ModelState,
} from "../../store/mlFeaturesStore";

const EXTRA_LABELS: Record<string, string> = {
  embedding: "Embedding (CLAP + transformers + torch)",
  transcription: "Transcription (faster-whisper)",
  stems: "Stem separation (demucs + torch)",
  llm_hf: "LLM via HuggingFace (transformers + torch + accelerate)",
  llm_ollama: "LLM via Ollama (ollama-py)",
};

export function MlFeaturesSection() {
  const status = useMlFeaturesStore((s) => s.status);
  const deps = useMlFeaturesStore((s) => s.deps);
  const error = useMlFeaturesStore((s) => s.error);
  const refresh = useMlFeaturesStore((s) => s.refresh);
  const refreshDeps = useMlFeaturesStore((s) => s.refreshDeps);
  const stopPolling = useMlFeaturesStore((s) => s.stopPolling);

  useEffect(() => {
    void refresh();
    void refreshDeps();
    return () => {
      stopPolling();
    };
  }, [refresh, refreshDeps, stopPolling]);

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
        <DependenciesCard deps={deps} />
        {status ? (
          status.features.map((f) => (
            <FeatureRow
              key={f.feature_id}
              feature={f}
              models={status.models}
              backends={status.backends}
              deps={deps}
            />
          ))
        ) : (
          <p className="text-xs text-gray-500">Loading…</p>
        )}
      </div>
    </Section>
  );
}

function DependenciesCard({ deps }: { deps: DepsStatus | null }) {
  if (!deps || !deps.extras) {
    return (
      <div
        className="bg-surface border border-surface-border rounded p-3"
        data-testid="ml-deps-card"
      >
        <div className="text-sm font-medium text-gray-200">Dependencies</div>
        <p className="text-[11px] text-gray-500 mt-1">Checking…</p>
      </div>
    );
  }

  const entries = Object.entries(deps.extras);
  const allInstalled = entries.every(([, s]) => s.installed);

  return (
    <div
      className="bg-surface border border-surface-border rounded p-3 space-y-2"
      data-testid="ml-deps-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-200">Dependencies</div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            ML features rely on heavy Python libraries. The bundled sidecar ships without them — install
            per-feature as needed.
          </p>
        </div>
        <span
          className={`text-[11px] shrink-0 ${
            allInstalled ? "text-green-400" : "text-gray-400"
          }`}
          data-testid="ml-deps-summary"
        >
          {allInstalled ? "All installed" : `${entries.filter(([, s]) => s.installed).length} of ${entries.length} installed`}
        </span>
      </div>
      <ul className="text-[11px] space-y-1 pt-1">
        {entries.map(([name, status]) => (
          <li
            key={name}
            className="flex items-center justify-between gap-2"
            data-testid={`ml-deps-extra-${name}`}
          >
            <span className="text-gray-400">
              <span className={status.installed ? "text-green-400" : "text-red-400"}>
                {status.installed ? "✓" : "✗"}
              </span>{" "}
              {EXTRA_LABELS[name] ?? name}
            </span>
            {!status.installed && status.missing.length > 0 && (
              <span
                className="text-gray-500 truncate"
                title={`Missing: ${status.missing.join(", ")}`}
              >
                missing: {status.missing.join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureRow({
  feature,
  models,
  backends,
  deps,
}: {
  feature: MlFeatureView;
  models: MlModelView[];
  backends: MlBackendView[];
  deps: DepsStatus | null;
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

  // Phase 1 of vault-347l: deps gating. Toggle is greyed when any
  // required extra (feature ∪ active backend) reports installed=false.
  // `missingExtrasForFeature` returns [] when deps haven't loaded yet,
  // so first paint preserves existing toggle behavior.
  const missingExtras = missingExtrasForFeature(feature, backends, deps);
  const depsBlocked = missingExtras.length > 0;

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
          disabled={depsBlocked && !feature.enabled}
          disabledReason={
            depsBlocked
              ? `Install dependencies first: ${missingExtras.map((e) => EXTRA_LABELS[e] ?? e).join(", ")}`
              : undefined
          }
          testId={`ml-feature-toggle-${feature.feature_id}`}
        />
      </div>

      {depsBlocked && (
        <DepsCta featureId={feature.feature_id} extras={missingExtras} />
      )}

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
  disabled = false,
  disabledReason,
  testId,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-disabled={disabled}
      data-testid={testId}
      onClick={() => {
        if (disabled) return;
        onChange(!enabled);
      }}
      title={disabled ? disabledReason : undefined}
      className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? "bg-accent" : "bg-surface-border"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function DepsCta({ featureId, extras }: { featureId: string; extras: string[] }) {
  const handleClick = () => {
    // Phase 1 stub: alert-based explanation of next-step. Phase 2 swaps
    // this for an actual install action wired through `deps_install`.
    const list = extras.map((e) => `  --extra ${e.replace("_", "-")}`).join("\n");
    alert(
      [
        `Install workflow lands in the next release (vault-347l Phase 2).`,
        ``,
        `For now, install in dev with:`,
        `  cd sidecar`,
        `  uv sync \\`,
        list,
      ].join("\n"),
    );
  };
  return (
    <div
      className="flex items-center justify-between gap-2 bg-surface-hover border border-surface-border rounded px-2 py-1.5"
      data-testid={`ml-feature-deps-cta-${featureId}`}
    >
      <span className="text-[11px] text-yellow-500">
        Missing: {extras.join(", ")}
      </span>
      <Button
        onClick={handleClick}
        testId={`ml-feature-install-deps-${featureId}`}
        title="Install the Python dependencies this feature needs"
      >
        Install dependencies
      </Button>
    </div>
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
