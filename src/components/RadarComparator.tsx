/**
 * Radar Comparator — SVG radar glyph grid with comparison overlay.
 *
 * Virtualized grid (via @tanstack/react-virtual) of mini radar charts.
 * Shift-click to add samples to comparison (max 5).
 * Unanalyzed samples shown with dashed stroke and "?" center label.
 */

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Sample } from "../api/types";
import {
  derivePerceptualAttributes,
  getAnalysisCoverage,
  getCategoryColor,
  ATTR_DEFS,
  type PerceptualAttributes,
} from "../utils/perceptualAttributes";

// ---------- Props ----------

interface RadarComparatorProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
}

// ---------- Sub-components ----------

interface MiniRadarProps {
  attrs: PerceptualAttributes;
  color: string;
  size?: number;
  showLabels?: boolean;
  highlight?: boolean;
  unanalyzed?: boolean;
  isVocal?: boolean;
}

function MiniRadar({
  attrs,
  color,
  size = 80,
  showLabels = false,
  highlight = false,
  unanalyzed = false,
  isVocal = false,
}: MiniRadarProps) {
  const n = ATTR_DEFS.length;
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;

  const points = ATTR_DEFS.map((def, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const val = attrs[def.key] ?? 0;
    return {
      x: cx + Math.cos(angle) * val * r,
      y: cy + Math.sin(angle) * val * r,
    };
  });

  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={Array.from({ length: n }, (_, i) => {
            const a = (Math.PI * 2 * i) / n - Math.PI / 2;
            return `${cx + Math.cos(a) * ring * r},${cy + Math.sin(a) * ring * r}`;
          }).join(" ")}
          fill="none"
          stroke={highlight ? color + "20" : "#1f1f2e"}
          strokeWidth={0.5}
        />
      ))}
      {/* Axis lines */}
      {Array.from({ length: n }, (_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a) * r}
            y2={cy + Math.sin(a) * r}
            stroke="#1f1f2e"
            strokeWidth={0.3}
          />
        );
      })}
      {/* Data polygon */}
      {unanalyzed ? (
        <>
          <polygon
            points={polygon}
            fill="none"
            stroke={color + "60"}
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size * 0.2}
            fill="#555"
            fontFamily="monospace"
          >
            ?
          </text>
        </>
      ) : (
        <>
          <polygon
            points={polygon}
            fill={color + "25"}
            stroke={color}
            strokeWidth={highlight ? 2 : 1.2}
          />
          {/* Data points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={highlight ? 2.5 : 1.5}
              fill={color}
            />
          ))}
        </>
      )}
      {/* Labels */}
      {showLabels &&
        ATTR_DEFS.map((def, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          return (
            <text
              key={def.key}
              x={cx + Math.cos(a) * (r + 10)}
              y={cy + Math.sin(a) * (r + 10)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={7}
              fill="#666"
              fontFamily="monospace"
            >
              {def.shortLabel}
            </text>
          );
        })}
      {/* Vocal badge */}
      {isVocal && !unanalyzed && (
        <text
          x={size - 10}
          y={10}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
        >
          🎤
        </text>
      )}
    </svg>
  );
}

// ---------- Compare Panel ----------

interface ComparePanelProps {
  compareSamples: Array<{
    sample: Sample;
    attrs: PerceptualAttributes;
    color: string;
  }>;
  onRemove: (id: number) => void;
  onClose: () => void;
}

