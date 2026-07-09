/**
 * Sunchaser Design Studio V1 — HelioScope-style solar design workflow.
 * Left controls · Center canvas (Roof Studio) · Right live engine results.
 * Draft only. No CRM mutation / save. Feature-flagged.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  DraftingCompass,
  Layers,
  MapPin,
  Phone,
  Ruler,
  Sparkles,
  Square,
  Sun,
  Zap,
} from "lucide-react";
import type { Lead } from "../../types";
import {
  DEFAULT_DESIGN_CONTROLS,
  DESIGN_STUDIO_GUIDED_STEPS,
  DESIGN_WORKSPACE_DRAFT_ONLY_LABEL,
  MODULE_OPTIONS,
  buildDesignStudioLiveResults,
  canRunAutoLayout,
  designStudioWizardProgress,
  displayCustomerPhone,
  prefillAddressFromLead,
  primaryPlane,
  runDesignStudioAutoLayout,
  type DesignStudioControls,
  type DesignStudioLiveResults,
} from "../../lib/sunchaserDesignStudioClient";
import { STRUCTURE_TYPES, SYSTEM_TYPES, EQUIPMENT_TIERS } from "../../../server/solar/proposal/SolarProposalModels.ts";
import type { RoofStudioState } from "../../lib/roofStudioClient";
import RoofIntelligenceStudio, {
  type ProjectDesignContext,
  type RoofStudioApi,
} from "./RoofIntelligenceStudio";
import { DEFAULT_SITE_GEO, type SiteGeoReference } from "../../lib/roofStudioGeoReference";
import { formatLeadLocation, sanitizeLeadLocationInput } from "../../lib/leadDisplay";

export interface SunchaserDesignStudioProps {
  lead: Lead;
  sanctionedLoad?: string | number | null;
}

function resolveSanctionedLoad(lead: Lead, override?: string | number | null): string {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return String(override).trim();
  }
  if (lead.sanctionedLoad != null && Number.isFinite(Number(lead.sanctionedLoad))) {
    return `${lead.sanctionedLoad} kW`;
  }
  return "Not set";
}

function initialAddress(lead: Lead): string {
  const prefilled = prefillAddressFromLead(lead);
  if (prefilled) return prefilled;
  const fromFormat = formatLeadLocation(lead);
  if (fromFormat !== "Location not specified") return fromFormat;
  return sanitizeLeadLocationInput(lead.address) || sanitizeLeadLocationInput(lead.location) || "";
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function SunchaserDesignStudio({
  lead,
  sanctionedLoad,
}: SunchaserDesignStudioProps) {
  const [address, setAddress] = useState(() => initialAddress(lead));
  const [controls, setControls] = useState<DesignStudioControls>(() => ({
    ...DEFAULT_DESIGN_CONTROLS,
  }));
  const [layoutResult, setLayoutResult] = useState<DesignStudioLiveResults["layout"]>(null);
  const [autoLayoutMessage, setAutoLayoutMessage] = useState<string | null>(null);
  const [studioSnap, setStudioSnap] = useState<{
    state: RoofStudioState | null;
    hasImage: boolean;
    calibrated: boolean;
  }>({ state: null, hasImage: false, calibrated: false });

  const studioApiRef = useRef<RoofStudioApi | null>(null);
  const customerPhone = displayCustomerPhone(lead.phone);

  const geoSeed: SiteGeoReference = useMemo(
    () => ({
      ...DEFAULT_SITE_GEO,
      siteLabel: address.trim() || lead.name || "",
    }),
    [address, lead.name]
  );

  const project: ProjectDesignContext = useMemo(
    () => ({
      leadId: lead.id,
      customerName: lead.name || "Customer",
      phone: lead.phone || "",
      address,
      sanctionedLoad: resolveSanctionedLoad(lead, sanctionedLoad),
      geoSeed,
    }),
    [lead, address, sanctionedLoad, geoSeed]
  );

  const hasCompletePlane = Boolean(studioSnap.state && primaryPlane(studioSnap.state));
  const hasKeepouts = Boolean(
    studioSnap.state?.planes.some((p) => p.obstacles.length > 0 || p.walkways.length > 0)
  );
  const hasPanels = Boolean(layoutResult && layoutResult.panelCount > 0);
  const live = useMemo(() => {
    if (!studioSnap.state) {
      return {
        draftOnly: true as const,
        ready: false,
        gatedReason: "Upload a roof image to begin.",
        panelCount: 0,
        dcKw: 0,
        inverterRecommendation: null,
        stringingStatus: "Not run",
        annualProductionKwh: null,
        monthlyProduction: [] as Array<{ label: string; kwh: number }>,
        cableEstimateM: null,
        boqTotal: null,
        proposalStatus: "Draft unavailable",
        warnings: ["Upload a roof image to begin."],
        panels: [],
        layout: null,
        electrical: null,
        simulation: null,
      };
    }
    return buildDesignStudioLiveResults(studioSnap.state, controls, layoutResult, {
      hasImage: studioSnap.hasImage,
    });
  }, [studioSnap, controls, layoutResult]);

  const wizard = designStudioWizardProgress({
    hasImage: studioSnap.hasImage,
    calibrated: studioSnap.calibrated,
    hasCompletePlane,
    hasKeepouts,
    moduleSelected: Boolean(controls.moduleId),
    hasPanels,
    hasBoq: live.boqTotal != null && live.boqTotal > 0,
  });

  const onStudioStateChange = useCallback(
    (snap: { state: RoofStudioState; hasImage: boolean; calibrated: boolean }) => {
      setStudioSnap(snap);
      if (!snap.calibrated || !snap.hasImage) {
        setLayoutResult(null);
      }
    },
    []
  );

  const patchControls = <K extends keyof DesignStudioControls>(key: K, value: DesignStudioControls[K]) => {
    setControls((c) => ({ ...c, [key]: value }));
    setLayoutResult(null);
    setAutoLayoutMessage(null);
  };

  const handleAutoLayout = () => {
    const api = studioApiRef.current;
    if (!api) {
      setAutoLayoutMessage("Canvas not ready.");
      return;
    }
    const state = api.getState();
    const gate = canRunAutoLayout(api.hasImage(), api.isCalibrated(), Boolean(primaryPlane(state)));
    if (!gate.ok) {
      setAutoLayoutMessage(gate.reason);
      setLayoutResult(null);
      return;
    }
    const result = runDesignStudioAutoLayout(state, controls, { hasImage: api.hasImage() });
    if (!result.ok) {
      setAutoLayoutMessage(result.message);
      setLayoutResult(null);
      return;
    }
    setLayoutResult(result.layout);
    setAutoLayoutMessage(
      result.layout.panelCount > 0
        ? `Auto Layout placed ${result.layout.panelCount} panels (${result.layout.dcCapacityKw.toFixed(2)} kW DC).`
        : "Auto Layout ran — no panels fit under current constraints."
    );
  };

  const overlayPanels = useMemo(
    () =>
      (layoutResult?.panels ?? []).map((p) => ({
        id: p.panelId,
        x: p.x,
        y: p.y,
        widthUnits: p.widthUnits,
        heightUnits: p.heightUnits,
      })),
    [layoutResult]
  );

  const showGuidedEmpty = !studioSnap.hasImage;

  return (
    <div className="space-y-3 text-left fade-in-entry">
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/25 p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-400/25 to-amber-600/10">
            <DraftingCompass className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight text-white">Sunchaser Design Studio</h2>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                V1 · HelioScope workflow
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                Draft only
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Customer → image → calibrate → boundary → keepouts → module → Auto Layout → BOQ. Existing engines only. No AI guessing.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Customer</p>
            <p className="mt-0.5 text-sm font-bold text-white truncate">{lead.name || "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <Phone className="h-3 w-3" /> Phone
            </p>
            <p className="mt-0.5 text-sm font-mono text-slate-200 truncate" data-testid="design-studio-customer-phone">
              {customerPhone}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 sm:col-span-2 lg:col-span-1">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Address
            </p>
            <p className="mt-0.5 text-sm text-slate-200 truncate">{address || "Not set"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <Zap className="h-3 w-3" /> Sanctioned load
            </p>
            <p className="mt-0.5 text-sm font-mono text-amber-200">{resolveSanctionedLoad(lead, sanctionedLoad)}</p>
          </div>
        </div>

        <ol className="mt-3 flex flex-wrap gap-1.5">
          {DESIGN_STUDIO_GUIDED_STEPS.map((step) => {
            const done = wizard.completedThrough >= step.id;
            const current = wizard.currentStep === step.id;
            return (
              <li
                key={step.id}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : current
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                      : "border-slate-800 bg-slate-950 text-slate-500"
                }`}
              >
                {done ? <CheckCircle2 className="h-3 w-3" /> : <span className="font-mono">{step.id}</span>}
                <span className="hidden sm:inline">{step.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <aside className="xl:col-span-3 space-y-2 max-h-[780px] overflow-y-auto pr-1">
          <Section title="Project / Address" icon={MapPin}>
            <p className="text-[10px] text-slate-400 truncate">{lead.name || "Customer"}</p>
            <p className="mt-1 text-[10px] font-mono text-slate-300 truncate" data-testid="design-studio-sidebar-phone">
              {customerPhone}
            </p>
            <label className="mt-2 block text-[10px] text-slate-500">
              Site address
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, area, city"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <p className="mt-1 text-[9px] text-amber-300/90" data-testid="design-workspace-draft-only">
              {DESIGN_WORKSPACE_DRAFT_ONLY_LABEL}
            </p>
            <p className="mt-1 text-[9px] text-slate-500">
              Sanctioned load: {resolveSanctionedLoad(lead, sanctionedLoad)}
            </p>
          </Section>

          <Section title="Roof Area" icon={Layers}>
            <p className="text-[10px] text-slate-400">
              Draw roof boundary on the canvas after calibration. Gross / usable area come from Roof Geometry Engine.
            </p>
            <button
              type="button"
              onClick={() => studioApiRef.current?.setTool("plane")}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-800"
            >
              Draw roof plane
            </button>
          </Section>

          <Section title="Keepouts / Obstacles" icon={Square}>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["obstacle-rect", "Rect"],
                  ["obstacle-polygon", "Polygon"],
                  ["walkway", "Walkway"],
                  ["parapet", "Parapet"],
                ] as const
              ).map(([tool, label]) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => studioApiRef.current?.setTool(tool)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[9px] font-bold text-slate-300 hover:bg-slate-800"
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Module selection" icon={Sun}>
            <select
              value={controls.moduleId}
              onChange={(e) => patchControls("moduleId", e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
            >
              {MODULE_OPTIONS.map((m) => (
                <option key={m.moduleId} value={m.moduleId}>
                  {m.name} ({m.wattage}W · {m.widthM}×{m.heightM}m)
                </option>
              ))}
            </select>
          </Section>

          <Section title="Racking / Structure" icon={Layers}>
            <select
              value={controls.structureType}
              onChange={(e) => patchControls("structureType", e.target.value as DesignStudioControls["structureType"])}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
            >
              {STRUCTURE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s === "elevated_hbeam" ? "Elevated H-Beam / C-Channel" : "Standard roof mount"}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[9px] text-slate-500">
                System
                <select
                  value={controls.systemType}
                  onChange={(e) => patchControls("systemType", e.target.value as DesignStudioControls["systemType"])}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-white"
                >
                  {SYSTEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[9px] text-slate-500">
                Package
                <select
                  value={controls.tier}
                  onChange={(e) => patchControls("tier", e.target.value as DesignStudioControls["tier"])}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-white"
                >
                  {EQUIPMENT_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Section>

          <Section title="Tilt / Azimuth" icon={Compass}>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] text-slate-500">
                Tilt °
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={controls.tiltDeg}
                  onChange={(e) => patchControls("tiltDeg", Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="text-[9px] text-slate-500">
                Azimuth °
                <input
                  type="number"
                  min={0}
                  max={360}
                  value={controls.azimuthDeg}
                  onChange={(e) => patchControls("azimuthDeg", Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
            </div>
          </Section>

          <Section title="Row / Module spacing" icon={Ruler}>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] text-slate-500">
                Row spacing (m)
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={controls.rowSpacingM}
                  onChange={(e) => patchControls("rowSpacingM", Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="text-[9px] text-slate-500">
                Module gap (m)
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={controls.moduleGapM}
                  onChange={(e) => patchControls("moduleGapM", Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
            </div>
          </Section>

          <Section title="Setback" icon={Ruler}>
            <label className="text-[9px] text-slate-500">
              Edge setback (m)
              <input
                type="number"
                step={0.05}
                min={0}
                value={controls.edgeSetbackM}
                onChange={(e) => patchControls("edgeSetbackM", Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
              />
            </label>
          </Section>

          <button
            type="button"
            onClick={handleAutoLayout}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400"
          >
            <Sparkles className="h-4 w-4" />
            Auto Layout
          </button>
          {autoLayoutMessage && (
            <p className="text-[10px] text-amber-200/90 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
              {autoLayoutMessage}
            </p>
          )}
          <p className="text-[9px] text-slate-500">
            Uses Panel Layout Engine V2. Requires image + calibrated scale + roof boundary. No panels before calibration.
          </p>
        </aside>

        <div className="xl:col-span-6 space-y-2">
          {showGuidedEmpty && (
            <div className="rounded-2xl border border-dashed border-amber-500/40 bg-slate-950/80 px-4 py-6 text-center">
              <Sun className="mx-auto h-8 w-8 text-amber-400/80" />
              <h3 className="mt-2 text-sm font-bold text-white">Start with a roof image</h3>
              <p className="mt-1 text-[11px] text-slate-400 max-w-md mx-auto">
                Blank CAD is disabled. Upload a Google Earth / satellite rooftop image, calibrate scale with a known distance, then draw the roof.
              </p>
              <button
                type="button"
                onClick={() => studioApiRef.current?.openImagePicker()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
              >
                Upload roof image
              </button>
            </div>
          )}
          <RoofIntelligenceStudio
            key={lead.id}
            project={project}
            workspaceMode
            chromeMode="canvas"
            studioApiRef={studioApiRef}
            onStudioStateChange={onStudioStateChange}
            overlayPanels={overlayPanels}
          />
        </div>

        <aside className="xl:col-span-3 space-y-2 max-h-[780px] overflow-y-auto">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Live results</h3>
            </div>
            {live.gatedReason && (
              <p className="text-[10px] text-amber-300/90 flex gap-1.5 items-start">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {live.gatedReason}
              </p>
            )}
            <ResultRow label="Panel count" value={String(live.panelCount)} />
            <ResultRow label="DC kW" value={fmt(live.dcKw, 2)} />
            <ResultRow label="Inverter" value={live.inverterRecommendation ?? "—"} />
            <ResultRow label="Stringing" value={live.stringingStatus} />
            <ResultRow
              label="Annual production"
              value={live.annualProductionKwh != null ? `${fmt(live.annualProductionKwh, 0)} kWh` : "—"}
            />
            <ResultRow
              label="Cable estimate"
              value={live.cableEstimateM != null ? `${fmt(live.cableEstimateM, 0)} m` : "—"}
            />
            <ResultRow
              label="BOQ total"
              value={live.boqTotal != null ? `PKR ${fmt(live.boqTotal, 0)}` : "—"}
            />
            <ResultRow label="Proposal" value={live.proposalStatus} />
          </div>

          {live.monthlyProduction.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-white mb-2">Monthly production</h3>
              <ul className="grid grid-cols-3 gap-1">
                {live.monthlyProduction.map((m) => (
                  <li key={m.label} className="rounded-md bg-slate-950 px-1.5 py-1 text-center">
                    <div className="text-[8px] uppercase text-slate-500">{m.label}</div>
                    <div className="text-[10px] font-mono text-slate-200">{fmt(m.kwh, 0)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {live.warnings.length > 0 && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-rose-300 mb-1">Warnings</h3>
              <ul className="space-y-1">
                {live.warnings.slice(0, 8).map((w) => (
                  <li key={w} className="text-[10px] text-rose-200/90">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[9px] text-slate-500 px-1">
            Results from Panel Layout V2, Electrical Design, Solar Simulation, and Proposal/BOQ engines. Not saved.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-amber-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px]">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-right font-medium text-slate-100 break-words">{value}</span>
    </div>
  );
}
