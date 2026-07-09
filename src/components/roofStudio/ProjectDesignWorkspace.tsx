/**
 * Project Design Workspace V1 — CRM-connected HelioScope-style workflow.
 * Left controls · Center canvas · Right live engine results.
 * Draft only. No CRM mutation / save / network / AI / PDF export.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sun } from "lucide-react";
import type { Lead } from "../../types";
import { formatLeadLocation, sanitizeLeadLocationInput } from "../../lib/leadDisplay";
import {
  parseOptionalGpsAnchor,
  type SiteGeoReference,
  DEFAULT_SITE_GEO,
} from "../../lib/roofStudioGeoReference";
import {
  DEFAULT_DESIGN_CONTROLS,
  buildDesignStudioLiveResults,
  canRunDesignStudioAutoLayout,
  displayCustomerPhone,
  runDesignStudioAutoLayout,
  validateDesignStudioLayoutSettings,
  type DesignStudioControls,
  type DesignStudioLiveResults,
  type LayoutAlignment,
} from "../../lib/sunchaserDesignStudioClient";
import {
  UPLOAD_OR_CONNECT_MAP_LABEL,
  applyLocatePropertyResultToDraft,
  type LocatePropertyResult,
} from "../../lib/designStudioMapProviders";
import { createInitialRoofStudioState, type RoofStudioState } from "../../lib/roofStudioClient";
import RoofIntelligenceStudio, {
  type ProjectDesignContext,
  type RoofStudioApi,
} from "./RoofIntelligenceStudio";
import DesignStudioResultsPanel from "./DesignStudioResultsPanel";
import DesignStudioLeftControlPanel from "./DesignStudioLeftControlPanel";

export interface ProjectDesignWorkspaceProps {
  lead: Lead;
  sanctionedLoad?: string | number | null;
}

function resolveSanctionedLoad(
  lead: Lead,
  override?: string | number | null
): string {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return String(override).trim();
  }
  if (lead.sanctionedLoad != null && Number.isFinite(Number(lead.sanctionedLoad))) {
    return `${lead.sanctionedLoad} kW`;
  }
  const quotes = lead.quotes || [];
  for (let i = quotes.length - 1; i >= 0; i--) {
    const q = quotes[i] as { lescoSettings?: { sanctionedLoad?: string } };
    const fromQuote = q?.lescoSettings?.sanctionedLoad;
    if (fromQuote && String(fromQuote).trim()) return String(fromQuote).trim();
  }
  return "Not set";
}

function initialAddress(lead: Lead): string {
  const fromFormat = formatLeadLocation(lead);
  if (fromFormat !== "Location not specified") return fromFormat;
  return sanitizeLeadLocationInput(lead.address) || sanitizeLeadLocationInput(lead.location) || "";
}

export default function ProjectDesignWorkspace({
  lead,
  sanctionedLoad,
}: ProjectDesignWorkspaceProps) {
  const [address, setAddress] = useState(() => initialAddress(lead));
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
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

  useEffect(() => {
    setAddress(initialAddress(lead));
    setLatText("");
    setLngText("");
    setGpsError(null);
    setLocateMessage(null);
    setGeoSeed({
      ...DEFAULT_SITE_GEO,
      siteLabel: lead.name || "",
    });
    setLayoutResult(null);
    setAutoLayoutMessage(null);
    setSettingsError(null);
    setControls({ ...DEFAULT_DESIGN_CONTROLS });
    setAlignment("center");
  }, [lead.id]);

  const sanctionedDisplay = useMemo(
    () => resolveSanctionedLoad(lead, sanctionedLoad),
    [lead, sanctionedLoad]
  );

  const customerPhone = displayCustomerPhone(lead.phone);

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

  const project: ProjectDesignContext = useMemo(
    () => ({
      leadId: lead.id,
      customerName: lead.name || "Customer",
      phone: lead.phone || "",
      address,
      sanctionedLoad: sanctionedDisplay,
      geoSeed,
    }),
    [lead.id, lead.name, lead.phone, address, sanctionedDisplay, geoSeed]
  );

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
      setSettingsError(gate.code && gate.code !== "GATED" ? gate.reason : null);
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

  return (
    <div className="space-y-4 text-left fade-in-entry">
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/20 p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-amber-600/10 border border-amber-500/30">
            <Sun className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-white tracking-tight">Project Design Workspace</h2>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                V1 · HelioScope controls
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                Draft only
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400 max-w-2xl">
              Left controls → canvas → live results. Existing engines only. No AI guessing. No fake output.
            </p>
          </div>
        </div>
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
          {!studioSnap.hasImage && (
            <div
              className="rounded-2xl border border-dashed border-amber-500/40 bg-slate-950/80 px-4 py-6 text-center"
              data-testid="property-location-map-placeholder"
            >
              <Sun className="mx-auto h-8 w-8 text-amber-400/80" />
              <h3 className="mt-2 text-sm font-bold text-white">{UPLOAD_OR_CONNECT_MAP_LABEL}</h3>
              <p className="mt-1 text-[11px] text-slate-400 max-w-md mx-auto">
                No satellite provider connected. Upload a roof image from the left panel, or enter coordinates manually.
                Calibration is required before layout.
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
