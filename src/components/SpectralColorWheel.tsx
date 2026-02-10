/**
 * Spectral Color Wheel — Canvas-based circular visualization.
 *
 * Layout:
 *  - Angle = root note from sample.key (C at 12 o'clock, chromatic clockwise)
 *  - Radius = harmonicity: 1 - spectral_flatness (tonal at rim, noisy at center)
 *  - Dot color = HSL from key hue, saturation from energy, lightness 55%
 *  - Dot size = scaled by energy
 *
 * No-key samples cluster at center as grey dots ("grey hub").
 * Scale filter highlights compatible keys.
 * Spatial hash for hit-testing (avoids brute-force on mousemove).
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import type { Sample } from "../api/types";
import {
  derivePerceptualAttributes,
  getAnalysisCoverage,
} from "../utils/perceptualAttributes";
import {
  CHROMATIC_NOTES,
  NOTE_HUES,
  parseKey,
  keyToHue,
  isKeyCompatible,
} from "../utils/keyUtils";

// ---------- Types ----------

interface SpectralColorWheelProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
}

interface DotData {
  sample: Sample;
  x: number;
  y: number;
  radius: number;
  hue: number | null;
  saturation: number;
  energy: number;
  hasKey: boolean;
  compatible: boolean;
}

// ---------- Spatial Hash ----------

class SpatialHash {
  private cells: Map<string, DotData[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear() {
    this.cells.clear();
  }

  insert(dot: DotData) {
    const key = this.cellKey(dot.x, dot.y);
    const cell = this.cells.get(key);
    if (cell) cell.push(dot);
    else this.cells.set(key, [dot]);
  }

  query(x: number, y: number, maxDist: number): DotData | null {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    let best: DotData | null = null;
    let bestDist = maxDist;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.cells.get(key);
        if (!cell) continue;
        for (const dot of cell) {
          const d = Math.hypot(dot.x - x, dot.y - y);
          if (d < bestDist) {
            bestDist = d;
            best = dot;
          }
        }
      }
    }
    return best;
  }

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
}

// ---------- Component ----------

export function SpectralColorWheel({
  samples,
  selectedSample,
  selectedIds: _selectedIds,
  onSelect,
  onToggleSelect: _onToggleSelect,
  onPlay,
}: SpectralColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spatialHashRef = useRef(new SpatialHash(20));

  const [hovered, setHovered] = useState<Sample | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 600 });
  const [showUnkeyed, setShowUnkeyed] = useState(true);
  const [filterKey, setFilterKey] = useState<string>("none");
  const [filterMode, setFilterMode] = useState<"major" | "minor">("minor");

  // Precompute sample dot data
  const dotData = useMemo(() => {
    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 2;
    const maxRadius = Math.min(cx, cy) * 0.85;
    const filterRoot = filterKey !== "none" ? filterKey : null;

    return samples.map((s, i) => {
      const attrs = derivePerceptualAttributes(s);
      const parsed = parseKey(s.key);
      const hue = keyToHue(s.key);
      const hasKey = parsed !== null && hue !== null;

      // Harmonicity: tonal at rim, noisy at center
      const harmonicity =
        s.spectral_flatness !== null ? 1 - s.spectral_flatness : 0.5;

      const energy = attrs.energy ?? 0.3;

      let x: number, y: number;
      if (hasKey) {
        // Angle: key hue mapped to radians, C at top (12 o'clock)
        const angleDeg = hue! - 90; // rotate so 0° (C) points up
        const angleRad = (angleDeg * Math.PI) / 180;
        const r = maxRadius * (0.2 + harmonicity * 0.8); // min 20% radius
        x = cx + Math.cos(angleRad) * r;
        y = cy + Math.sin(angleRad) * r;
      } else {
        // Grey hub: cluster at center with jitter
        const angle = ((i * 137.508) % 360) * (Math.PI / 180);
        const r = maxRadius * 0.12 * (0.3 + ((i * 0.618) % 1) * 0.7);
        x = cx + Math.cos(angle) * r;
        y = cy + Math.sin(angle) * r;
      }

      const compatible = filterRoot
        ? isKeyCompatible(s.key, filterRoot, filterMode)
        : true;

      return {
        sample: s,
        x,
        y,
        radius: Math.max(3, 3 + energy * 6),
        hue,
        saturation: 30 + energy * 50,
        energy,
        hasKey,
        compatible,
      } as DotData;
    });
  }, [samples, canvasSize, filterKey, filterMode]);

  // Stats
  const keyedCount = useMemo(() => dotData.filter((d) => d.hasKey).length, [dotData]);
  const unkeyedCount = dotData.length - keyedCount;
  const keyDataPct =
    samples.length > 0 ? Math.round((keyedCount / samples.length) * 100) : 0;
  const analyzedCount = useMemo(
    () => samples.filter((s) => getAnalysisCoverage(s) >= 0.5).length,
    [samples]
  );
  const coveragePct =
    samples.length > 0 ? Math.round((analyzedCount / samples.length) * 100) : 0;

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        const size = Math.min(width, height);
        setCanvasSize({ width: size, height: size });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvasSize;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(cx, cy) * 0.85;
    const filterRoot = filterKey !== "none" ? filterKey : null;

    // Clear
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);

    // Concentric guide rings
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 0.5;
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Note labels around outer rim
    for (let i = 0; i < CHROMATIC_NOTES.length; i++) {
      const note = CHROMATIC_NOTES[i];
      const hue = NOTE_HUES[note]!;
      const angleDeg = hue - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const lx = cx + Math.cos(angleRad) * (maxR + 18);
      const ly = cy + Math.sin(angleRad) * (maxR + 18);

      // Highlight if compatible with filter
      let alpha = 1;
      if (filterRoot) {
        const isComp = isKeyCompatible(
          `${note}m`, // test as minor for note compatibility
          filterRoot,
          filterMode
        );
        alpha = isComp ? 1 : 0.2;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${hue}, 60%, 60%)`;
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(note, lx, ly);
      ctx.restore();

      // Radial guide line from center to rim for each note
      ctx.save();
      ctx.globalAlpha = alpha * 0.15;
      ctx.strokeStyle = `hsl(${hue}, 40%, 40%)`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(angleRad) * maxR,
        cy + Math.sin(angleRad) * maxR
      );
      ctx.stroke();
      ctx.restore();
    }

    // Filter arc highlight
    if (filterRoot) {
      const filterHue = NOTE_HUES[filterRoot];
      if (filterHue !== undefined) {
        const angleDeg = filterHue - 90;
        const angleRad = (angleDeg * Math.PI) / 180;
        const arcSpan = (30 * Math.PI) / 180; // ±15 degrees
        ctx.save();
        ctx.strokeStyle = `hsla(${filterHue}, 70%, 50%, 0.3)`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR + 5, angleRad - arcSpan, angleRad + arcSpan);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Build spatial hash and render dots
    spatialHashRef.current.clear();

    // Render unkeyed dots first (behind)
    if (showUnkeyed) {
      for (const dot of dotData) {
        if (dot.hasKey) continue;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#555";
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        spatialHashRef.current.insert(dot);
      }
    }

    // Render keyed dots
    for (const dot of dotData) {
      if (!dot.hasKey) continue;

      const alpha = filterRoot ? (dot.compatible ? 1 : 0.12) : 0.85;
      const isSelected = dot.sample.id === selectedSample?.id;
      const isHov = dot.sample.id === hovered?.id;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Glow for selected/hovered
      if (isSelected || isHov) {
        ctx.shadowColor = `hsl(${dot.hue}, ${dot.saturation}%, 55%)`;
        ctx.shadowBlur = isSelected ? 12 : 8;
      }

      ctx.fillStyle = `hsl(${dot.hue}, ${dot.saturation}%, 55%)`;
      ctx.beginPath();
      ctx.arc(
        dot.x,
        dot.y,
        isSelected ? dot.radius * 1.5 : isHov ? dot.radius * 1.3 : dot.radius,
        0,
        Math.PI * 2
      );
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();
      spatialHashRef.current.insert(dot);
    }

    // Labels
    if (unkeyedCount > 0 && showUnkeyed) {
      ctx.fillStyle = "#555";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${unkeyedCount} unkeyed`, cx, cy + maxR * 0.18);
    }
  }, [dotData, canvasSize, selectedSample, hovered, showUnkeyed, filterKey, filterMode, unkeyedCount]);

  // Mouse interaction
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvasSize.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvasSize.height;
      const hit = spatialHashRef.current.query(x, y, 15);
      if (hit) {
        setHovered(hit.sample);
        canvas.style.cursor = "pointer";
      } else {
        setHovered(null);
        canvas.style.cursor = "default";
      }
    },
    [canvasSize]
  );

  const lastClickRef = useRef(0);
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvasSize.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvasSize.height;
      const hit = spatialHashRef.current.query(x, y, 15);
      if (hit) {
        const now = Date.now();
        if (now - lastClickRef.current < 300) {
          onPlay(hit.sample);
        } else {
          onSelect(hit.sample);
        }
        lastClickRef.current = now;
      }
    },
    [canvasSize, onSelect, onPlay]
  );

  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header controls */}
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-4 flex-wrap">
        {/* Scale filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 font-mono">KEY</span>
          <select
            value={filterKey}
            onChange={(e) => setFilterKey(e.target.value)}
            className="px-2 py-1 bg-surface border border-surface-border rounded text-[11px] text-gray-400 outline-none font-mono"
          >
            <option value="none">All Keys</option>
            {CHROMATIC_NOTES.map((note) => (
              <option key={note} value={note}>
                {note}
              </option>
            ))}
          </select>
          {filterKey !== "none" && (
            <select
              value={filterMode}
              onChange={(e) =>
                setFilterMode(e.target.value as "major" | "minor")
              }
              className="px-2 py-1 bg-surface border border-surface-border rounded text-[11px] text-gray-400 outline-none font-mono"
            >
              <option value="minor">minor</option>
              <option value="major">major</option>
            </select>
          )}
        </div>

        {/* Show unkeyed toggle */}
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400 font-mono cursor-pointer">
          <input
            type="checkbox"
            checked={showUnkeyed}
            onChange={(e) => setShowUnkeyed(e.target.checked)}
            className="rounded border-surface-border"
          />
          Show unkeyed
        </label>

        <div className="text-[10px] text-gray-500 font-mono ml-auto">
          {keyedCount} keyed · {unkeyedCount} unkeyed · {coveragePct}% analyzed
        </div>
      </div>

      {/* Low key data warning */}
      {keyDataPct < 20 && samples.length > 0 && (
        <div className="px-4 py-2 bg-yellow-900/20 border-b border-yellow-700/30 text-[11px] text-yellow-500/80">
          Most samples don't have key data yet ({keyDataPct}%). Run analysis to populate this view.
        </div>
      )}

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden p-4"
      >
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.width, height: canvasSize.height }}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
        />
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-[#0e0e1aee] backdrop-blur-xl border border-[#333] rounded-lg px-4 py-2">
          <div className="flex items-center gap-2">
            {hovered.key && (
              <span
                className="text-sm font-bold"
                style={{ color: `hsl(${keyToHue(hovered.key)}, 60%, 60%)` }}
              >
                {hovered.key}
              </span>
            )}
            <span className="text-[12px] text-gray-300 truncate max-w-[200px]">
              {hovered.path.split("/").pop()}
            </span>
          </div>
          <div className="text-[10px] text-gray-500 font-mono">
            {hovered.sample_type || "unknown"}
            {hovered.bpm && ` · ${Math.round(hovered.bpm)} bpm`}
            {hovered.duration && ` · ${hovered.duration.toFixed(2)}s`}
          </div>
        </div>
      )}
    </div>
  );
}

export default SpectralColorWheel;
