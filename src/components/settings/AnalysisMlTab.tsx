import { useCallback, useState } from "react";
import { getNativeQuality, getNativeAudioInfo } from "../../hooks/useNativeAnalysis";
import { RANKED_MODELS, type OllamaStatusDict } from "../../types/ollama";
import { Section, Button } from "./shared";
import { MlFeaturesSection } from "./MlFeaturesSection";

export function AnalysisMlTab({
  llmStatus,
  onRefreshLlm,
  onSetLlmModel,
}: {
  llmStatus: OllamaStatusDict;
  onRefreshLlm: () => Promise<void>;
  onSetLlmModel: (model: string | null) => Promise<void>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [llmRefreshing, setLlmRefreshing] = useState(false);
  const [llmSetError, setLlmSetError] = useState<string | null>(null);

  const handleTestAnalysis = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "aif", "aiff", "flac", "mp3", "ogg"] }],
      });
      if (selected && typeof selected === "string") {
        const startTime = performance.now();
        const [info, quality] = await Promise.all([
          getNativeAudioInfo(selected),
          getNativeQuality(selected),
        ]);
        const elapsed = performance.now() - startTime;
        setTestResult(
          `${selected.split("/").pop()}\n` +
            `Duration: ${info.duration_sec.toFixed(2)}s | ${info.sample_rate}Hz | ${info.channels}ch\n` +
            `RMS: ${quality.rms_db.toFixed(1)}dB | Peak: ${quality.peak_db.toFixed(1)}dB | Crest: ${quality.crest_factor.toFixed(1)}dB\n` +
            `Analysis time: ${elapsed.toFixed(0)}ms`,
        );
      }
    } catch (err) {
      setTestResult(`Error: ${err}`);
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <Section title="Analysis">
        <div className="space-y-2 text-sm text-gray-400">
          <p className="text-[12px]">
            Built-in DSP runs natively on every imported sample — RMS / peak / crest, spectral analysis, beat /
            tempo, segmentation. No download or toggle required.
          </p>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-[11px] text-gray-500 hover:text-gray-300"
          >
            {advancedOpen ? "▾ Hide advanced" : "▸ Show advanced"}
          </button>
          {advancedOpen && (
            <div className="space-y-2 pl-2 border-l border-surface-border">
              <Button onClick={() => void handleTestAnalysis()} disabled={testing} testId="analysis-test-file">
                {testing ? "Analyzing…" : "Test analysis on file"}
              </Button>
              {testResult && (
                <pre className="text-xs text-gray-400 bg-surface rounded p-3 whitespace-pre-wrap">
                  {testResult}
                </pre>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="LLM vocal naming">
        <div className="space-y-3 text-sm text-gray-400">
          <div className="flex justify-between items-center">
            <span>Status</span>
            <span
              className={
                llmStatus.state === "loaded"
                  ? "text-green-400"
                  : llmStatus.state === "loading"
                  ? "text-yellow-400"
                  : llmStatus.state === "errored"
                  ? "text-red-400"
                  : "text-gray-500"
              }
            >
              {llmStatus.state === "loaded"
                ? `Ready (${llmStatus.model})`
                : llmStatus.state === "loading"
                ? "Loading…"
                : llmStatus.state === "errored"
                ? `Error: ${llmStatus.error ?? "unknown"}`
                : "Not loaded"}
            </span>
          </div>
          {llmStatus.available_models.length > 0 && (
            <div className="flex justify-between items-center gap-3">
              <span className="shrink-0">Model</span>
              <select
                value={llmStatus.model ?? ""}
                onChange={async (e) => {
                  setLlmSetError(null);
                  try {
                    await onSetLlmModel(e.target.value || null);
                  } catch (err) {
                    setLlmSetError(err instanceof Error ? err.message : String(err));
                  }
                }}
                className="bg-surface border border-surface-border rounded px-2 py-1 text-xs text-gray-300 flex-1 min-w-0"
              >
                {RANKED_MODELS.filter((m) => llmStatus.available_models.includes(m)).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {llmStatus.available_models
                  .filter((m) => !(RANKED_MODELS as readonly string[]).includes(m))
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {llmSetError && <p className="text-xs text-red-400">{llmSetError}</p>}
          <Button
            onClick={async () => {
              setLlmRefreshing(true);
              try {
                await onRefreshLlm();
              } finally {
                setLlmRefreshing(false);
              }
            }}
            disabled={llmRefreshing}
          >
            {llmRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <p className="text-[11px] text-gray-500">
            Uses ollama (local LLM) for vocal-naming refinement. Install ollama separately to enable.
          </p>
        </div>
      </Section>

      <MlFeaturesSection />
    </div>
  );
}
