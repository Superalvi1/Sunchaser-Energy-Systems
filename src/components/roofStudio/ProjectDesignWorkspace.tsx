/**
 * Project Design Workspace V1 — CRM-connected HelioScope-style workflow.
 * Left controls · Center canvas · Right live engine results.
 * Design Session persistence (RC-1.1): one draft session per lead via CRM API.
 * No localStorage / sessionStorage / IndexedDB. Engines unchanged.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save, Sun } from "lucide-react";
import type { Lead } from "../../types";
import { formatLeadLocation, sanitizeLeadLocationInput } from "../../lib/leadDisplay";
import {
  parseOptionalGpsAnchor,
  type SiteGeoReference,
  DEFAULT_SITE_GEO,
} from "../../lib/roofStudioGeoReference";
import {
  AUTO_LAYOUT_CANCELLED_ROOF_EDIT_MESSAGE,
  AUTO_LAYOUT_RUNNING_MESSAGE,
  DEFAULT_DESIGN_CONTROLS,
  buildDesignStudioLiveResults,
  canRunDesignStudioAutoLayout,
  displayCustomerPhone,
  formatAutoLayoutSuccessMessage,
  roofGeometryFingerprint,
  runDesignStudioAutoLayout,
  shouldCancelAutoLayoutOnStudioChange,
  validateDesignStudioLayoutSettings,
  type AutoLayoutUxPhase,
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
import {
  buildDesignSessionPayload,
  designSessionPayloadFingerprint,
  parseDesignSessionPayload,
} from "../../lib/designSessionClient";
import { fetchDesignSession, saveDesignSession } from "../../services/api";
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

const AUTOSAVE_MS = 30_000;
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
  const [autoLayoutPhase, setAutoLayoutPhase] = useState<AutoLayoutUxPhase>("idle");
  const [studioSnap, setStudioSnap] = useState<{
    state: RoofStudioState | null;
    hasImage: boolean;
    calibrated: boolean;
    imageFileName: string | null;
    imageUrl: string | null;
  }>({ state: null, hasImage: false, calibrated: false, imageFileName: null, imageUrl: null });
  const studioApiRef = useRef<RoofStudioApi | null>(null);
  const autoLayoutRunIdRef = useRef(0);
  const autoLayoutStartFingerprintRef = useRef("");
  const autoLayoutPhaseRef = useRef<AutoLayoutUxPhase>("idle");
  autoLayoutPhaseRef.current = autoLayoutPhase;

  const [sessionVersion, setSessionVersion] = useState<number | null>(null);
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [concurrentEdit, setConcurrentEdit] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const savedFingerprintRef = useRef<string>("");
  const restoringRef = useRef(false);
  const saveInFlightRef = useRef(false);

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
    setAutoLayoutPhase("idle");
    setSettingsError(null);
    setControls({ ...DEFAULT_DESIGN_CONTROLS });
    setAlignment("center");
    setSessionVersion(null);
    setSessionUpdatedAt(null);
    setDirty(false);
    setSaveMessage(null);
    setConcurrentEdit(false);
    savedFingerprintRef.current = "";
  }, [leadId]);

  const sanctionedDisplay = useMemo(
    () => resolveSanctionedLoad(lead, sanctionedLoad),
    [lead, sanctionedLoad]
  );

  const customerPhone = displayCustomerPhone(lead?.phone);

  const commitGps = useCallback(
    (nextLat: string, nextLng: string) => {
      const parsed = parseOptionalGpsAnchor(nextLat, nextLng);
            (parsed as any).setGpsError ? setGpsError((parsed as any).error) : setGpsError(null);
            if (!parsed.ok) {
              setGpsError((parsed as any).error);
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
      if (
        shouldCancelAutoLayoutOnStudioChange({
          phase: autoLayoutPhaseRef.current,
          startFingerprint: autoLayoutStartFingerprintRef.current,
          nextState: snap.state,
        })
      ) {
        autoLayoutRunIdRef.current += 1;
        autoLayoutPhaseRef.current = "cancelled";
        setAutoLayoutPhase("cancelled");
        setAutoLayoutMessage(AUTO_LAYOUT_CANCELLED_ROOF_EDIT_MESSAGE);
        setLayoutResult(null);
      }
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
      setSettingsError(check.ok ? null : (check as any).message);
      return next;
    });
    setLayoutResult(null);
    setAutoLayoutMessage(null);
    setAutoLayoutPhase("idle");
  };

  const handleAlignmentChange = (value: LayoutAlignment) => {
    setAlignment(value);
    const check = validateDesignStudioLayoutSettings({ ...controls, alignment: value });
    setSettingsError(check.ok ? null : (check as any).message);
    setLayoutResult(null);
    setAutoLayoutMessage(null);
    setAutoLayoutPhase("idle");
  };

  const handleAutoLayout = useCallback(() => {
    if (autoLayoutPhaseRef.current === "running") return;
    const api = studioApiRef.current;
    if (!api) {
      setAutoLayoutPhase("failure");
      setAutoLayoutMessage("Canvas not ready.");
      return;
    }

    const runId = ++autoLayoutRunIdRef.current;
    const startState = api.getState();
    const startFingerprint = roofGeometryFingerprint(startState);
    autoLayoutStartFingerprintRef.current = startFingerprint;
    autoLayoutPhaseRef.current = "running";
    setAutoLayoutPhase("running");
    setAutoLayoutMessage(AUTO_LAYOUT_RUNNING_MESSAGE);
    setLayoutResult(null);

    const finishCancelled = () => {
      if (runId !== autoLayoutRunIdRef.current) return;
      autoLayoutPhaseRef.current = "cancelled";
      setAutoLayoutPhase("cancelled");
      setAutoLayoutMessage(AUTO_LAYOUT_CANCELLED_ROOF_EDIT_MESSAGE);
      setLayoutResult(null);
    };

    void (async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      if (runId !== autoLayoutRunIdRef.current) return;

      const state = api.getState();
      if (roofGeometryFingerprint(state) !== startFingerprint) {
        finishCancelled();
        return;
      }

      const gate = canRunDesignStudioAutoLayout({
        hasImage: api.hasImage(),
        state,
        controls: { ...controls, alignment },
      });
      if (!gate.ok) {
        if (runId !== autoLayoutRunIdRef.current) return;
        autoLayoutPhaseRef.current = "failure";
        setAutoLayoutPhase("failure");
        setAutoLayoutMessage(gate.reason);
        setSettingsError(gate.code && gate.code !== "GATED" ? gate.reason : null);
        setLayoutResult(null);
        return;
      }

      const result = runDesignStudioAutoLayout(state, controls, { hasImage: api.hasImage() });
      if (runId !== autoLayoutRunIdRef.current) return;

      if (roofGeometryFingerprint(api.getState()) !== startFingerprint) {
        finishCancelled();
        return;
      }

      if (!result.ok) {
        autoLayoutPhaseRef.current = "failure";
        setAutoLayoutPhase("failure");
        setAutoLayoutMessage((result as any).message);
        setLayoutResult(null);
        return;
      }

      autoLayoutPhaseRef.current = "success";
      setAutoLayoutPhase("success");
      setLayoutResult(result.layout);
      setSettingsError(null);
      setAutoLayoutMessage(formatAutoLayoutSuccessMessage(result.layout));
    })();
  }, [controls, alignment]);

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
        setLocateMessage((result as any).message);
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
      setSatelliteMessage(parsed.ok ? "Enter valid latitude and longitude first." : (parsed as any).error);
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
        setSatelliteMessage((result as any).message);
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
    state: studioSnap.state,
    controls: { ...controls, alignment },
  });
  const autoLayoutDisabled = !autoLayoutGate.ok || autoLayoutPhase === "running";

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

  const buildCurrentPayload = useCallback(() => {
    const state =
      studioSnap.state ??
      studioApiRef.current?.getState() ??
      createInitialRoofStudioState(`lead-${leadId}`);
    return buildDesignSessionPayload({
      roofStudioState: state,
      controls,
      alignment,
      address,
      latText,
      lngText,
      imageUrl: studioSnap.imageUrl,
      imageFileName: studioSnap.imageFileName,
      layoutResult,
      live,
    });
  }, [
    studioSnap,
    controls,
    alignment,
    address,
    latText,
    lngText,
    layoutResult,
    live,
    leadId,
  ]);

  const markSaved = useCallback(
    (payload: ReturnType<typeof buildDesignSessionPayload>, version: number, updatedAt: string) => {
      savedFingerprintRef.current = designSessionPayloadFingerprint(payload);
      setSessionVersion(version);
      setSessionUpdatedAt(updatedAt);
      setDirty(false);
      setConcurrentEdit(false);
    },
    []
  );

  const persistDesignSession = useCallback(
    async (source: "manual" | "autosave") => {
      if (leadId === "unknown-lead") return;
      if (saveInFlightRef.current || restoringRef.current) return;
      if (source === "autosave" && autoLayoutPhaseRef.current === "running") return;
      const payload = buildCurrentPayload();
      const fingerprint = designSessionPayloadFingerprint(payload);
      if (source === "autosave" && fingerprint === savedFingerprintRef.current) {
        setDirty(false);
        return;
      }
      saveInFlightRef.current = true;
      setSaving(true);
      try {
        const result = await saveDesignSession(leadId, {
          payload: payload as unknown as Record<string, unknown>,
          expectedVersion: sessionVersion,
          status: "draft",
        });
        if (!result.success) {
          setConcurrentEdit(true);
          setSaveMessage((result as any).error);
          if (result.session?.version != null) {
            setSessionVersion(result.session.version);
            setSessionUpdatedAt(result.session.updatedAt);
          }
          return;
        }
        markSaved(payload, result.session.version, result.session.updatedAt);
        setSaveMessage(
          source === "autosave"
            ? `Auto-saved draft v${result.session.version}`
            : `Saved design draft v${result.session.version}`
        );
      } catch (err: any) {
        setSaveMessage(err?.message || "Failed to save design session");
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [leadId, buildCurrentPayload, sessionVersion, markSaved]
  );

  // Dirty tracking
  useEffect(() => {
    if (restoringRef.current || restoring) return;
    if (!studioSnap.state) return;
    const fp = designSessionPayloadFingerprint(buildCurrentPayload());
    setDirty(fp !== savedFingerprintRef.current);
  }, [
    buildCurrentPayload,
    studioSnap,
    controls,
    alignment,
    address,
    latText,
    lngText,
    layoutResult,
    restoring,
  ]);

  // Auto-save every 30s when dirty (skip while Auto Layout is running)
  useEffect(() => {
    if (!dirty || restoring || concurrentEdit || leadId === "unknown-lead") return;
    if (autoLayoutPhase === "running") return;
    const timer = setInterval(() => {
      void persistDesignSession("autosave");
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [dirty, restoring, concurrentEdit, leadId, persistDesignSession, autoLayoutPhase]);

  // Restore on open / lead change
  useEffect(() => {
    if (leadId === "unknown-lead") return;
    let cancelled = false;
    restoringRef.current = true;
    setRestoring(true);
    setSaveMessage(null);
    setConcurrentEdit(false);

    const waitForApi = async (tries = 40): Promise<RoofStudioApi | null> => {
      for (let i = 0; i < tries; i++) {
        if (cancelled) return null;
        if (studioApiRef.current) return studioApiRef.current;
        await new Promise((r) => setTimeout(r, 50));
      }
      return studioApiRef.current;
    };

    void (async () => {
      try {
        const { exists, session } = await fetchDesignSession(leadId);
        if (cancelled) return;
        if (!exists || !session) {
          const empty = buildDesignSessionPayload({
            roofStudioState: createInitialRoofStudioState(`lead-${leadId}`),
            controls: { ...DEFAULT_DESIGN_CONTROLS },
            alignment: "center",
            address: initialAddress(lead),
            latText: "",
            lngText: "",
            imageUrl: null,
            imageFileName: null,
            layoutResult: null,
            live: null,
          });
          savedFingerprintRef.current = designSessionPayloadFingerprint(empty);
          setSessionVersion(null);
          setDirty(false);
          setSaveMessage("New design draft — save to persist.");
          return;
        }

        const payload = parseDesignSessionPayload(session.payload);
        if (!payload) {
          setSaveMessage("Saved design payload was invalid — starting fresh.");
          return;
        }

        setAddress(payload.address || initialAddress(lead));
        setLatText(payload.latText || "");
        setLngText(payload.lngText || "");
        setControls({ ...DEFAULT_DESIGN_CONTROLS, ...payload.controls });
        setAlignment(payload.alignment);
        setLayoutResult(payload.layoutResult);
        if (payload.latText || payload.lngText) {
          const parsed = parseOptionalGpsAnchor(payload.latText, payload.lngText);
          if (parsed.ok) {
            setGeoSeed((prev) => ({
              ...prev,
              siteLabel: payload.address || customerName || prev.siteLabel,
              latitude: parsed.anchor?.latitude ?? null,
              longitude: parsed.anchor?.longitude ?? null,
            }));
          }
        }

        const api = await waitForApi();
        if (cancelled) return;
        if (api) {
          api.applyState(payload.roofStudioState);
          if (payload.backgroundImage.remoteUrl) {
            await api.setBackgroundImageFromUrl(
              payload.backgroundImage.remoteUrl,
              payload.backgroundImage.fileName || "restored-satellite"
            );
          }
        }

        markSaved(payload, session.version, session.updatedAt);
        if (session.concurrentEditDetected) {
          setConcurrentEdit(true);
          setSaveMessage("Previous save detected a concurrent edit — review before overwriting.");
        } else {
          setSaveMessage(`Restored draft v${session.version}`);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSaveMessage(err?.message || "Could not restore design session");
        }
      } finally {
        if (!cancelled) {
          restoringRef.current = false;
          setRestoring(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      restoringRef.current = false;
    };
  }, [leadId]);

  return (
    <div className="space-y-5 text-left studio-fade-in">
      <StudioPageHeader
        icon={Sun}
        title="Project Design Workspace"
        badges={
          <>
            <StudioBadge variant="accent">V1 · HelioScope controls</StudioBadge>
            <StudioBadge variant={dirty ? "accent" : "muted"}>
              {restoring ? "Restoring…" : dirty ? "Unsaved draft" : "Draft"}
            </StudioBadge>
            {sessionVersion != null ? (
              <StudioBadge variant="muted">v{sessionVersion}</StudioBadge>
            ) : null}
          </>
        }
        description="Left controls → canvas → live results. Design sessions persist per lead. Engines unchanged."
        actions={
          <>
            <StudioButton
              variant="primary"
              disabled={saving || restoring || leadId === "unknown-lead"}
              onClick={() => void persistDesignSession("manual")}
              data-testid="design-session-save"
              icon={Save}
              loading={saving}
            >
              Save Design
            </StudioButton>
          </>
        }
      />

      {(saveMessage || concurrentEdit || sessionUpdatedAt) && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            concurrentEdit
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : "border-white/10 bg-white/5 text-slate-300"
          }`}
          data-testid="design-session-status"
        >
          {concurrentEdit ? "Concurrent edit detected. Reload or save carefully. " : null}
          {saveMessage}
          {sessionUpdatedAt && !concurrentEdit ? (
            <span className="ml-2 opacity-70">
              Last modified {new Date(sessionUpdatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      )}

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
            autoLayoutPhase={autoLayoutPhase}
            settingsError={settingsError}
            onUploadImage={() => studioApiRef.current?.openImagePicker()}
            onCalibrate={() => studioApiRef.current?.setTool("calibrate-scale")}
            onResetCalibration={() => {
              studioApiRef.current?.resetCalibration();
              setLayoutResult(null);
              setAutoLayoutMessage("Calibration reset.");
              setAutoLayoutPhase("idle");
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
            autoLayoutDisabled={autoLayoutDisabled}
            autoLayoutMessage={
              autoLayoutMessage ?? (!autoLayoutGate.ok ? autoLayoutGate.reason : null)
            }
          />
        </aside>
      </div>
    </div>
  );
}
