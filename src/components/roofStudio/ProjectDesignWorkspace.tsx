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
  fetchSatelliteImage,
  isSatelliteProviderConfigured,
  resolveSatelliteDisplayUrl,
  type LocatePropertyResult,
} from "../../lib/designStudioMapProviders";
import "../../lib/googleMapsProvider";
import { createInitialRoofStudioState, type RoofStudioState } from "../../lib/roofStudioClient";
import RoofIntelligenceStudio, {
  type ProjectDesignContext,
  type RoofStudioApi,
} from "./RoofIntelligenceStudio";
import DesignStudioResultsPanel from "./DesignStudioResultsPanel";
import DesignStudioLeftControlPanel from "./DesignStudioLeftControlPanel";
import {
  StudioBadge,
  StudioButton,
  StudioEmptyState,
  StudioPageHeader,
} from "../ui/studio";

export interface ProjectDesignWorkspaceProps {
  lead: Lead | null | undefined;
  sanctionedLoad?: string | number | null;
}

function resolveSanctionedLoad(
  lead: Lead | null | undefined,
  override?: string | number | null
): string {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return String(override).trim();
  }
  if (lead?.sanctionedLoad != null && Number.isFinite(Number(lead.sanctionedLoad))) {
    return `${lead.sanctionedLoad} kW`;
  }
  const quotes = Array.isArray(lead?.quotes) ? lead!.quotes : [];
  for (let i = quotes.length - 1; i >= 0; i--) {
    const q = quotes[i] as { lescoSettings?: { sanctionedLoad?: string } };
    const fromQuote = q?.lescoSettings?.sanctionedLoad;
    if (fromQuote && String(fromQuote).trim()) return String(fromQuote).trim();
  }
  return "Not set";
}

function initialAddress(lead: Lead | null | undefined): string {
  if (!lead) return "";
  try {
    const fromFormat = formatLeadLocation(lead);
    if (fromFormat !== "Location not specified") return fromFormat;
  } catch {
    /* safe fallback below */
  }
  return sanitizeLeadLocationInput(lead.address) || sanitizeLeadLocationInput(lead.location) || "";
}

function safeLeadId(lead: Lead | null | undefined): string {
  const id = lead?.id != null ? String(lead.id).trim() : "";
  return id || "unknown-lead";
}

function safeLeadName(lead: Lead | null | undefined): string {
  const name = lead?.name != null ? String(lead.name).trim() : "";
  return name || "Customer";
}

