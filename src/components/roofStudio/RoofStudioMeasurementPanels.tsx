import React from "react";
import { AlertTriangle, FileText, Ruler } from "lucide-react";
import type { ScaleCalibration } from "../../lib/roofStudioCalibration.ts";
import { formatDualUnits, formatMeters } from "../../lib/roofStudioCalibration.ts";
import type { EditableBoqLine } from "../../lib/roofStudioBoq.ts";
import { boqGrandTotal, lineTotal, updateBoqLine, type BoqUpdateResult } from "../../lib/roofStudioBoq.ts";
import type { ReportPage } from "../../lib/roofStudioReport.ts";
import type { PanelModuleSpec } from "../../lib/roofStudioPanels.ts";
import type { StructureLayout } from "../../lib/roofStudioStructure.ts";
import type { SiteGeoReference } from "../../lib/roofStudioGeoReference.ts";
import {
  deriveWizardProgress,
  gpsAnchorLatText,
  gpsAnchorLngText,
  parseOptionalMapZoomText,
  tryApplyGpsAnchorTexts,
  validateSiteGeoReference,
  WIZARD_STEP_LABELS,
  type WizardStep,
} from "../../lib/roofStudioGeoReference.ts";
import { MapPin, CheckCircle2, Circle } from "lucide-react";

export function CalibrationBanner({
  calibrated,
  calibration,
  metersPerUnit,
  onOpenCalibrate,
}: {
  calibrated: boolean;
  calibration: ScaleCalibration | null;
  metersPerUnit: number;
  onOpenCalibrate: () => void;
}) {
  if (calibrated && calibration) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
        <p className="font-bold">Scale calibrated</p>
        <p>
          Reference: {calibration.inputLabel} ({formatMeters(calibration.realLengthM)}) · 1u = {metersPerUnit.toFixed(4)} m
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 space-y-2">
      <p className="font-bold flex items-center gap-1.5">
        <Ruler className="h-3.5 w-3.5" />
        Scale not calibrated
      </p>
      <p>Draw a known-distance line on the roof image (like Google Earth ruler). Panel counts, BOQ, and layout report are hidden until calibration.</p>
      <button
        type="button"
        onClick={onOpenCalibrate}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-[10px] font-bold text-slate-950"
      >
        Start scale calibration
      </button>
    </div>
  );
}

