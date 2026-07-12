/**
 * HelioScope-style Left Design Control Panel V1.
 * Draft-only controls for Project Design Workspace. No save / API / AI / PDF.
 * Engines run only via parent (Panel Layout V2 + live results adapter).
 */

import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ImageIcon,
  Layers,
  Loader2,
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
  isGeocodingProviderConfigured,
  isSatelliteProviderConfigured,
  locateProperty,
  type LocatePropertyResult,
} from "../../lib/designStudioMapProviders";
import "../../lib/googleMapsProvider";
import { isPlaneComplete, type RoofStudioState, type StudioPlane } from "../../lib/roofStudioClient";
import { formatMeters } from "../../lib/roofStudioCalibration";
import type { PanelOrientationPolicy } from "../../../server/solar/panel/PanelLayoutModels.ts";
import PropertyAddressAutocomplete from "./PropertyAddressAutocomplete";
import {
  StudioButton,
  StudioPanel,
  StudioStatusLine,
} from "../ui/studio";

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
    <StudioButton
      variant={active ? "tool-active" : "tool"}
      onClick={onClick}
      className="!px-2.5 !py-1.5 !text-xs"
    >
      {label}
    </StudioButton>
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

  let satelliteConfigured = false;
  let geocodingConfigured = false;
  let providerStatusLabel = MAP_PROVIDER_NOT_CONNECTED;
  let providerStatusError: string | null = null;
  try {
    satelliteConfigured = isSatelliteProviderConfigured();
    geocodingConfigured = isGeocodingProviderConfigured();
    providerStatusLabel = getMapProviderStatusLabel();
  } catch (err) {
    providerStatusError =
      err instanceof Error ? err.message : "Map provider status unavailable.";
    satelliteConfigured = false;
    geocodingConfigured = false;
    providerStatusLabel = MAP_PROVIDER_NOT_CONNECTED;
  }
  const coordsValid = hasValidManualCoordinates(latText, lngText);
  const fetchSatelliteDisabled = !coordsValid;
  const [locateLoading, setLocateLoading] = useState(false);
  const locateDisabled = locateLoading || !String(address ?? "").trim();

  return (
    <aside
      className="space-y-3 max-h-[780px] overflow-y-auto pr-1 scrollbar-thin"
      data-testid="design-studio-left-control-panel"
    >
      <StudioPanel title="Project" icon={MapPin}>
        <p className="text-sm font-medium text-slate-200 truncate">{customerName || "Customer"}</p>
        <p className="text-sm font-mono text-slate-300 truncate" data-testid="project-workspace-customer-phone">
          <Phone className="h-3.5 w-3.5 inline mr-1.5 text-slate-500" />
          {phone}
        </p>
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5" /> Sanctioned load: {sanctionedLoad}
        </p>
      </StudioPanel>

      <StudioPanel title="Property Location" icon={MapPin}>
        <label className="studio-label" data-testid="property-location-address">
          Address
          <PropertyAddressAutocomplete
            value={address}
            onChange={onAddressChange}
            onPlaceResolved={onLocateResult}
          />
        </label>
        <p className="text-xs text-amber-300/90" data-testid="design-workspace-draft-only">
          {DESIGN_WORKSPACE_DRAFT_ONLY_LABEL}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="studio-label">
            Latitude
            <input
              value={latText}
              onChange={(e) => onLatChange(e.target.value)}
              onBlur={onGpsCommit}
              placeholder="-90 to 90"
              className="studio-input font-mono text-xs"
              data-testid="property-location-lat"
            />
          </label>
          <label className="studio-label">
            Longitude
            <input
              value={lngText}
              onChange={(e) => onLngChange(e.target.value)}
              onBlur={onGpsCommit}
              placeholder="-180 to 180"
              className="studio-input font-mono text-xs"
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
          disabled={locateDisabled}
          title={
            !String(address ?? "").trim()
              ? "Enter an address first"
              : !geocodingConfigured
                ? MAP_PROVIDER_NOT_CONNECTED
                : "Geocode address to latitude/longitude"
          }
          onClick={() => {
            setLocateLoading(true);
            void locateProperty(address).then((result) => {
              setLocateLoading(false);
              onLocateResult(result);
            });
          }}
          className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="property-location-locate"
        >
          {locateLoading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Locating…
            </>
          ) : (
            "Locate Property"
          )}
        </button>
        {locateMessage && (
          <p
            className={`mt-1 text-[10px] ${
              locateMessage.includes("connected") || locateMessage.includes("Enter")
                ? "text-amber-300/90"
                : locateMessage.includes("Located") || locateMessage.includes("via")
                  ? "text-emerald-300/90"
                  : "text-rose-400"
            }`}
            data-testid="property-location-locate-message"
            role={locateMessage.includes("No result") || locateMessage.includes("error") ? "alert" : undefined}
          >
            {locateMessage}
          </p>
        )}
        <p
          className="mt-1 text-[9px] text-slate-500"
          data-testid="property-location-provider-status"
        >
          Provider: {providerStatusLabel}
        </p>
        {providerStatusError && (
          <p
            className="mt-1 text-[10px] text-rose-400"
            data-testid="property-location-provider-error"
            role="alert"
          >
            Map provider error: {providerStatusError}
          </p>
        )}
        <p className="mt-1 text-[9px] text-slate-500">
          Manual lat/lng allowed. Map geocoding requires a connected provider.
        </p>
        <p className="sr-only" data-testid="map-provider-not-connected-copy">
          {MAP_PROVIDER_NOT_CONNECTED}
        </p>
      </StudioPanel>

      <StudioPanel title="Site Image" icon={ImageIcon}>
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
        <div className="mt-2 space-y-1">
          <StudioStatusLine ok={calibrated} label={calibrated ? "Scale calibrated" : "Scale not calibrated"} />
          <p className="text-[10px] font-mono text-slate-300">Scale: {scaleLabel}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <ToolBtn label="Calibrate" onClick={onCalibrate} />
          <ToolBtn label="Reset calibration" onClick={onResetCalibration} />
        </div>
      </StudioPanel>

      <StudioPanel title="Roof Areas" icon={Layers}>
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
      </StudioPanel>

      <StudioPanel title="Keepouts" icon={Square}>
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
      </StudioPanel>

      <StudioPanel title="Module" icon={Sun}>
        <label className="block text-[9px] text-slate-500">
          Panel model
          <select
            value={controls.moduleId}
            onChange={(e) => onControlsChange("moduleId", e.target.value)}
            className="studio-input text-xs"
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
      </StudioPanel>

      <StudioPanel title="Layout Settings" icon={Ruler}>
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
              className="studio-input text-xs"
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
              className="studio-input text-xs"
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
              className="studio-input text-xs"
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
              className="studio-input text-xs"
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
              className="studio-input text-xs"
            />
          </label>
          <label className="text-[9px] text-slate-500">
            Alignment
            <select
              value={alignment}
              onChange={(e) => onAlignmentChange(e.target.value as LayoutAlignment)}
              className="studio-input text-xs"
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
      </StudioPanel>

      <StudioPanel title="Auto Layout" icon={Sparkles}>
        <StudioButton
          variant="primary"
          icon={Sparkles}
          disabled={autoLayoutDisabled}
          onClick={onAutoLayout}
          title={layoutGate.reason ?? "Run Panel Layout Engine V2"}
          className="w-full"
          data-testid="left-panel-auto-layout"
        >
          Auto Layout
        </StudioButton>
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
      </StudioPanel>

      <StudioPanel title="Output Status" icon={CheckCircle2}>
        <StudioStatusLine ok={live.status.panelLayoutReady} label="Layout ready" />
        <StudioStatusLine ok={live.status.electricalReady} label="Electrical ready" />
        <StudioStatusLine ok={live.status.simulationReady} label="Simulation ready" />
        <StudioStatusLine ok={live.status.boqReady} label="BOQ ready" />
        <StudioStatusLine ok={live.proposal.readyForPreview} label={live.proposal.readyForPreview ? "Proposal ready" : "Proposal not ready"} />
      </StudioPanel>
    </aside>
  );
}
