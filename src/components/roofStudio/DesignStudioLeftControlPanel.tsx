/**
 * HelioScope-style Left Design Control Panel V1.
 * Draft-only controls for Project Design Workspace. No save / API / AI / PDF.
 * Engines run only via parent (Panel Layout V2 + live results adapter).
 */

import React, { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  ImageIcon,
  Layers,
  MapPin,
  Phone,
  Ruler,
  Sparkles,
  Square,
  Sun,
  Zap,
} from "lucide-react";
import {
  DESIGN_WORKSPACE_DRAFT_ONLY_LABEL,
  LAYOUT_ALIGNMENTS,
  MODULE_OPTIONS,
  canRunDesignStudioAutoLayout,
  resolveCatalogModule,
  validateAzimuthDeg,
  validateDesignStudioLayoutSettings,
  validateEdgeSetbackM,
  validateModuleGapM,
  validateRowSpacingM,
  validateTiltDeg,
  type DesignStudioControls,
  type DesignStudioLiveResults,
  type LayoutAlignment,
} from "../../lib/sunchaserDesignStudioClient";
import {
  MAP_PROVIDER_NOT_CONNECTED,
  SATELLITE_PROVIDER_NOT_CONNECTED,
  getMapProviderStatusLabel,
  hasValidManualCoordinates,
  isSatelliteProviderConfigured,
  locateProperty,
  type LocatePropertyResult,
} from "../../lib/designStudioMapProviders";
import "../../lib/googleMapsProvider";
import { isPlaneComplete, type RoofStudioState, type StudioPlane } from "../../lib/roofStudioClient";
import { formatMeters } from "../../lib/roofStudioCalibration";
import type { PanelOrientationPolicy } from "../../../server/solar/panel/PanelLayoutModels.ts";

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

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-300">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      ) : (
        <Circle className="h-3.5 w-3.5 text-slate-600 shrink-0" />
      )}
      <span>{label}</span>
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-1 text-[9px] font-bold transition ${
        active
          ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
          : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );
}

export interface DesignStudioLeftControlPanelProps {
  customerName: string;
  address: string;
  onAddressChange: (value: string) => void;
  latText: string;
  lngText: string;
  onLatChange: (value: string) => void;
  onLngChange: (value: string) => void;
  onGpsCommit: () => void;
  gpsError: string | null;
  locateMessage: string | null;
  onLocateResult: (result: LocatePropertyResult) => void;
  satelliteMessage: string | null;
  onFetchSatelliteImage: () => void;
  phone: string;
  sanctionedLoad: string;
  controls: DesignStudioControls;
  alignment: LayoutAlignment;
  onControlsChange: <K extends keyof DesignStudioControls>(key: K, value: DesignStudioControls[K]) => void;
  onAlignmentChange: (value: LayoutAlignment) => void;
  studioState: RoofStudioState | null;
  hasImage: boolean;
  calibrated: boolean;
  imageFileName?: string | null;
  live: DesignStudioLiveResults;
  autoLayoutMessage: string | null;
  settingsError: string | null;
  onUploadImage: () => void;
  onCalibrate: () => void;
  onResetCalibration: () => void;
  onDrawRoof: () => void;
  onEditRoof: () => void;
  onSelectRoof: (planeId: string) => void;
  onAddKeepout: (tool: "obstacle-rect" | "obstacle-polygon" | "obstacle-circle") => void;
  onAutoLayout: () => void;
}

function keepoutsForPlane(plane: StudioPlane | null) {
  if (!plane) return [] as Array<{ id: string; label: string }>;
  return plane.obstacles.map((o) => ({
    id: o.id,
    label: `${o.shape === "circle" ? "Circle" : o.shape === "rect" ? "Rect" : "Polygon"} · ${o.name || o.id.slice(0, 8)}`,
  }));
}