export function CalibrationDialog({
  open,
  distanceInput,
  onDistanceChange,
  onApply,
  onCancel,
}: {
  open: boolean;
  distanceInput: string;
  onDistanceChange: (v: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-xl">
        <h3 className="text-sm font-bold text-white">Enter known distance</h3>
        <p className="text-xs text-slate-400">Examples: <code className="text-cyan-300">51 ft 9 in</code>, <code className="text-cyan-300">15 m</code>, <code className="text-cyan-300">15.77m</code></p>
        <input
          autoFocus
          value={distanceInput}
          onChange={(e) => onDistanceChange(e.target.value)}
          placeholder="51 ft 9 in"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300">
            Cancel
          </button>
          <button type="button" onClick={onApply} className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950">
            Apply scale
          </button>
        </div>
      </div>
    </div>
  );
}

export function CalibrationWizard({
  hasImage,
  calibrated,
  hasCompletePlane,
  hasPanels,
  hasBoq = false,
  onGoToStep,
  title = "Project design steps",
}: {
  hasImage: boolean;
  calibrated: boolean;
  hasCompletePlane: boolean;
  hasPanels: boolean;
  hasBoq?: boolean;
  onGoToStep?: (step: WizardStep) => void;
  title?: string;
}) {
  const progressOpts = { hasImage, calibrated, hasCompletePlane, hasPanels, hasBoq };
  const { currentStep, completedThrough } = deriveWizardProgress(progressOpts);
  const steps = [1, 2, 3, 4, 5, 6] as const;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">{title}</h3>
      <ol className="space-y-2">
        {steps.map((step) => {
          const done = step <= completedThrough;
          const active = step === currentStep;
          const Icon = done ? CheckCircle2 : Circle;
          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => onGoToStep?.(step)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  active ? "bg-cyan-500/15 border border-cyan-500/30" : "hover:bg-slate-800/60"
                }`}
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${done ? "text-emerald-400" : active ? "text-cyan-300" : "text-slate-600"}`} />
                <div>
                  <p className={`text-[10px] font-bold ${active ? "text-cyan-100" : "text-slate-300"}`}>
                    Step {step}: {WIZARD_STEP_LABELS[step]}
                  </p>
                  {active && (
                    <p className="text-[9px] text-slate-500 mt-0.5">
                      {step === 1 && "Upload a Google Earth or map screenshot (stays on device)."}
                      {step === 2 && "Draw a known-distance line and enter ft/in or meters."}
                      {step === 3 && "Trace the roof boundary (≥3 points)."}
                      {step === 4 && "Auto-fill or place panels after the roof is drawn."}
                      {step === 5 && "Review the draft BOQ generated from panels and structure."}
                      {step === 6 && "Review the layout report / proposal draft pages."}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function GeoReferenceEditor({
  geo,
  northAzimuthDeg,
  geoError,
  onChange,
  onNorthChange,
  onValidationError,
}: {
  geo: SiteGeoReference;
  northAzimuthDeg: number;
  geoError: string | null;
  onChange: (geo: SiteGeoReference) => void;
  onNorthChange: (deg: number) => void;
  onValidationError?: (error: string) => void;
}) {
  const [latText, setLatText] = React.useState(() => gpsAnchorLatText(geo));
  const [lngText, setLngText] = React.useState(() => gpsAnchorLngText(geo));
  const [mapZoomText, setMapZoomText] = React.useState(() => (geo.mapZoom === null ? "" : String(geo.mapZoom)));
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLatText(gpsAnchorLatText(geo));
    setLngText(gpsAnchorLngText(geo));
    setMapZoomText(geo.mapZoom === null ? "" : String(geo.mapZoom));
  }, [geo.latitude, geo.longitude, geo.mapZoom]);

  const commitGpsFields = (nextLat: string, nextLng: string) => {
    const result = tryApplyGpsAnchorTexts(geo, nextLat, nextLng);
    if (!result.ok) {
      setFieldError((result as any).error);
      onValidationError?.((result as any).error);
      return;
    }
    setFieldError(null);
    onChange(result.geo);
  };

  const displayError = fieldError ?? geoError;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2">
        <MapPin className="h-4 w-4 text-cyan-400" />
        Site coordinates
      </h3>
      <p className="text-[9px] text-slate-500">Optional GPS anchor for map/Earth reference. Leave blank if unknown.</p>
      {displayError && <p className="text-[10px] text-rose-400">{displayError}</p>}
      <label className="block text-[10px] text-slate-500">
        Site / address label
        <input
          value={geo.siteLabel}
          onChange={(e) => onChange({ ...geo, siteLabel: e.target.value })}
          placeholder="e.g. Lahore warehouse roof"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] text-slate-500">
          Latitude°
          <input
            type="text"
            inputMode="decimal"
            value={latText}
            onChange={(e) => {
              const next = e.target.value;
              setLatText(next);
              commitGpsFields(next, lngText);
            }}
            placeholder="31.5204"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
          />
        </label>
        <label className="block text-[10px] text-slate-500">
          Longitude°
          <input
            type="text"
            inputMode="decimal"
            value={lngText}
            onChange={(e) => {
              const next = e.target.value;
              setLngText(next);
              commitGpsFields(latText, next);
            }}
            placeholder="74.3587"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] text-slate-500">
          North orientation°
          <input
            type="number"
            step={1}
            value={northAzimuthDeg}
            onChange={(e) => {
              const v = Number(e.target.value);
              onNorthChange(Number.isFinite(v) ? v : 0);
            }}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
          />
        </label>
        <label className="block text-[10px] text-slate-500">
          Map zoom (optional)
          <input
            type="text"
            inputMode="numeric"
            value={mapZoomText}
            onChange={(e) => {
              const next = e.target.value;
              setMapZoomText(next);
              const parsed = parseOptionalMapZoomText(next);
              if (!parsed.ok) {
                setFieldError((parsed as any).error);
                onValidationError?.((parsed as any).error);
                return;
              }
              setFieldError(null);
              onChange({ ...geo, mapZoom: parsed.value });
            }}
            placeholder="18"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
          />
        </label>
      </div>
    </div>
  );
}

export { validateSiteGeoReference };

