/**
 * Design Session client — serialize / restore Design Studio workspace.
 * Engines are not reimplemented: restore inputs, then recompute via
 * buildDesignStudioLiveResults / runDesignStudioAutoLayout.
 * No localStorage / sessionStorage / IndexedDB.
 */

import {
  DEFAULT_DESIGN_CONTROLS,
  type DesignStudioControls,
  type DesignStudioLiveResults,
  type LayoutAlignment,
} from "./sunchaserDesignStudioClient";
import { createInitialRoofStudioState, type RoofStudioState } from "./roofStudioClient";
import type { PanelLayoutResult } from "../../server/solar/panel/PanelLayoutModels.ts";

export const DESIGN_SESSION_PAYLOAD_VERSION = 1;

export interface DesignSessionBackgroundImage {
  /** Only remote http(s) URLs — never blob: */
  remoteUrl: string | null;
  fileName: string | null;
}

export interface DesignSessionResultsSnapshot {
  panelCount: number;
  dcKw: number;
  acKw: number | null;
  stringCount: number | null;
  annualKwh: number | null;
  performanceRatio: number | null;
  proposalReady: boolean;
  proposalStatus: string | null;
  electricalReady: boolean;
  simulationReady: boolean;
  boqReady: boolean;
}

export interface DesignSessionPayload {
  schemaVersion: number;
  roofStudioState: RoofStudioState;
  controls: DesignStudioControls;
  alignment: LayoutAlignment;
  address: string;
  latText: string;
  lngText: string;
  backgroundImage: DesignSessionBackgroundImage;
  /** Cached Auto Layout result (panel packing). Re-applied on restore. */
  layoutResult: PanelLayoutResult | null;
  /** Cached engine summaries for UX; live panel recomputes from engines. */
  resultsSnapshot: DesignSessionResultsSnapshot | null;
}

export interface DesignSessionBuildInput {
  roofStudioState: RoofStudioState;
  controls: DesignStudioControls;
  alignment: LayoutAlignment;
  address: string;
  latText: string;
  lngText: string;
  imageUrl: string | null;
  imageFileName: string | null;
  layoutResult: PanelLayoutResult | null;
  live: DesignStudioLiveResults | null;
}

function isRemoteImageUrl(url: string | null | undefined): boolean {
  const u = String(url || "").trim();
  return /^https?:\/\//i.test(u);
}

export function sanitizeBackgroundImage(
  imageUrl: string | null | undefined,
  fileName: string | null | undefined
): DesignSessionBackgroundImage {
  return {
    remoteUrl: isRemoteImageUrl(imageUrl) ? String(imageUrl).trim() : null,
    fileName: fileName != null && String(fileName).trim() ? String(fileName).trim() : null,
  };
}

export function buildResultsSnapshot(
  live: DesignStudioLiveResults | null | undefined
): DesignSessionResultsSnapshot | null {
  if (!live) return null;
  return {
    panelCount: Number(live.panelsSummary?.panelCount) || 0,
    dcKw: Number(live.panelsSummary?.dcKw) || 0,
    acKw: live.electricalSummary?.acKw != null ? Number(live.electricalSummary.acKw) : null,
    stringCount:
      live.electricalSummary?.stringCount != null
        ? Number(live.electricalSummary.stringCount)
        : null,
    annualKwh: live.production?.annualKwh != null ? Number(live.production.annualKwh) : null,
    performanceRatio:
      live.production?.performanceRatio != null ? Number(live.production.performanceRatio) : null,
    proposalReady: Boolean(live.proposal?.readyForPreview),
    proposalStatus: live.proposalStatus != null ? String(live.proposalStatus) : null,
    electricalReady: Boolean(live.status?.electricalReady),
    simulationReady: Boolean(live.status?.simulationReady),
    boqReady: Boolean(live.status?.boqReady),
  };
}

export function buildDesignSessionPayload(input: DesignSessionBuildInput): DesignSessionPayload {
  return {
    schemaVersion: DESIGN_SESSION_PAYLOAD_VERSION,
    roofStudioState: input.roofStudioState,
    controls: { ...DEFAULT_DESIGN_CONTROLS, ...input.controls },
    alignment: input.alignment === "left" || input.alignment === "right" ? input.alignment : "center",
    address: String(input.address || ""),
    latText: String(input.latText || ""),
    lngText: String(input.lngText || ""),
    backgroundImage: sanitizeBackgroundImage(input.imageUrl, input.imageFileName),
    layoutResult: input.layoutResult ?? null,
    resultsSnapshot: buildResultsSnapshot(input.live),
  };
}

/** Stable fingerprint for dirty detection (no timestamps). */
export function designSessionPayloadFingerprint(payload: DesignSessionPayload): string {
  const clone = {
    schemaVersion: payload.schemaVersion,
    roofStudioState: payload.roofStudioState,
    controls: payload.controls,
    alignment: payload.alignment,
    address: payload.address,
    latText: payload.latText,
    lngText: payload.lngText,
    backgroundImage: payload.backgroundImage,
    layoutResult: payload.layoutResult
      ? {
          panelCount: payload.layoutResult.panelCount,
          dcCapacityKw: payload.layoutResult.dcCapacityKw,
          panels: payload.layoutResult.panels,
        }
      : null,
  };
  return JSON.stringify(clone);
}

export function parseDesignSessionPayload(raw: unknown): DesignSessionPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const state = o.roofStudioState;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;

  const controlsRaw =
    o.controls && typeof o.controls === "object" && !Array.isArray(o.controls)
      ? (o.controls as Partial<DesignStudioControls>)
      : {};
  const controls: DesignStudioControls = { ...DEFAULT_DESIGN_CONTROLS, ...controlsRaw };

  const alignment: LayoutAlignment =
    o.alignment === "left" || o.alignment === "right" || o.alignment === "center"
      ? o.alignment
      : "center";

  const bg =
    o.backgroundImage && typeof o.backgroundImage === "object" && !Array.isArray(o.backgroundImage)
      ? (o.backgroundImage as Record<string, unknown>)
      : {};

  return {
    schemaVersion: Number(o.schemaVersion) || DESIGN_SESSION_PAYLOAD_VERSION,
    roofStudioState: state as RoofStudioState,
    controls,
    alignment,
    address: String(o.address ?? ""),
    latText: String(o.latText ?? ""),
    lngText: String(o.lngText ?? ""),
    backgroundImage: {
      remoteUrl: isRemoteImageUrl(String(bg.remoteUrl ?? ""))
        ? String(bg.remoteUrl)
        : null,
      fileName: bg.fileName != null && String(bg.fileName).trim() ? String(bg.fileName) : null,
    },
    layoutResult:
      o.layoutResult && typeof o.layoutResult === "object"
        ? (o.layoutResult as PanelLayoutResult)
        : null,
    resultsSnapshot:
      o.resultsSnapshot && typeof o.resultsSnapshot === "object"
        ? (o.resultsSnapshot as DesignSessionResultsSnapshot)
        : null,
  };
}

export function emptyDesignSessionPayload(leadId: string): DesignSessionPayload {
  return buildDesignSessionPayload({
    roofStudioState: createInitialRoofStudioState(`lead-${leadId}`),
    controls: { ...DEFAULT_DESIGN_CONTROLS },
    alignment: "center",
    address: "",
    latText: "",
    lngText: "",
    imageUrl: null,
    imageFileName: null,
    layoutResult: null,
    live: null,
  });
}

export function assertNoBrowserStorageInDesignSessionSources(source: string): boolean {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return !/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bIndexedDB\b/.test(code);
}