export default function ProjectDesignWorkspace({
  lead,
  sanctionedLoad,
}: ProjectDesignWorkspaceProps) {
  const leadId = safeLeadId(lead);
  const customerName = safeLeadName(lead);
  const [address, setAddress] = useState(() => initialAddress(lead));
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [satelliteMessage, setSatelliteMessage] = useState<string | null>(null);
  const [geoSeed, setGeoSeed] = useState<SiteGeoReference>(() => ({
    ...DEFAULT_SITE_GEO,
    siteLabel: customerName === "Customer" ? "" : customerName,
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
    imageFileName: string | null;
    imageUrl: string | null;
  }>({ state: null, hasImage: false, calibrated: false, imageFileName: null, imageUrl: null });
  const studioApiRef = useRef<RoofStudioApi | null>(null);

  useEffect(() => {
    setAddress(initialAddress(lead));
    setLatText("");
    setLngText("");
    setGpsError(null);
    setLocateMessage(null);
    setSatelliteMessage(null);
    setGeoSeed({
      ...DEFAULT_SITE_GEO,
      siteLabel: safeLeadName(lead) === "Customer" ? "" : safeLeadName(lead),
    });
    setLayoutResult(null);
    setAutoLayoutMessage(null);
    setSettingsError(null);
    setControls({ ...DEFAULT_DESIGN_CONTROLS });
    setAlignment("center");
  }, [leadId]);

  const sanctionedDisplay = useMemo(
    () => resolveSanctionedLoad(lead, sanctionedLoad),
    [lead, sanctionedLoad]
  );

  const customerPhone = displayCustomerPhone(lead?.phone);

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
        siteLabel: address.trim() || customerName || prev.siteLabel,
        latitude: parsed.anchor?.latitude ?? null,
        longitude: parsed.anchor?.longitude ?? null,
      }));
    },
    [address, customerName]
  );

  const project: ProjectDesignContext = useMemo(
    () => ({
      leadId,
      customerName,
      phone: lead?.phone != null ? String(lead.phone) : "",
      address,
      sanctionedLoad: sanctionedDisplay,
      geoSeed,
    }),
    [leadId, customerName, lead?.phone, address, sanctionedDisplay, geoSeed]
  );

  const live = useMemo(() => {
    if (!studioSnap.state) {
      return buildDesignStudioLiveResults(createInitialRoofStudioState(`lead-${leadId}`), controls, null, {
        hasImage: false,
      });
    }
    return buildDesignStudioLiveResults(studioSnap.state, controls, layoutResult, {
      hasImage: studioSnap.hasImage,
    });
  }, [studioSnap, controls, layoutResult, leadId]);

  const onStudioStateChange = useCallback(
    (snap: {
      state: RoofStudioState;
      hasImage: boolean;
      calibrated: boolean;
      imageFileName: string | null;
      imageUrl: string | null;
    }) => {
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
      const formatted = String(result.result.formattedAddress ?? "").trim();
      if (formatted) setAddress(formatted);
      setLocateMessage(
        formatted
          ? `Located via ${result.result.provider ?? "provider"}.`
          : `Coordinates set via ${result.result.provider ?? "provider"}.`
      );
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
    const canvasEl = document.querySelector(
      '[data-testid="roof-intelligence-canvas"], canvas'
    ) as HTMLCanvasElement | null;
    const width = canvasEl?.clientWidth && canvasEl.clientWidth > 64 ? Math.min(640, canvasEl.clientWidth) : 640;
    const height = canvasEl?.clientHeight && canvasEl.clientHeight > 64 ? Math.min(640, canvasEl.clientHeight) : 640;
    void fetchSatelliteImage({
      latitude: parsed.anchor.latitude,
      longitude: parsed.anchor.longitude,
      width,
      height,
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
      setSatelliteMessage("Satellite image loaded on canvas. Calibrate scale before Auto Layout.");
      setLayoutResult(null);
      setAutoLayoutMessage("Satellite image loaded — calibrate scale before Auto Layout.");
    });
  }, [latText, lngText]);

  const autoLayoutGate = canRunDesignStudioAutoLayout({
    hasImage: studioSnap.hasImage,
    calibrated: studioSnap.calibrated,
    state: studioSnap.state,
    controls: { ...controls, alignment },
  });

  const proposalCustomer = useMemo(
    () => ({
      name: customerName,
      phone: customerPhone,
      address: address || "Address not provided",
      sanctionedLoad: sanctionedDisplay,
    }),
    [customerName, customerPhone, address, sanctionedDisplay]
  );

  const roofPreview = useMemo(
    () => ({
      imageUrl: studioSnap.imageUrl,
      imageFileName: studioSnap.imageFileName,
    }),
    [studioSnap.imageUrl, studioSnap.imageFileName]
  );

  return (
    <div className="space-y-5 text-left studio-fade-in">
      <StudioPageHeader
        icon={Sun}
        title="Project Design Workspace"
        badges={
          <>
            <StudioBadge variant="accent">V1 · HelioScope controls</StudioBadge>
            <StudioBadge variant="muted">Draft only</StudioBadge>
          </>
        }
        description="Left controls → canvas → live results. Existing engines only. No AI guessing. No fake output."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-3">
          <DesignStudioLeftControlPanel
            customerName={customerName}
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
            imageFileName={studioSnap.imageFileName}
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

        <div className="xl:col-span-5 space-y-3">
          {!studioSnap.hasImage && (
            <StudioEmptyState
              icon={Sun}
              title={UPLOAD_OR_CONNECT_MAP_LABEL}
              description={
                isSatelliteProviderConfigured()
                  ? "Locate the property, then Fetch Satellite Image — or upload a roof photo. Calibration is still required before Auto Layout."
                  : "No satellite provider connected. Upload a roof image from the left panel, or enter coordinates manually. Calibration is required before layout."
              }
              className="studio-fade-in"
              action={
                <StudioButton
                  variant="primary"
                  onClick={() => studioApiRef.current?.openImagePicker()}
                  data-testid="use-uploaded-image"
                >
                  Use Uploaded Image
                </StudioButton>
              }
              data-testid="property-location-map-placeholder"
            />
          )}
          <RoofIntelligenceStudio
            key={leadId}
            project={project}
            workspaceMode
            chromeMode="canvas"
            studioApiRef={studioApiRef}
            onStudioStateChange={onStudioStateChange}
            overlayPanels={overlayPanels}
          />
        </div>

        <aside className="xl:col-span-4 space-y-2 max-h-[780px] overflow-y-auto">
          <DesignStudioResultsPanel
            live={live}
            controls={controls}
            customer={proposalCustomer}
            roofPreview={roofPreview}
            onAutoLayout={handleAutoLayout}
            autoLayoutDisabled={!autoLayoutGate.ok}
            autoLayoutMessage={autoLayoutMessage ?? (!autoLayoutGate.ok ? autoLayoutGate.reason : null)}
          />
        </aside>
      </div>
    </div>
  );
}