export default function DesignStudioLeftControlPanel({
  customerName,
  address,
  onAddressChange,
  latText,
  lngText,
  onLatChange,
  onLngChange,
  onGpsCommit,
  gpsError,
  locateMessage,
  onLocateResult,
  satelliteMessage,
  onFetchSatelliteImage,
  phone,
  sanctionedLoad,
  controls,
  alignment,
  onControlsChange,
  onAlignmentChange,
  studioState,
  hasImage,
  calibrated,
  imageFileName,
  live,
  autoLayoutMessage,
  settingsError,
  onUploadImage,
  onCalibrate,
  onResetCalibration,
  onDrawRoof,
  onEditRoof,
  onSelectRoof,
  onAddKeepout,
  onAutoLayout,
}: DesignStudioLeftControlPanelProps) {
  const planes = useMemo(
    () => (studioState?.planes ?? []).filter(isPlaneComplete),
    [studioState]
  );
  const selectedPlane =
    planes.find((p) => p.id === studioState?.selectedPlaneId) ?? planes[0] ?? null;
  const keepouts = keepoutsForPlane(selectedPlane);

  const moduleResolved = resolveCatalogModule(controls.moduleId);
  const moduleOk = moduleResolved.ok;
  const module = moduleOk ? moduleResolved.module : null;

  const layoutGate = canRunDesignStudioAutoLayout({
    hasImage,
    calibrated,
    state: studioState,
    controls: { ...controls, alignment },
  });
  const settingsCheck = validateDesignStudioLayoutSettings({ ...controls, alignment });
  const autoLayoutDisabled = !layoutGate.ok;

  const scaleLabel =
    calibrated && studioState && Number.isFinite(studioState.metersPerUnit) && studioState.metersPerUnit > 0
      ? `1 u = ${formatMeters(studioState.metersPerUnit, 4)}`
      : "Not calibrated";

  const orientationValue: PanelOrientationPolicy =
    controls.orientationPolicy === "mixed" ? "auto" : controls.orientationPolicy;

  const satelliteConfigured = isSatelliteProviderConfigured();
  const coordsValid = hasValidManualCoordinates(latText, lngText);
  const fetchSatelliteDisabled = !coordsValid;
  const providerStatusLabel = getMapProviderStatusLabel();

  return (
    <aside
      className="space-y-2 max-h-[780px] overflow-y-auto pr-1"
      data-testid="design-studio-left-control-panel"
    >
      <Section title="Project" icon={MapPin}>
        <p className="text-[10px] text-slate-400 truncate">{customerName || "Customer"}</p>
        <p className="mt-1 text-[10px] font-mono text-slate-300 truncate" data-testid="project-workspace-customer-phone">
          <Phone className="h-3 w-3 inline mr-1 text-slate-500" />
          {phone}
        </p>
        <p className="mt-1 text-[9px] text-slate-500 flex items-center gap-1">
          <Zap className="h-3 w-3" /> Sanctioned load: {sanctionedLoad}
        </p>
      </Section>

      <Section title="Property Location" icon={MapPin}>
        <label className="block text-[10px] text-slate-500" data-testid="property-location-address">
          Address
          <input
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Street, area, city"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
            data-testid="property-location-address-input"
          />
        </label>
        <p className="mt-1 text-[9px] text-amber-300/90" data-testid="design-workspace-draft-only">
          {DESIGN_WORKSPACE_DRAFT_ONLY_LABEL}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-[9px] text-slate-500">
            Latitude
            <input
              value={latText}
              onChange={(e) => onLatChange(e.target.value)}
              onBlur={onGpsCommit}
              placeholder="-90 to 90"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs font-mono text-white"
              data-testid="property-location-lat"
            />
          </label>
          <label className="block text-[9px] text-slate-500">
            Longitude
            <input
              value={lngText}
              onChange={(e) => onLngChange(e.target.value)}
              onBlur={onGpsCommit}
              placeholder="-180 to 180"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs font-mono text-white"
              data-testid="property-location-lng"
            />
          </label>
        </div>
        {gpsError && (
          <p className="mt-1 text-[10px] text-rose-400" data-testid="property-location-gps-error">
            {gpsError}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            void locateProperty(address).then((result) => {
              onLocateResult(result);
            });
          }}
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-800"
          data-testid="property-location-locate"
        >
          Locate Property
        </button>
        {locateMessage && (
          <p className="mt-1 text-[10px] text-amber-300/90" data-testid="property-location-locate-message">
            {locateMessage}
          </p>
        )}
        <p
          className="mt-1 text-[9px] text-slate-500"
          data-testid="property-location-provider-status"
        >
          Provider: {providerStatusLabel}
        </p>
        <p className="mt-1 text-[9px] text-slate-500">
          Manual lat/lng allowed. Map geocoding requires a connected provider.
        </p>
        <p className="sr-only" data-testid="map-provider-not-connected-copy">
          {MAP_PROVIDER_NOT_CONNECTED}
        </p>
      </Section>

      <Section title="Satellite Image" icon={ImageIcon}>
        <button
          type="button"
          disabled={fetchSatelliteDisabled}
          onClick={onFetchSatelliteImage}
          title={
            fetchSatelliteDisabled
              ? "Enter valid latitude and longitude first"
              : satelliteConfigured
                ? "Fetch satellite image from configured provider"
                : SATELLITE_PROVIDER_NOT_CONNECTED
          }
          className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-bold text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="satellite-fetch-button"
        >
          Fetch Satellite Image
        </button>
        <p className="mt-1 text-[9px] text-slate-500" data-testid="satellite-provider-status">
          {satelliteConfigured ? providerStatusLabel : SATELLITE_PROVIDER_NOT_CONNECTED}
        </p>
        {!satelliteConfigured && (
          <p className="mt-1 text-[10px] text-amber-300/90" data-testid="satellite-provider-not-connected">
            {SATELLITE_PROVIDER_NOT_CONNECTED}
          </p>
        )}
        {satelliteMessage && (
          <p className="mt-1 text-[10px] text-amber-300/90" data-testid="satellite-fetch-message">
            {satelliteMessage}
          </p>
        )}
        <p className="mt-1 text-[9px] text-slate-500">
          Uploaded image remains the primary fallback. Satellite imagery still requires calibration.
        </p>
      </Section>

      <Section title="Site Image" icon={ImageIcon}>
        <button
          type="button"
          onClick={onUploadImage}
          className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold text-cyan-200"
        >
          {hasImage ? "Replace image" : "Upload image"}
        </button>
        {imageFileName && (
          <p className="mt-1 text-[9px] text-slate-500 truncate">File: {imageFileName}</p>
        )}
        <div className="mt-2 space-y-1">
          <StatusLine ok={calibrated} label={calibrated ? "Scale calibrated" : "Scale not calibrated"} />
          <p className="text-[10px] font-mono text-slate-300">Scale: {scaleLabel}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <ToolBtn label="Calibrate" onClick={onCalibrate} />
          <ToolBtn label="Reset calibration" onClick={onResetCalibration} />
        </div>
      </Section>

      <Section title="Roof Areas" icon={Layers}>
        <div className="flex flex-wrap gap-1">
          <ToolBtn label="Draw roof area" onClick={onDrawRoof} />
          <ToolBtn label="Edit roof area" onClick={onEditRoof} />
        </div>
        {planes.length === 0 ? (
          <p className="mt-2 text-[10px] text-slate-500">No closed roof areas yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {planes.map((p) => {
              const selected = selectedPlane?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRoof(p.id)}
                    className={`w-full rounded-lg border px-2 py-1 text-left text-[10px] ${
                      selected
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                        : "border-slate-800 bg-slate-950 text-slate-300"
                    }`}
                  >
                    {p.name || p.id.slice(0, 8)} · {p.boundary.length} pts
                    {selected ? " · selected" : ""}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[9px] text-slate-500">
          Selected: {selectedPlane ? selectedPlane.name || selectedPlane.id.slice(0, 8) : "none"}
        </p>
      </Section>

      <Section title="Keepouts" icon={Square}>
        <div className="flex flex-wrap gap-1">
          <ToolBtn label="Rectangle" onClick={() => onAddKeepout("obstacle-rect")} />
          <ToolBtn label="Polygon" onClick={() => onAddKeepout("obstacle-polygon")} />
          <ToolBtn label="Circular" onClick={() => onAddKeepout("obstacle-circle")} />
        </div>
        {keepouts.length === 0 ? (
          <p className="mt-2 text-[10px] text-slate-500">No keepouts on selected roof.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {keepouts.map((k) => (
              <li key={k.id} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-300">
                {k.label}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Module" icon={Sun}>
        <label className="block text-[9px] text-slate-500">
          Panel model
          <select
            value={controls.moduleId}
            onChange={(e) => onControlsChange("moduleId", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
          >
            {MODULE_OPTIONS.map((m) => (
              <option key={m.moduleId} value={m.moduleId}>
                {m.name} ({m.wattage}W)
              </option>
            ))}
          </select>
        </label>
        {!moduleOk && (
          <p className="mt-1 text-[10px] text-rose-400">INVALID_MODULE_ID — select a catalog module.</p>
        )}
        {module && (
          <div className="mt-2 space-y-0.5 text-[10px] text-slate-300">
            <p>Wattage: {module.wattage} W</p>
            <p>
              Dimensions: {module.widthM} × {module.heightM} m
            </p>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {(
            [
              ["portrait_only", "Portrait"],
              ["landscape_only", "Landscape"],
              ["auto", "Auto"],
            ] as const
          ).map(([id, label]) => (
            <ToolBtn
              key={id}
              label={label}
              active={orientationValue === id}
              onClick={() => onControlsChange("orientationPolicy", id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Layout Settings" icon={Ruler}>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] text-slate-500">
            Edge setback (m)
            <input
              type="number"
              step={0.05}
              min={0}
              max={5}
              value={Number.isFinite(controls.edgeSetbackM) ? controls.edgeSetbackM : ""}
              onChange={(e) => {
                const n = e.target.value === "" ? Number.NaN : Number(e.target.value);
                onControlsChange("edgeSetbackM", n);
              }}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Row spacing (m)
            <input
              type="number"
              step={0.01}
              min={0}
              max={5}
              value={Number.isFinite(controls.rowSpacingM) ? controls.rowSpacingM : ""}
              onChange={(e) => {
                const n = e.target.value === "" ? Number.NaN : Number(e.target.value);
                onControlsChange("rowSpacingM", n);
              }}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Module gap (m)
            <input
              type="number"
              step={0.01}
              min={0}
              max={2}
              value={Number.isFinite(controls.moduleGapM) ? controls.moduleGapM : ""}
              onChange={(e) => {
                const n = e.target.value === "" ? Number.NaN : Number(e.target.value);
                onControlsChange("moduleGapM", n);
              }}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Tilt °
            <input
              type="number"
              step={1}
              min={0}
              max={60}
              value={Number.isFinite(controls.tiltDeg) ? controls.tiltDeg : ""}
              onChange={(e) => {
                const n = e.target.value === "" ? Number.NaN : Number(e.target.value);
                onControlsChange("tiltDeg", n);
              }}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Azimuth °
            <input
              type="number"
              step={1}
              min={0}
              max={360}
              value={Number.isFinite(controls.azimuthDeg) ? controls.azimuthDeg : ""}
              onChange={(e) => {
                const n = e.target.value === "" ? Number.NaN : Number(e.target.value);
                onControlsChange("azimuthDeg", n);
              }}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Alignment
            <select
              value={alignment}
              onChange={(e) => onAlignmentChange(e.target.value as LayoutAlignment)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
            >
              {LAYOUT_ALIGNMENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(settingsError || !settingsCheck.ok) && (
          <p className="mt-2 text-[10px] text-rose-400">
            {settingsError ?? (!settingsCheck.ok ? settingsCheck.message : null)}
          </p>
        )}
        <div className="mt-1 space-y-0.5 text-[9px] text-slate-500">
          {!validateEdgeSetbackM(controls.edgeSetbackM).ok && <p>Edge setback invalid</p>}
          {!validateRowSpacingM(controls.rowSpacingM).ok && <p>Row spacing invalid</p>}
          {!validateModuleGapM(controls.moduleGapM).ok && <p>Module gap invalid</p>}
          {!validateTiltDeg(controls.tiltDeg).ok && <p>Tilt invalid</p>}
          {!validateAzimuthDeg(controls.azimuthDeg).ok && <p>Azimuth invalid</p>}
        </div>
      </Section>

      <Section title="Auto Layout" icon={Sparkles}>
        <button
          type="button"
          disabled={autoLayoutDisabled}
          onClick={onAutoLayout}
          title={layoutGate.reason ?? "Run Panel Layout Engine V2"}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="left-panel-auto-layout"
        >
          <Sparkles className="h-4 w-4" />
          Auto Layout
        </button>
        {autoLayoutDisabled && (
          <p className="mt-1 text-[10px] text-amber-300/90">
            {layoutGate.reason ?? "Complete previous step first."}
          </p>
        )}
        {autoLayoutMessage && (
          <p className="mt-1 text-[10px] text-amber-200/90 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
            {autoLayoutMessage}
          </p>
        )}
        <p className="mt-1 text-[9px] text-slate-500">
          Requires image + calibrated scale + valid roof + valid module/settings. No fake panels.
        </p>
      </Section>

      <Section title="Output Status" icon={CheckCircle2}>
        <StatusLine ok={live.status.panelLayoutReady} label="Layout ready" />
        <StatusLine ok={live.status.electricalReady} label="Electrical ready" />
        <StatusLine ok={live.status.simulationReady} label="Simulation ready" />
        <StatusLine ok={live.status.boqReady} label="BOQ ready" />
        <StatusLine ok={live.proposal.readyForPreview} label={live.proposal.readyForPreview ? "Proposal ready" : "Proposal not ready"} />
      </Section>
    </aside>
  );
}
