import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  BoxSelect,
  Cable,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid3X3,
  ImagePlus,
  Layers,
  MousePointer2,
  Pentagon,
  RotateCcw,
  Ruler,
  Sparkles,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import {
  DESIGN_INCOMPLETE_BOQ_LABEL,
  DESIGN_INCOMPLETE_MESSAGE,
  PACKAGE_OPTIONS,
  STRUCTURE_OPTIONS,
  SYSTEM_SIZE_PRESETS,
  SYSTEM_TYPE_OPTIONS,
  isDesignComplete,
  normalizeObstacles,
  type DesignObstacle,
  type DesignPackageTier,
  type DesignPoint,
  type DesignStructureType,
  type DesignSystemSizeSelection,
  type DesignSystemType,
  type DesignToolMode,
} from "../../lib/solarDesignStudio";
import { buildStudioProposalViewModel } from "../../lib/solarProposalStudioClient";

const CANVAS_W = 800;
const CANVAS_H = 500;

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function SolarProposalStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<DesignPoint | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [roofBoundary, setRoofBoundary] = useState<DesignPoint[]>([]);
  const [obstacles, setObstacles] = useState<DesignObstacle[]>([]);
  const [structureType, setStructureType] = useState<DesignStructureType>("standard");
  const [systemType, setSystemType] = useState<DesignSystemType>("on-grid");
  const [packageTier, setPackageTier] = useState<DesignPackageTier>("premium");
  const [targetSystemKw, setTargetSystemKw] = useState<DesignSystemSizeSelection>("auto");
  const [tool, setTool] = useState<DesignToolMode>("boundary");
  const [roofWidthMeters, setRoofWidthMeters] = useState(12);
  const [roofDepthMeters, setRoofDepthMeters] = useState(8);
  const [panelWattage, setPanelWattage] = useState(580);
  const [draftObstacle, setDraftObstacle] = useState<DesignObstacle | null>(null);
  const [panOffset, setPanOffset] = useState<DesignPoint>({ x: 0, y: 0 });
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const panStart = useRef<{ pointer: DesignPoint; offset: DesignPoint } | null>(null);

  const studio = useMemo(
    () =>
      buildStudioProposalViewModel({
        roofBoundary,
        obstacles,
        structureType,
        systemType,
        packageTier,
        targetSystemKw,
        roofWidthMeters,
        roofDepthMeters,
        panelWattage,
        canvasWidth: CANVAS_W,
        canvasHeight: CANVAS_H,
        siteComplexityScore: Math.min(10, obstacles.length),
      }),
    [
      roofBoundary,
      obstacles,
      structureType,
      systemType,
      packageTier,
      targetSystemKw,
      roofWidthMeters,
      roofDepthMeters,
      panelWattage,
    ]
  );

  const designComplete = studio.designComplete;
  const boqLines = studio.boqPreviewLines;
  const boqTotal = studio.grandTotal;
  const proposalPages = studio.proposalPages;

  const activePreview = proposalPages[previewPageIndex] ?? proposalPages[0];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);

    const bg = bgImageRef.current;
    if (bg) {
      ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = "#0a0f1a";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.strokeStyle = "rgba(148,163,184,0.12)";
      for (let x = 0; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y < CANVAS_H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
      }
    }

    if (roofBoundary.length > 0) {
      ctx.beginPath();
      ctx.moveTo(roofBoundary[0].x, roofBoundary[0].y);
      for (let i = 1; i < roofBoundary.length; i += 1) {
        ctx.lineTo(roofBoundary[i].x, roofBoundary[i].y);
      }
      if (roofBoundary.length >= 3) ctx.closePath();
      ctx.fillStyle = "rgba(245,158,11,0.14)";
      ctx.strokeStyle = "rgba(251,191,36,0.95)";
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      roofBoundary.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#fde68a" : "#f59e0b";
        ctx.fill();
        ctx.strokeStyle = "rgba(15,23,42,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    for (const obstacle of obstacles) {
      if (
        !Number.isFinite(obstacle.x) ||
        !Number.isFinite(obstacle.y) ||
        !Number.isFinite(obstacle.w) ||
        !Number.isFinite(obstacle.h) ||
        obstacle.w <= 0 ||
        obstacle.h <= 0
      ) {
        continue;
      }
      ctx.fillStyle = "rgba(244,63,94,0.28)";
      ctx.strokeStyle = "rgba(251,113,133,0.95)";
      ctx.lineWidth = 2;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }

    if (draftObstacle) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(251,113,133,0.8)";
      ctx.strokeRect(draftObstacle.x, draftObstacle.y, draftObstacle.w, draftObstacle.h);
      ctx.setLineDash([]);
    }

    for (const panel of studio.panelCells) {
      ctx.fillStyle = "rgba(56,189,248,0.62)";
      ctx.strokeStyle = "rgba(14,165,233,1)";
      ctx.lineWidth = 1.2;
      ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
      ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
    }

    ctx.restore();
  }, [roofBoundary, obstacles, draftObstacle, studio.panelCells, panOffset]);

  useEffect(() => {
    if (!imageUrl) {
      bgImageRef.current = null;
      draw();
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      draw();
    };
    img.src = imageUrl;
  }, [imageUrl, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    return () => {
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (previewPageIndex >= proposalPages.length) setPreviewPageIndex(0);
  }, [proposalPages.length, previewPageIndex]);

  const canvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): DesignPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX - panOffset.x,
      y: (e.clientY - rect.top) * scaleY - panOffset.y,
    };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "boundary") return;
    setRoofBoundary((prev) => [...prev, canvasPoint(e)]);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = canvasPoint(e);
    if (tool === "obstacle") {
      dragStart.current = p;
      setDraftObstacle({ id: "draft", x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === "pan") {
      panStart.current = { pointer: p, offset: { ...panOffset } };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = canvasPoint(e);
    if (tool === "obstacle" && dragStart.current) {
      const start = dragStart.current;
      setDraftObstacle({
        id: "draft",
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      });
      return;
    }
    if (tool === "pan" && panStart.current) {
      const dx = p.x - panStart.current.pointer.x;
      const dy = p.y - panStart.current.pointer.y;
      setPanOffset({ x: panStart.current.offset.x + dx, y: panStart.current.offset.y + dy });
    }
  };

  const handleMouseUp = () => {
    if (tool === "obstacle" && draftObstacle && draftObstacle.w > 8 && draftObstacle.h > 8) {
      const candidate = { ...draftObstacle, id: nextId("obs") };
      const normalized = normalizeObstacles([candidate], {
        canvasWidth: CANVAS_W,
        canvasHeight: CANVAS_H,
        roofBoundary,
        minSizePx: 8,
      });
      if (normalized.length > 0) {
        setObstacles((prev) => [...prev, normalized[0]]);
      }
    }
    setDraftObstacle(null);
    dragStart.current = null;
    panStart.current = null;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    e.target.value = "";
  };

  return (
    <div className="space-y-6 text-left fade-in-entry">
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/30 p-5 sm:p-6 shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-amber-600/10 border border-amber-500/30">
              <Sun className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-white tracking-tight">Solar Proposal Studio</h2>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                  Phase 1.1 · Engine Draft
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 max-w-2xl">
                Design rooftop layouts and preview BOQ using the same deterministic rules as{" "}
                <code className="text-amber-300/80">server/solar/proposal</code>. Draft only — no save, quotation, PDF, API, or AI.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7 space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 space-y-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Design canvas</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "boundary" as const, label: "Boundary", icon: Pentagon },
                    { id: "obstacle" as const, label: "Obstacles", icon: BoxSelect },
                    { id: "pan" as const, label: "Pan", icon: MousePointer2 },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = tool === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTool(item.id)}
                      className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold transition ${
                        active
                          ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                          : "border border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-200 hover:border-amber-500/40"
                >
                  <ImagePlus className="h-3.5 w-3.5 text-amber-400" />
                  Upload rooftop
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 ring-1 ring-white/5">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="w-full cursor-crosshair touch-none"
                onClick={handleCanvasClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => roofBoundary.length >= 3 && setTool("obstacle")}
                disabled={roofBoundary.length < 3}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-200 disabled:opacity-40"
              >
                Close boundary → mark obstacles
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoofBoundary([]);
                  setObstacles([]);
                  setDraftObstacle(null);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-800 px-3 py-1.5 text-[10px] font-bold text-slate-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => setObstacles([])}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-800 px-3 py-1.5 text-[10px] font-bold text-slate-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear obstacles
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Proposal preview pages</h3>
            </div>
            {proposalPages.length === 0 ? (
              <p className="text-xs text-slate-500">Draw a roof boundary to generate preview pages.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={previewPageIndex <= 0}
                    onClick={() => setPreviewPageIndex((i) => Math.max(0, i - 1))}
                    className="rounded-lg border border-slate-800 p-2 text-slate-400 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {proposalPages.map((page, idx) => (
                      <button
                        key={page.id}
                        type="button"
                        onClick={() => setPreviewPageIndex(idx)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                          idx === previewPageIndex
                            ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                            : "text-slate-500 border border-transparent hover:text-slate-300"
                        }`}
                      >
                        {page.title}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={previewPageIndex >= proposalPages.length - 1}
                    onClick={() => setPreviewPageIndex((i) => Math.min(proposalPages.length - 1, i + 1))}
                    className="rounded-lg border border-slate-800 p-2 text-slate-400 disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {activePreview && (
                  <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-950 to-violet-950/20 p-5 min-h-[220px]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400/80">
                      {activePreview.subtitle}
                    </p>
                    <h4 className="mt-1 text-xl font-bold text-white">{activePreview.title}</h4>
                    <div className="mt-4 space-y-3">
                      {activePreview.sections.map((section) => (
                        <div key={section.heading}>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {section.heading}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {section.lines.map((line) => (
                              <li key={line} className="text-xs text-slate-300 leading-relaxed">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Ruler className="h-4 w-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Roof & system</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Width (m)</label>
                <input
                  type="number"
                  min={4}
                  max={50}
                  value={roofWidthMeters}
                  onChange={(e) => setRoofWidthMeters(Number(e.target.value) || 12)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Depth (m)</label>
                <input
                  type="number"
                  min={4}
                  max={50}
                  value={roofDepthMeters}
                  onChange={(e) => setRoofDepthMeters(Number(e.target.value) || 8)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Target system size</label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTargetSystemKw("auto")}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    targetSystemKw === "auto"
                      ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                      : "border border-slate-800 text-slate-400"
                  }`}
                >
                  Auto fit
                </button>
                {SYSTEM_SIZE_PRESETS.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => setTargetSystemKw(kw)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      targetSystemKw === kw
                        ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                        : "border border-slate-800 text-slate-400"
                    }`}
                  >
                    {kw} kW
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Package</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PACKAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPackageTier(opt.id)}
                    className={`rounded-xl border px-3 py-2 text-left ${
                      packageTier === opt.id
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-slate-800 bg-slate-950"
                    }`}
                  >
                    <span className="block text-xs font-bold text-white">{opt.label}</span>
                    <span className="block text-[10px] text-slate-500">{opt.note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">System type</label>
              <div className="mt-2 space-y-1.5">
                {SYSTEM_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSystemType(opt.id)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left ${
                      systemType === opt.id
                        ? "border-cyan-500/40 bg-cyan-500/10"
                        : "border-slate-800 bg-slate-950"
                    }`}
                  >
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span>
                      <span className="block text-xs font-semibold text-white">{opt.label}</span>
                      <span className="block text-[10px] text-slate-500">{opt.note}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Structure type</label>
              <div className="mt-2 space-y-1.5">
                {STRUCTURE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStructureType(opt.id)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left ${
                      structureType === opt.id
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-slate-800 bg-slate-950"
                    }`}
                  >
                    <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>
                      <span className="block text-xs font-semibold text-white">{opt.label}</span>
                      <span className="block text-[10px] text-slate-500">{opt.note}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Panel wattage</label>
              <input
                type="number"
                min={400}
                max={700}
                value={panelWattage}
                onChange={(e) => setPanelWattage(Number(e.target.value) || 580)}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Grid3X3 className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Live estimates</h3>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                <dt className="text-slate-500">Panels</dt>
                <dd className="text-xl font-bold text-white">{studio.panelCount}</dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                <dt className="text-slate-500">System size</dt>
                <dd className="text-xl font-bold text-white">{studio.systemSizeKw} kW</dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                <dt className="text-slate-500 flex items-center gap-1">
                  <Cable className="h-3 w-3" /> Cable est.
                </dt>
                <dd className="text-xl font-bold text-white">
                  {studio.cableDistanceM} m
                  <span className="block text-[10px] font-normal text-slate-500">{studio.cableRolls} roll(s)</span>
                </dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                <dt className="text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Structure est.
                </dt>
                <dd className="text-xl font-bold text-white">
                  Rs. {studio.structureCost.toLocaleString()}
                </dd>
              </div>
            </dl>
            {studio.validationMessage && !designComplete && (
              <p className="text-[10px] text-amber-400/90">{studio.validationMessage}</p>
            )}
            {studio.warnings.length > 0 && designComplete && (
              <p className="text-[10px] text-slate-500">{studio.warnings.join(" ")}</p>
            )}
            {systemType !== "on-grid" && designComplete && (
              <p className="flex items-center gap-1.5 text-[10px] text-cyan-400/90">
                <Battery className="h-3.5 w-3.5" />
                Battery bank included in BOQ for {systemType} configuration.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">BOQ preview</h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500">engine draft</span>
            </div>
            {boqLines.length === 0 ? (
              <div className="text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-amber-400/90">{DESIGN_INCOMPLETE_BOQ_LABEL}</p>
                <p>{DESIGN_INCOMPLETE_MESSAGE}</p>
              </div>
            ) : (
              <ul className="max-h-52 space-y-2 overflow-y-auto">
                {boqLines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{line.name}</p>
                      <p className="text-[10px] text-slate-500">{line.category}</p>
                    </div>
                    <div className="shrink-0 text-right text-slate-300">
                      <div>
                        {line.quantity} {line.unit}
                      </div>
                      <div className="text-[10px] text-slate-500">@ {line.indicativeRate.toLocaleString()}</div>
                      <div className="text-[10px] text-emerald-400/80">Rs. {line.lineTotal.toLocaleString()}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-sm">
              <span className="text-slate-400">Indicative total</span>
              <span className="font-bold text-emerald-400">
                {designComplete && isDesignComplete(studio.panelCount, studio.systemSizeKw)
                  ? `Rs. ${boqTotal.toLocaleString()}`
                  : "Rs. 0"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