function ComparePanel({ compareSamples, onRemove, onClose }: ComparePanelProps) {
  if (compareSamples.length === 0) return null;
  const n = ATTR_DEFS.length;
  const size = 240;
  const r = size * 0.32;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0c0c18f0] backdrop-blur-xl border-t border-[#333] px-6 py-4">
      <div className="flex justify-between items-start max-w-[1200px] mx-auto gap-6">
        {/* Left: sample names */}
        <div className="flex-shrink-0">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest font-mono mb-2">
            Comparing {compareSamples.length} sample{compareSamples.length > 1 ? "s" : ""}
          </div>
          <div className="flex gap-2 flex-wrap">
            {compareSamples.map(({ sample, color }) => (
              <div
                key={sample.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono"
                style={{
                  background: color + "15",
                  borderColor: color + "30",
                }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-gray-300 truncate max-w-[120px]">
                  {sample.path.split("/").pop()}
                </span>
                <button
                  onClick={() => onRemove(sample.id)}
                  className="text-gray-600 hover:text-gray-300 ml-1"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center: overlaid radar */}
        <div className="flex items-start gap-6">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {[0.25, 0.5, 0.75, 1].map((ring) => (
              <polygon
                key={ring}
                points={Array.from({ length: n }, (_, i) => {
                  const a = (Math.PI * 2 * i) / n - Math.PI / 2;
                  return `${cx + Math.cos(a) * ring * r},${cy + Math.sin(a) * ring * r}`;
                }).join(" ")}
                fill="none"
                stroke="#1f1f2e"
                strokeWidth={0.5}
              />
            ))}
            {Array.from({ length: n }, (_, i) => {
              const a = (Math.PI * 2 * i) / n - Math.PI / 2;
              return (
                <line
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={cx + Math.cos(a) * r}
                  y2={cy + Math.sin(a) * r}
                  stroke="#1f1f2e"
                  strokeWidth={0.3}
                />
              );
            })}
            {compareSamples.map(({ sample, attrs, color }) => {
              const pts = ATTR_DEFS.map((def, i) => {
                const a = (Math.PI * 2 * i) / n - Math.PI / 2;
                const val = attrs[def.key] ?? 0;
                return `${cx + Math.cos(a) * val * r},${cy + Math.sin(a) * val * r}`;
              }).join(" ");
              return (
                <polygon
                  key={sample.id}
                  points={pts}
                  fill={color + "18"}
                  stroke={color}
                  strokeWidth={1.5}
                />
              );
            })}
            {ATTR_DEFS.map((def, i) => {
              const a = (Math.PI * 2 * i) / n - Math.PI / 2;
              return (
                <text
                  key={def.key}
                  x={cx + Math.cos(a) * (r + 14)}
                  y={cy + Math.sin(a) * (r + 14)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="#888"
                  fontFamily="monospace"
                >
                  {def.shortLabel}
                </text>
              );
            })}
          </svg>

          {/* Attribute comparison bars */}
          <div className="flex flex-col gap-1.5 min-w-[200px]">
            {ATTR_DEFS.map((def) => (
              <div key={def.key}>
                <div className="text-[9px] text-gray-600 font-mono mb-0.5">
                  {def.label}
                </div>
                {compareSamples.map(({ sample, attrs, color }) => {
                  const val = attrs[def.key];
                  return (
                    <div
                      key={sample.id}
                      className="flex items-center gap-1 mb-px"
                    >
                      <div
                        className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: color }}
                      />
                      <div className="flex-1 h-[3px] bg-[#1a1a2e] rounded overflow-hidden">
                        <div
                          className="h-full rounded transition-all duration-300"
                          style={{
                            width: val !== null ? `${val * 100}%` : "0%",
                            background: color,
                          }}
                        />
                      </div>
                      <span className="w-5 text-right text-[8px] text-gray-600 font-mono">
                        {val !== null ? (val * 100).toFixed(0) : "?"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="text-[11px] text-gray-500 border border-[#333] rounded px-3 py-1 hover:text-gray-300 hover:border-gray-500 font-mono transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main Component ----------

const COLUMN_MIN_WIDTH = 120;

export function RadarComparator({
  samples,
  selectedSample,
  selectedIds: _selectedIds,
  onSelect,
  onToggleSelect: _onToggleSelect,
  onPlay,
}: RadarComparatorProps) {
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState("name");
  const [searchTerm, setSearchTerm] = useState("");
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(6);

  // Precompute sample data
  const sampleData = useMemo(
    () =>
      samples.map((s) => {
        const attrs = derivePerceptualAttributes(s);
        const coverage = getAnalysisCoverage(s);
        const color = getCategoryColor(s.sample_type);
        return { sample: s, attrs, coverage, color };
      }),
    [samples]
  );

  // Build category set
  const categories = useMemo(() => {
    const cats = new Map<string, string>();
    for (const d of sampleData) {
      const type = d.sample.sample_type || "unknown";
      if (!cats.has(type)) cats.set(type, d.color);
    }
    return cats;
  }, [sampleData]);

  // Init active categories
  useEffect(() => {
    setActiveCategories(new Set(categories.keys()));
  }, [categories]);

  // Analysis stats
  const analyzedCount = useMemo(
    () => sampleData.filter((d) => d.coverage >= 0.5).length,
    [sampleData]
  );
  const coveragePct =
    samples.length > 0 ? Math.round((analyzedCount / samples.length) * 100) : 0;

  const toggleCategory = useCallback((name: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleCompare = useCallback((id: number) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }, []);

  // Filtered + sorted
  const filteredSamples = useMemo(() => {
    let result = sampleData.filter((d) => {
      const sType = d.sample.sample_type || "unknown";
      if (!activeCategories.has(sType)) return false;
      if (searchTerm) {
        const name = d.sample.path.split("/").pop()?.toLowerCase() || "";
        if (!name.includes(searchTerm.toLowerCase())) return false;
      }
      return true;
    });
    result.sort((a, b) => {
      if (sortBy === "name") {
        const nameA = a.sample.path.split("/").pop() || "";
        const nameB = b.sample.path.split("/").pop() || "";
        return nameA.localeCompare(nameB);
      }
      const attrDef = ATTR_DEFS.find((d) => d.key === sortBy);
      if (attrDef) {
        const va = a.attrs[attrDef.key] ?? -1;
        const vb = b.attrs[attrDef.key] ?? -1;
        return vb - va;
      }
      return 0;
    });
    return result;
  }, [sampleData, activeCategories, searchTerm, sortBy]);

  const compareSamples = useMemo(
    () => sampleData.filter((d) => compareIds.has(d.sample.id)),
    [sampleData, compareIds]
  );

  // Calculate column count from container width
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      const cols = Math.max(1, Math.floor(w / COLUMN_MIN_WIDTH));
      setColumnCount(cols);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Virtualize rows
  const rowCount = Math.ceil(filteredSamples.length / columnCount);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 4,
  });

  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Filter by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1.5 bg-surface border border-surface-border rounded text-xs text-gray-300 font-mono w-44 outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 font-mono">SORT</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 bg-surface border border-surface-border rounded text-[11px] text-gray-400 outline-none font-mono"
          >
            <option value="name">Name</option>
            {ATTR_DEFS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[10px] text-gray-500 font-mono ml-auto">
          {filteredSamples.length} samples · {coveragePct}% analyzed · shift-click to compare (max 5)
        </div>
      </div>

      {/* Category pills */}
      <div className="px-4 py-2 flex gap-1.5 flex-wrap border-b border-surface-border">
        {Array.from(categories.entries()).map(([name, color]) => {
          const active = activeCategories.has(name);
          return (
            <button
              key={name}
              onClick={() => toggleCategory(name)}
              className="px-3 py-1 rounded-full text-[11px] font-mono transition-all border"
              style={{
                background: active ? color + "18" : "transparent",
                borderColor: active ? color + "50" : "#2a2a3a",
                color: active ? color : "#555",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Virtualized grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-4 py-3"
        style={{ paddingBottom: compareIds.size > 0 ? 300 : 16 }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const startIdx = virtualRow.index * columnCount;
            const rowItems = filteredSamples.slice(
              startIdx,
              startIdx + columnCount
            );

            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 right-0"
                style={{
                  top: virtualRow.start,
                  height: virtualRow.size,
                  display: "grid",
                  gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                  gap: 8,
                }}
              >
                {rowItems.map((d) => {
                  const isComparing = compareIds.has(d.sample.id);
                  const isHovered = hoveredId === d.sample.id;
                  const isSelected = selectedSample?.id === d.sample.id;
                  const isDimmed =
                    compareIds.size > 0 && !isComparing && !isHovered;
                  const filename =
                    d.sample.path.split("/").pop() ?? d.sample.path;
                  const isVocal = d.sample.sample_type?.toLowerCase().includes("vocal") ?? false;

                  return (
                    <div
                      key={d.sample.id}
                      className="rounded-lg p-2 cursor-pointer transition-all text-center"
                      style={{
                        background: isComparing
                          ? d.color + "10"
                          : isHovered || isSelected
                            ? "#12121f"
                            : "#0d0d18",
                        border: `1px solid ${
                          isComparing
                            ? d.color + "40"
                            : isSelected
                              ? "#667"
                              : isHovered
                                ? "#2a2a40"
                                : "#1a1a2a"
                        }`,
                        transform: isHovered ? "scale(1.03)" : "scale(1)",
                        opacity: isDimmed ? 0.3 : 1,
                      }}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          toggleCompare(d.sample.id);
                        } else {
                          onSelect(d.sample);
                        }
                      }}
                      onDoubleClick={() => onPlay(d.sample)}
                      onMouseEnter={() => setHoveredId(d.sample.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <div className="flex justify-center">
                        <MiniRadar
                          attrs={d.attrs}
                          color={d.color}
                          size={isHovered ? 90 : 80}
                          showLabels={isHovered}
                          highlight={isComparing || isHovered}
                          unanalyzed={d.coverage < 0.5}
                          isVocal={isVocal}
                        />
                      </div>
                      <div
                        className="text-[9px] font-mono mt-1 truncate"
                        style={{ color: isDimmed ? "#333" : "#888" }}
                        title={filename}
                      >
                        {filename}
                      </div>
                      <div className="flex items-center justify-center gap-1 mt-0.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: isDimmed ? "#222" : d.color }}
                        />
                        <span
                          className="text-[8px] font-mono"
                          style={{ color: isDimmed ? "#2a2a2a" : "#555" }}
                        >
                          {d.sample.sample_type || "unknown"}
                        </span>
                      </div>
                      {d.sample.bpm && (
                        <div
                          className="text-[8px] font-mono mt-0.5"
                          style={{ color: isDimmed ? "#222" : "#444" }}
                        >
                          {Math.round(d.sample.bpm)} bpm
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Compare panel */}
      <ComparePanel
        compareSamples={compareSamples}
        onRemove={(id) => toggleCompare(id)}
        onClose={() => setCompareIds(new Set())}
      />
    </div>
  );
}

export default RadarComparator;

/**
 * Standalone MiniRadar for use in SampleDetails sidebar.
 * Re-exported for App.tsx integration.
 */
export { MiniRadar };
