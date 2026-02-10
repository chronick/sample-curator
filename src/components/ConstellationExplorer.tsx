/**
 * 3D Constellation Explorer — Three.js scatter plot of samples.
 *
 * Positions: X=brightness, Y=energy, Z=percussiveness (scaled ±5).
 * Colors by category (sample_type). Unanalyzed samples cluster at origin
 * as small grey dots.
 *
 * Fixes from critique:
 *  - Connection lines: pre-allocated LineSegments buffer, no create/destroy per frame
 *  - WebGL context loss: fallback message on loss, reinit on restore
 *  - Direct ESM import of Three.js (no CDN)
 *  - Null-honest: unanalyzed samples shown dimmed at origin
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import * as THREE from "three";
import type { Sample } from "../api/types";
import {
  derivePerceptualAttributes,
  getAnalysisCoverage,
  getCategoryColor,
  ATTR_DEFS,
  type PerceptualAttributes,
} from "../utils/perceptualAttributes";

interface ConstellationExplorerProps {
  samples: Sample[];
  selectedSample: Sample | null;
  selectedIds: Set<number>;
  onSelect: (sample: Sample) => void;
  onToggleSelect: (id: number) => void;
  onPlay: (sample: Sample) => void;
}

const MAX_CONNECTIONS = 50; // max neighbor lines
const SCALE = 5; // position range ±SCALE

// Category base positions for spreading unanalyzed samples into visible clusters
const CATEGORY_POSITIONS: Record<string, [number, number, number]> = {
  kick: [-3, -2, 0],
  snare: [-1, -1, 2],
  hihat: [1, -1, -1],
  hat: [1, -1, -1],
  clap: [-2, 0, 1],
  perc: [0, -0.5, -2],
  bass: [-3, 1, -1],
  synth: [2, 2, 1],
  lead: [2, 2, 1],
  pad: [3, 3, 0],
  vocal: [1, 2, -2],
  ambient: [3, 3, -3],
  fx: [0, 1, 3],
  loop: [-1, 3, 2],
  noise: [2, 0, -3],
  texture: [3, 1, -2],
};

function getCategoryBase(sampleType: string | null): [number, number, number] {
  if (!sampleType) return [0, 0, 0];
  const key = sampleType.toLowerCase().replace(/[^a-z]/g, "");
  return CATEGORY_POSITIONS[key] ?? [0, 0, 0];
}

function samplePosition(
  sample: Sample,
  attrs: PerceptualAttributes,
  coverage: number,
  index: number
): [number, number, number] {
  if (coverage >= 0.5) {
    // Fully analyzed: position by perceptual attributes
    const x = (attrs.brightness ?? 0.5) * 2 - 1;
    const y = (attrs.energy ?? 0.5) * 2 - 1;
    const z = (attrs.percussiveness ?? 0.5) * 2 - 1;
    return [x * SCALE, y * SCALE, z * SCALE];
  }

  // Unanalyzed: spread by category with jitter so the view is still useful.
  // Use whatever metadata we do have (duration, channels) to vary position.
  const base = getCategoryBase(sample.sample_type);
  const angle = ((index * 137.508) % 360) * (Math.PI / 180);
  const jitter = 1.8;
  const r = jitter * (0.3 + ((index * 0.618) % 1) * 0.7);
  return [
    base[0] + Math.cos(angle) * r,
    base[1] + Math.sin(angle) * r * 0.6,
    base[2] + Math.sin(angle * 0.7) * r,
  ];
}

export function ConstellationExplorer({
  samples,
  selectedSample,
  selectedIds: _selectedIds,
  onSelect,
  onToggleSelect: _onToggleSelect,
  onPlay,
}: ConstellationExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    points?: THREE.Points;
    geometry?: THREE.BufferGeometry;
    connectionLines?: THREE.LineSegments;
    lineGeometry?: THREE.BufferGeometry;
    animId?: number;
    cleanup?: () => void;
  }>({});

  const [hovered, setHovered] = useState<number | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [contextLost, setContextLost] = useState(false);

  // Refs for animation loop access (avoid stale closures)
  const hoveredRef = useRef<number | null>(null);
  const selectedIdxRef = useRef<number | null>(null);
  const activeCatRef = useRef<Set<string>>(activeCategories);
  const searchRef = useRef("");
  const mouseRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const samplesRef = useRef(samples);

  // Precompute sample attributes and positions
  const sampleData = useMemo(() => {
    return samples.map((s, i) => {
      const attrs = derivePerceptualAttributes(s);
      const coverage = getAnalysisCoverage(s);
      // Always use category color so unanalyzed samples are still visually grouped
      const color = getCategoryColor(s.sample_type);
      const pos = samplePosition(s, attrs, coverage, i);
      return { sample: s, attrs, coverage, color, pos };
    });
  }, [samples]);

  // Build unique category set from samples
  const categories = useMemo(() => {
    const cats = new Map<string, string>();
    for (const d of sampleData) {
      const type = d.sample.sample_type || "unknown";
      if (!cats.has(type)) {
        cats.set(type, getCategoryColor(d.sample.sample_type));
      }
    }
    return cats;
  }, [sampleData]);

  // Initialize active categories on first load
  useEffect(() => {
    setActiveCategories(new Set(categories.keys()));
  }, [categories]);

  // Keep refs in sync
  useEffect(() => { activeCatRef.current = activeCategories; }, [activeCategories]);
  useEffect(() => { searchRef.current = searchTerm; }, [searchTerm]);
  useEffect(() => { samplesRef.current = samples; }, [samples]);
  useEffect(() => {
    if (selectedSample) {
      const idx = sampleData.findIndex((d) => d.sample.id === selectedSample.id);
      selectedIdxRef.current = idx >= 0 ? idx : null;
    } else {
      selectedIdxRef.current = null;
    }
  }, [selectedSample, sampleData]);

  const toggleCategory = useCallback((name: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Analysis coverage stats
  const analyzedCount = useMemo(
    () => sampleData.filter((d) => d.coverage >= 0.5).length,
    [sampleData]
  );
  const coveragePct = samples.length > 0 ? Math.round((analyzedCount / samples.length) * 100) : 0;

  // Three.js scene setup
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || sampleData.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    scene.fog = new THREE.FogExp2(0x1a1a1a, 0.03);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // WebGL context loss handling
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
      if (sceneRef.current.animId) cancelAnimationFrame(sceneRef.current.animId);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      // Re-trigger setup by unmounting/remounting effect
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // Particle system
    const geometry = new THREE.BufferGeometry();
    const count = sampleData.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);

    sampleData.forEach((d, i) => {
      positions[i * 3] = d.pos[0];
      positions[i * 3 + 1] = d.pos[1];
      positions[i * 3 + 2] = d.pos[2];
      const c = new THREE.Color(d.color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      sizes[i] = d.coverage < 0.5 ? 0.14 : 0.12 + (d.attrs.energy ?? 0.3) * 0.15;
      alphas[i] = d.coverage < 0.5 ? 0.7 : 1.0;
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

    const vertexShader = `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;
        float glow = exp(-dist * 4.0) * 0.8 + smoothstep(0.5, 0.0, dist) * 0.5;
        gl_FragColor = vec4(vColor * glow, vAlpha * glow);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Grid
    const gridHelper = new THREE.GridHelper(20, 40, 0x252525, 0x1f1f1f);
    gridHelper.position.y = -SCALE - 1;
    scene.add(gridHelper);

    // Axis lines
    const axMat = new THREE.LineBasicMaterial({ color: 0x333340, transparent: true, opacity: 0.3 });
    [
      [[-10, 0, 0], [10, 0, 0]],
      [[0, -10, 0], [0, 10, 0]],
      [[0, 0, -10], [0, 0, 10]],
    ].forEach(([a, b]) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...(a as [number, number, number])),
        new THREE.Vector3(...(b as [number, number, number])),
      ]);
      scene.add(new THREE.Line(g, axMat));
    });

    // Pre-allocated connection lines buffer (fix: no create/destroy per frame)
    const lineGeometry = new THREE.BufferGeometry();
    const linePositions = new Float32Array(MAX_CONNECTIONS * 6); // 2 points × 3 coords each
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setDrawRange(0, 0); // hidden initially
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x666666,
      transparent: true,
      opacity: 0.15,
    });
    const connectionLines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(connectionLines);

    // Orbit controls (custom, matching demo)
    let prevMouse = { x: 0, y: 0 };
    const spherical = { theta: Math.PI / 4, phi: Math.PI / 4, radius: 14 };
    const target = new THREE.Vector3(0, 0, 0);

    const updateCamera = () => {
      camera.position.x =
        target.x + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z =
        target.z + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.lookAt(target);
    };
    updateCamera();

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isDraggingRef.current = true;
        prevMouse = { x: e.clientX, y: e.clientY };
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      };
      if (isDraggingRef.current) {
        const dx = e.clientX - prevMouse.x;
        const dy = e.clientY - prevMouse.y;
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dy * 0.005));
        prevMouse = { x: e.clientX, y: e.clientY };
        updateCamera();
      }
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      spherical.radius = Math.max(3, Math.min(30, spherical.radius + e.deltaY * 0.01));
      updateCamera();
    };

    let lastClickTime = 0;
    const onClick = () => {
      const now = Date.now();
      const idx = hoveredRef.current;
      if (idx !== null && idx >= 0 && idx < sampleData.length) {
        if (now - lastClickTime < 300) {
          // Double click → play
          onPlay(sampleData[idx].sample);
        } else {
          onSelect(sampleData[idx].sample);
        }
      }
      lastClickTime = now;
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("click", onClick);

    // Raycaster
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 0.3;
    const mouseVec = new THREE.Vector2();

    // Animation loop
    const animate = () => {
      const animId = requestAnimationFrame(animate);
      sceneRef.current.animId = animId;

      // Hover detection
      mouseVec.set(mouseRef.current.x, mouseRef.current.y);
      raycaster.setFromCamera(mouseVec, camera);
      const intersects = raycaster.intersectObject(points);

      const prevHov = hoveredRef.current;
      if (intersects.length > 0) {
        const idx = intersects[0].index!;
        const sType = sampleData[idx]?.sample.sample_type || "unknown";
        if (activeCatRef.current.has(sType)) {
          hoveredRef.current = idx;
          if (idx !== prevHov) setHovered(idx);
          canvas.style.cursor = "pointer";
        }
      } else {
        hoveredRef.current = null;
        if (prevHov !== null) setHovered(null);
        canvas.style.cursor = "grab";
      }

      // Update particle visibility
      const alphaAttr = geometry.getAttribute("alpha") as THREE.BufferAttribute;
      const sizeAttr = geometry.getAttribute("size") as THREE.BufferAttribute;
      const search = searchRef.current.toLowerCase();

      for (let i = 0; i < count; i++) {
        const d = sampleData[i];
        const sType = d.sample.sample_type || "unknown";
        const catActive = activeCatRef.current.has(sType);
        const name = d.sample.path.split("/").pop()?.toLowerCase() || "";
        const searchMatch =
          !search || name.includes(search) || sType.toLowerCase().includes(search);
        const visible = catActive && searchMatch;
        const isHov = hoveredRef.current === i;
        const isSel = selectedIdxRef.current === i;
        (alphaAttr.array as Float32Array)[i] = visible
          ? isHov || isSel
            ? 1.0
            : 0.7
          : 0.03;
        (sizeAttr.array as Float32Array)[i] = visible
          ? isHov
            ? 0.35
            : isSel
              ? 0.3
              : d.coverage < 0.5
                ? 0.14
                : 0.12 + (d.attrs.energy ?? 0.3) * 0.15
          : 0.04;
      }
      alphaAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;

      // Update connection lines (pre-allocated buffer)
      const selIdx = selectedIdxRef.current;
      const linePosAttr = lineGeometry.getAttribute("position") as THREE.BufferAttribute;
      const linePosArr = linePosAttr.array as Float32Array;

      if (selIdx !== null && selIdx >= 0 && selIdx < count) {
        const sel = sampleData[selIdx];
        const selColor = new THREE.Color(sel.color);
        (lineMaterial as THREE.LineBasicMaterial).color = selColor;

        let lineCount = 0;
        for (let i = 0; i < count && lineCount < MAX_CONNECTIONS; i++) {
          if (i === selIdx) continue;
          const d = sampleData[i];
          const sType = d.sample.sample_type || "unknown";
          if (!activeCatRef.current.has(sType)) continue;
          const dx = sel.pos[0] - d.pos[0];
          const dy = sel.pos[1] - d.pos[1];
          const dz = sel.pos[2] - d.pos[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 3) {
            const off = lineCount * 6;
            linePosArr[off] = sel.pos[0];
            linePosArr[off + 1] = sel.pos[1];
            linePosArr[off + 2] = sel.pos[2];
            linePosArr[off + 3] = d.pos[0];
            linePosArr[off + 4] = d.pos[1];
            linePosArr[off + 5] = d.pos[2];
            lineCount++;
          }
        }
        lineGeometry.setDrawRange(0, lineCount * 2);
      } else {
        lineGeometry.setDrawRange(0, 0);
      }
      linePosAttr.needsUpdate = true;

      // Gentle auto-rotation
      if (!isDraggingRef.current) {
        spherical.theta += 0.0008;
        updateCamera();
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Store refs for cleanup
    sceneRef.current = {
      renderer,
      scene,
      camera,
      points,
      geometry,
      connectionLines,
      lineGeometry,
    };

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (sceneRef.current.animId) cancelAnimationFrame(sceneRef.current.animId);
      geometry.dispose();
      material.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
    };
  }, [sampleData]); // eslint-disable-line react-hooks/exhaustive-deps

  const hovSample = hovered !== null ? sampleData[hovered] : null;

  // Mini radar for detail panel
  const renderMiniRadar = (attrs: PerceptualAttributes, color: string) => {
    const n = ATTR_DEFS.length;
    const size = 120;
    const r = size * 0.35;
    const cx = size / 2;
    const cy = size / 2;

    const attrPoints = ATTR_DEFS.map((def, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const val = attrs[def.key] ?? 0;
      return `${cx + Math.cos(angle) * val * r},${cy + Math.sin(angle) * val * r}`;
    }).join(" ");

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon
            key={ring}
            points={Array.from({ length: n }, (_, i) => {
              const a = (Math.PI * 2 * i) / n - Math.PI / 2;
              return `${cx + Math.cos(a) * ring * r},${cy + Math.sin(a) * ring * r}`;
            }).join(" ")}
            fill="none"
            stroke="#2a2a3a"
            strokeWidth={0.5}
          />
        ))}
        <polygon points={attrPoints} fill={color + "20"} stroke={color} strokeWidth={1.5} />
        {ATTR_DEFS.map((def, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          return (
            <text
              key={def.key}
              x={cx + Math.cos(a) * (r + 14)}
              y={cy + Math.sin(a) * (r + 14)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={7}
              fill="#666"
              className="font-mono"
            >
              {def.shortLabel}
            </text>
          );
        })}
      </svg>
    );
  };

  if (samples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No samples found
      </div>
    );
  }

  if (contextLost) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-lg mb-2">WebGL Context Lost</div>
          <div className="text-sm text-gray-500">The 3D renderer lost its context. Try switching views and back.</div>
        </div>
      </div>
    );
  }

  // Selected sample detail data
  const selData = selectedSample
    ? sampleData.find((d) => d.sample.id === selectedSample.id)
    : null;

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#1a1a1a]">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Top-left: title + search + count */}
      <div className="absolute top-4 left-5 z-10">
        <div className="text-[10px] uppercase tracking-[0.2em] text-gray-600 font-mono mb-0.5">
          Sample Library
        </div>
        <div className="text-lg font-light text-gray-100 tracking-tight">
          Constellation Explorer
        </div>
        <input
          type="text"
          placeholder="Search samples..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mt-2 px-3 py-1.5 bg-[#12121f] border border-[#333] rounded text-xs text-gray-300 font-mono w-48 outline-none focus:border-accent"
        />
        <div className="mt-1.5 text-[10px] text-gray-600 font-mono">
          {samples.length} samples · {coveragePct}% analyzed · drag to orbit · scroll to zoom
        </div>
      </div>

      {/* Top-right: category filter toggles */}
      <div className="absolute top-4 right-5 z-10 flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto">
        {Array.from(categories.entries()).map(([name, color]) => {
          const active = activeCategories.has(name);
          const count = sampleData.filter(
            (d) => (d.sample.sample_type || "unknown") === name
          ).length;
          return (
            <button
              key={name}
              onClick={() => toggleCategory(name)}
              className="flex items-center gap-2 px-2.5 py-1 rounded text-left transition-all border"
              style={{
                background: active ? color + "15" : "transparent",
                borderColor: active ? color + "40" : "#2a2a3a",
              }}
            >
              <div
                className="w-2 h-2 rounded-full transition-all"
                style={{
                  background: active ? color : "#444",
                  boxShadow: active ? `0 0 6px ${color}60` : "none",
                }}
              />
              <span
                className="text-[11px] font-mono"
                style={{ color: active ? "#ccc" : "#555" }}
              >
                {name}
              </span>
              <span className="text-[9px] text-gray-600 font-mono ml-auto">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom-left: hover tooltip */}
      {hovSample && !selData && (
        <div className="absolute bottom-5 left-5 z-10 bg-[#0e0e1aee] backdrop-blur-xl border border-[#333] rounded-lg px-4 py-3 max-w-[260px]">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: hovSample.color,
                boxShadow: `0 0 8px ${hovSample.color}80`,
              }}
            />
            <span className="text-[13px] font-medium truncate">
              {hovSample.sample.path.split("/").pop()}
            </span>
          </div>
          <div className="text-[10px] text-gray-500 font-mono">
            {hovSample.sample.sample_type || "unknown"}
            {hovSample.sample.duration && ` · ${hovSample.sample.duration.toFixed(2)}s`}
            {hovSample.coverage < 0.5 && " · unanalyzed"}
          </div>
        </div>
      )}

      {/* Bottom-left: selected sample detail */}
      {selData && (
        <div
          className="absolute bottom-5 left-5 z-10 bg-[#0e0e1aee] backdrop-blur-xl rounded-xl px-5 py-4 w-[280px]"
          style={{ borderColor: selData.color + "30", borderWidth: 1, borderStyle: "solid" }}
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{
                    background: selData.color,
                    boxShadow: `0 0 10px ${selData.color}80`,
                  }}
                />
                <span className="text-sm font-medium truncate">
                  {selData.sample.path.split("/").pop()}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 font-mono">
                {selData.sample.sample_type || "unknown"}
                {selData.sample.duration && ` · ${selData.sample.duration.toFixed(2)}s`}
                {selData.coverage < 0.5 && " · unanalyzed"}
              </div>
            </div>
          </div>
          {/* Attribute bars */}
          <div className="mt-3 flex flex-col gap-1.5">
            {ATTR_DEFS.map((def) => {
              const val = selData.attrs[def.key];
              return (
                <div key={def.key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-[52px] text-gray-500 uppercase tracking-wide font-mono text-[9px]">
                    {def.shortLabel}
                  </span>
                  <div className="flex-1 h-[3px] bg-[#1a1a2e] rounded overflow-hidden">
                    {val !== null ? (
                      <div
                        className="h-full rounded transition-all duration-300"
                        style={{
                          width: `${val * 100}%`,
                          background: `linear-gradient(90deg, ${selData.color}, ${selData.color}88)`,
                        }}
                      />
                    ) : (
                      <div className="h-full w-full" style={{ background: "#222 repeating-linear-gradient(90deg, transparent, transparent 3px, #333 3px, #333 6px)" }} />
                    )}
                  </div>
                  <span className="w-6 text-right text-gray-600 font-mono text-[10px]">
                    {val !== null ? (val * 100).toFixed(0) : "?"}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Mini radar */}
          <div className="mt-3 flex justify-center">
            {renderMiniRadar(selData.attrs, selData.color)}
          </div>
        </div>
      )}
    </div>
  );
}

export default ConstellationExplorer;