export function PanelSpecEditor({
  spec,
  calibrated,
  onChange,
  onAutoFill,
  panelCount,
  systemKw,
}: {
  spec: PanelModuleSpec;
  calibrated: boolean;
  onChange: (spec: PanelModuleSpec) => void;
  onAutoFill: () => void;
  panelCount: number;
  systemKw: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Panel placement</h3>
      {!calibrated && <p className="text-[10px] text-amber-400">Calibrate scale before placing panels.</p>}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <label className="text-slate-500">
          Width (m)
          <input type="number" step={0.001} disabled={!calibrated} value={spec.widthM} onChange={(e) => onChange({ ...spec, widthM: Number(e.target.value) || spec.widthM })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        <label className="text-slate-500">
          Height (m)
          <input type="number" step={0.001} disabled={!calibrated} value={spec.heightM} onChange={(e) => onChange({ ...spec, heightM: Number(e.target.value) || spec.heightM })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        <label className="text-slate-500">
          Gap (m)
          <input type="number" step={0.01} disabled={!calibrated} value={spec.gapM} onChange={(e) => onChange({ ...spec, gapM: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        <label className="text-slate-500">
          Row spacing (m)
          <input type="number" step={0.01} disabled={!calibrated} value={spec.rowSpacingM} onChange={(e) => onChange({ ...spec, rowSpacingM: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={!calibrated} onClick={() => onChange({ ...spec, orientation: "portrait" })} className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-bold ${spec.orientation === "portrait" ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40" : "border border-slate-800 text-slate-400"}`}>
          Portrait
        </button>
        <button type="button" disabled={!calibrated} onClick={() => onChange({ ...spec, orientation: "landscape" })} className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-bold ${spec.orientation === "landscape" ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40" : "border border-slate-800 text-slate-400"}`}>
          Landscape
        </button>
      </div>
      <button type="button" disabled={!calibrated} onClick={onAutoFill} className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold text-cyan-200 disabled:opacity-40">
        Auto-fill panels (after calibration)
      </button>
      {calibrated && (
        <p className="text-[10px] text-slate-400">
          Placed: {panelCount} modules · {systemKw} kW DC
        </p>
      )}
    </div>
  );
}

export function StructureEditor({
  structure,
  calibrated,
  onChange,
}: {
  structure: StructureLayout;
  calibrated: boolean;
  onChange: (s: StructureLayout) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Elevated structure</h3>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <label className="text-slate-500">
          Structure height (m)
          <input type="number" step={0.1} disabled={!calibrated} value={structure.structureHeightM} onChange={(e) => onChange({ ...structure, structureHeightM: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        <label className="text-slate-500">
          Air passage (m)
          <input type="number" step={0.05} disabled={!calibrated} value={structure.airPassageM} onChange={(e) => onChange({ ...structure, airPassageM: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        <label className="text-slate-500 col-span-2">
          Cleaning space (m)
          <input type="number" step={0.05} disabled={!calibrated} value={structure.cleaningSpaceM} onChange={(e) => onChange({ ...structure, cleaningSpaceM: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
        </label>
      </div>
      <p className="text-[9px] text-slate-500">Use structure tools on canvas: H-Beam, C-Channel, Column, Foundation.</p>
    </div>
  );
}

export function BoqEditor({
  lines,
  calibrated,
  onUpdate,
}: {
  lines: EditableBoqLine[];
  calibrated: boolean;
  onUpdate: (result: BoqUpdateResult) => void;
}) {
  if (!calibrated) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">BOQ draft</h3>
        <p className="mt-2 text-[10px] text-slate-500">Hidden until scale is calibrated.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">BOQ draft</h3>
        <span className="text-[10px] text-emerald-400 font-bold">Rs. {boqGrandTotal(lines).toLocaleString()}</span>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto">
        {lines.map((line) => (
          <li key={line.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-[10px] space-y-1">
            {line.overridden && (
              <p className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="h-3 w-3" /> Manual override
              </p>
            )}
            <input value={line.item} onChange={(e) => onUpdate(updateBoqLine(lines, line.id, { item: e.target.value }))} className="w-full bg-transparent font-semibold text-white outline-none" />
            <div className="grid grid-cols-3 gap-1">
              <input type="number" min={0} value={line.qty} onChange={(e) => onUpdate(updateBoqLine(lines, line.id, { qty: Number(e.target.value) }))} className="rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-white" title="Qty" />
              <input type="number" min={0} value={line.rate} onChange={(e) => onUpdate(updateBoqLine(lines, line.id, { rate: Number(e.target.value) }))} className="rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-white" title="Rate" />
              <input type="number" min={0} max={100} value={line.marginPercent} onChange={(e) => onUpdate(updateBoqLine(lines, line.id, { marginPercent: Number(e.target.value) }))} className="rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-white" title="Margin %" />
            </div>
            <input value={line.brand} onChange={(e) => onUpdate(updateBoqLine(lines, line.id, { brand: e.target.value }))} className="w-full rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-slate-300" placeholder="Brand" />
            <p className="text-right text-emerald-400/90">Rs. {lineTotal(line).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportPreview({ pages, calibrated }: { pages: ReportPage[]; calibrated: boolean }) {
  const [idx, setIdx] = React.useState(0);
  const page = pages[idx];
  if (!calibrated) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <FileText className="h-4 w-4 text-violet-400" />
          Layout report preview
        </h3>
        <p className="mt-2 text-[10px] text-slate-500">Calibrate scale to preview Site Dimensions, Panel Layout, Structure, and BOQ pages.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2">
        <FileText className="h-4 w-4 text-violet-400" />
        Layout report preview
      </h3>
      <div className="flex flex-wrap gap-1">
        {pages.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setIdx(i)} className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${i === idx ? "bg-violet-500/20 text-violet-200 border border-violet-500/40" : "text-slate-500 border border-transparent"}`}>
            {p.title}
          </button>
        ))}
      </div>
      {page && (
        <div className="rounded-xl border border-violet-500/20 bg-slate-950 p-3 min-h-[120px]">
          <p className="text-xs font-bold text-white">{page.title}</p>
          {page.sections.map((s) => (
            <div key={s.heading} className="mt-2">
              <p className="text-[9px] font-bold uppercase text-slate-500">{s.heading}</p>
              <ul className="mt-0.5 space-y-0.5">
                {s.lines.map((l) => (
                  <li key={l} className="text-[10px] text-slate-300">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
