/**
 * Sunchaser Design Studio V1 — HelioScope-style solar design workflow.
 * Left controls · Center canvas · Right live engine results.
 * Draft only. No CRM mutation / save. Feature-flagged.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, DraftingCompass, MapPin, Phone, Sun, Zap } from "lucide-react";
import type { Lead } from "../../types";
import {
  DEFAULT_DESIGN_CONTROLS,
  DESIGN_STUDIO_GUIDED_STEPS,
  buildDesignStudioLiveResults,
  canRunDesignStudioAutoLayout,
  designStudioWizardProgress,
  displayCustomerPhone,
  prefillAddressFromLead,
  primaryPlane,
  runDesignStudioAutoLayout,
  validateDesignStudioLayoutSettings,
  type DesignStudioControls,
  type DesignStudioLiveResults,
  type LayoutAlignment,
} from "../../lib/sunchaserDesignStudioClient";
import {
  UPLOAD_OR_CONNECT_MAP_LABEL,
  applyLocatePropertyResultToDraft,
  fetchSatelliteImage,
  resolveSatelliteDisplayUrl,
  type LocatePropertyResult,
} from "../../lib/designStudioMapProviders";
import type { RoofStudioState } from "../../lib/roofStudioClient";
import { createInitialRoofStudioState } from "../../lib/roofStudioClient";
import RoofIntelligenceStudio, {
  type ProjectDesignContext,
  type RoofStudioApi,
} from "./RoofIntelligenceStudio";
import DesignStudioResultsPanel from "./DesignStudioResultsPanel";
import DesignStudioLeftControlPanel from "./DesignStudioLeftControlPanel";
import {
  DEFAULT_SITE_GEO,
  parseOptionalGpsAnchor,
  type SiteGeoReference,
} from "../../lib/roofStudioGeoReference";
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

export default function SunchaserDesignStudio({
  lead,
  sanctionedLoad,
}: SunchaserDesignStudioProps) {
  const [address, setAddress] = useState(() => initialAddress(lead));
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [satelliteMessage, setSatelliteMessage] = useState<string | null>(null);
  const [geoSeed, setGeoSeed] = useState<SiteGeoReference>(() => ({
    ...DEFAULT_SITE_GEO,
    siteLabel: lead.name || "",
  }));
  const [controls, setControls] = useState<DesignStudioControls>(() => ({
    ...DEFAULT_DESIGN_CONTROLS,
  }));
  const [alignment, setAlignment] = useState<LayoutAlignment>("center");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [layoutResult, setLayoutResult] = useState<DesignStudioLiveResults["layout"]>(null);
  const [autoLayoutMessage, setAutoLayoutMessage] = useState<string | null>(null);
  const [studioSnap, setStudioSnap] = useState<{
    state: RoofStudioState | null;
    hasImage: boolean;
    calibrated: boolean;
  }>({ state: null, hasImage: false, calibrated: false });

  const studioApiRef = useRef<RoofStudioApi | null>(null);
  const customerPhone = displayCustomerPhone(lead.phone);
  const sanctionedDisplay = resolveSanctionedLoad(lead, sanctionedLoad);

  const commitGps = useCallback(
    (nextLat: string, nextLng: string) => {
      const parsed = parseOptionalGpsAnchor(nextLat, nextLng);
      if (!parsed.ok) {
        setGpsError(parsed.error);
        return;
      }
      setGpsError(null);
      setGeoSeed((prev) => ({
        ...prev,
        siteLabel: address.trim() || lead.name || prev.siteLabel,
        latitude: parsed.anchor?.latitude ?? null,
        longitude: parsed.anchor?.longitude ?? null,
      }));
    },
    [address, lead.name]
  );

  useEffect(() => {
    setGeoSeed((prev) => ({
      ...prev,
      siteLabel: address.trim() || lead.name || prev.siteLabel,
    }));
  }, [address, lead.name]);

  const project: ProjectDesignContext = useMemo(
    () => ({
      leadId: lead.id,
      customerName: lead.name || "Customer",
      phone: lead.phone || "",
      address,
      sanctionedLoad: sanctionedDisplay,
      geoSeed,
    }),
    [lead, address, sanctionedDisplay, geoSeed]
  );

  const hasCompletePlane = Boolean(studioSnap.state && primaryPlane(studioSnap.state));
  const hasKeepouts = Boolean(
    studioSnap.state?.planes.some((p) => p.obstacles.length > 0 || p.walkways.length > 0)
  );
  const hasPanels = Boolean(layoutResult && layoutResult.panelCount > 0);
  const live = useMemo(() => {
    if (!studioSnap.state) {
      return buildDesignStudioLiveResults(createInitialRoofStudioState(`lead-${lead.id}`), controls, null, {
        hasImage: false,
      });
    }
    return buildDesignStudioLiveResults(studioSnap.state, controls, layoutResult, {
      hasImage: studioSnap.hasImage,
    });
  }, [studioSnap, controls, layoutResult, lead.id]);

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
    setControls((c) => {
      const next = { ...c, [key]: value };
      const check = validateDesignStudioLayoutSettings({ ...next, alignment });
      setSettingsError(check.ok ? null : check.message);
      return next;
    });
    setLayoutResult(null);
    setAutoLayoutMessage(null);
  };

  const handleAlignmentChange = (value: LayoutAlignment) => {
    setAlignment(value);
    const check = validateDesignStudioLayoutSettings({ ...controls, alignment: value });
    setSettingsError(check.ok ? null : check.message);
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
    const gate = canRunDesignStudioAutoLayout({
      hasImage: api.hasImage(),
      calibrated: api.isCalibrated(),
      state,
      controls: { ...controls, alignment },
    });
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
    setSettingsError(null);
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

  const handleLocateResult = useCallback(
    (result: LocatePropertyResult) => {
      if (!result.ok) {
        setLocateMessage(result.message);
        return;
      }
      const next = applyLocatePropertyResultToDraft({ latText, lngText }, result);
      setLatText(next.latText);
      setLngText(next.lngText);
      setLocateMessage(null);
      commitGps(next.latText, next.lngText);
    },
    [latText, lngText, commitGps]
  );

  const handleFetchSatelliteImage = useCallback(() => {
    const parsed = parseOptionalGpsAnchor(latText, lngText);
    if (!parsed.ok || !parsed.anchor) {
      setSatelliteMessage(parsed.ok ? "Enter valid latitude and longitude first." : parsed.error);
      return;
    }
    void fetchSatelliteImage({
      latitude: parsed.anchor.latitude,
      longitude: parsed.anchor.longitude,
    }).then(async (result) => {
      if (!result.ok) {
        setSatelliteMessage(result.message);
        return;
      }
      const url = resolveSatelliteDisplayUrl(result.image);
      if (!url) {
        setSatelliteMessage("Provider returned an invalid satellite image.");
        return;
      }
      const api = studioApiRef.current;
      if (!api?.setBackgroundImageFromUrl) {
        setSatelliteMessage("Canvas not ready.");
        return;
      }
      const applied = await api.setBackgroundImageFromUrl(
        url,
        result.image.provider ? `satellite-${result.image.provider}` : "satellite-image"
      );
      if (!applied.ok) {
        setSatelliteMessage(applied.error);
        return;
      }
      setSatelliteMessage(null);
      setLayoutResult(null);
      setAutoLayoutMessage("Satellite image loaded — calibrate scale before Auto Layout.");
    });
  }, [latText, lngText]);

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
              Left controls → canvas → live results. Existing engines only. No AI guessing.
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
            <p className="mt-0.5 text-sm font-mono text-amber-200">{sanctionedDisplay}</p>
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
        <div className="xl:col-span-3">
          <DesignStudioLeftControlPanel
            customerName={lead.name || "Customer"}
            address={address}
            onAddressChange={setAddress}
            latText={latText}
            lngText={lngText}
            onLatChange={setLatText}
            onLngChange={setLngText}
            onGpsCommit={() => commitGps(latText, lngText)}
            gpsError={gpsError}
            locateMessage={locateMessage}
            onLocateResult={handleLocateResult}
            satelliteMessage={satelliteMessage}
            onFetchSatelliteImage={handleFetchSatelliteImage}
            phone={customerPhone}
            sanctionedLoad={sanctionedDisplay}
            controls={controls}
            alignment={alignment}
            onControlsChange={patchControls}
            onAlignmentChange={handleAlignmentChange}
            studioState={studioSnap.state}
            hasImage={studioSnap.hasImage}
            calibrated={studioSnap.calibrated}
            live={live}
            autoLayoutMessage={autoLayoutMessage}
            settingsError={settingsError}
            onUploadImage={() => studioApiRef.current?.openImagePicker()}
            onCalibrate={() => studioApiRef.current?.setTool("calibrate-scale")}
            onResetCalibration={() => {
              studioApiRef.current?.resetCalibration();
              setLayoutResult(null);
              setAutoLayoutMessage("Calibration reset.");
            }}
            onDrawRoof={() => studioApiRef.current?.setTool("plane")}
            onEditRoof={() => studioApiRef.current?.setTool("select")}
            onSelectRoof={(planeId) => studioApiRef.current?.selectPlane(planeId)}
            onAddKeepout={(tool) => studioApiRef.current?.setTool(tool)}
            onAutoLayout={handleAutoLayout}
          />
        </div>

        <div className="xl:col-span-5 space-y-2">
          {showGuidedEmpty && (
            <div
              className="rounded-2xl border border-dashed border-amber-500/40 bg-slate-950/80 px-4 py-6 text-center"
              data-testid="property-location-map-placeholder"
            >
              <Sun className="mx-auto h-8 w-8 text-amber-400/80" />
              <h3 className="mt-2 text-sm font-bold text-white">{UPLOAD_OR_CONNECT_MAP_LABEL}</h3>
              <p className="mt-1 text-[11px] text-slate-400 max-w-md mx-auto">
                Blank CAD is disabled. No satellite provider connected. Upload a roof image, calibrate scale with a known
                distance, then draw the roof.
              </p>
              <button
                type="button"
                onClick={() => studioApiRef.current?.openImagePicker()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
                data-testid="use-uploaded-image"
              >
                Use Uploaded Image
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

        <aside className="xl:col-span-4 space-y-2 max-h-[780px] overflow-y-auto">
          <DesignStudioResultsPanel live={live} />
        </aside>
      </div>
    </div>
  );
}
