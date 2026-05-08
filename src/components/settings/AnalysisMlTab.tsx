import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getNativeQuality, getNativeAudioInfo } from "../../hooks/useNativeAnalysis";
import { useRecorderStore } from "../../store/recorderStore";
import { Section, Button } from "./shared";
import { MlFeaturesSection } from "./MlFeaturesSection";

export function AnalysisMlTab() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const config = useRecorderStore((s) => s.config);
  const updateConfig = useRecorderStore((s) => s.updateConfig);

  const persistAutoStems = useCallback(
    (enabled: boolean) => {
      const next = { ...config, auto_stem_separation: enabled };
      updateConfig({ auto_stem_separation: enabled });
      void invoke("recorder_set_config", { config: next }).catch((e) =>
        console.warn("Failed to persist auto_stem_separation:", e)
      );
    },
    [config, updateConfig]
  );

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

      <Section title="Stems">
        <label
          className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer select-none"
          data-testid="auto-stem-separation-toggle"
        >
          <input
            type="checkbox"
            checked={config.auto_stem_separation}
            onChange={(e) => persistAutoStems(e.target.checked)}
            className="mt-0.5 accent-pink-500"
            aria-label="Auto-separate stems for new recordings"
          />
          <span>
            <span className="block">Auto-separate stems on new recordings</span>
            <span className="block text-[11px] text-gray-500">
              Run demucs after every finalized recording (≥5s). The active recording
              session can override this per-cycle from the recorder panel. Off by
              default — demucs is heavy (seconds-to-minutes per clip).
            </span>
          </span>
        </label>
      </Section>

      <MlFeaturesSection />
    </div>
  );
}
