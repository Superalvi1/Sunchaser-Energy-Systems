/**
 * Solar Proposal Studio — canvas geometry and UI constants.
 * Pricing/BOQ uses server/solar/pipeline via solarPipelineClient.ts.
 */

import type { EquipmentTier, StructureType, SystemType } from "../../server/solar/proposal/SolarProposalModels.ts";
import { SUPPORTED_SYSTEM_SIZES_KW } from "../../server/solar/proposal/SolarProposalModels.ts";

export type DesignStructureType = StructureType;
export type DesignSystemType = SystemType;
export type DesignPackageTier = EquipmentTier;
export type DesignToolMode = "boundary" | "obstacle" | "pan";
export type DesignSystemSizeSelection = (typeof SUPPORTED_SYSTEM_SIZES_KW)[number] | "auto";

export interface DesignPoint {
  x: number;
  y: number;
}

export interface DesignObstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProposalPreviewPage {
  id: string;
  title: string;
  subtitle: string;
  sections: Array<{ heading: string; lines: string[] }>;
}

export const PROPOSAL_CLIENT_PREVIEW_LABEL = "Prospective client";
export const DESIGN_INCOMPLETE_MESSAGE = "Complete roof design to generate proposal";
export const DESIGN_INCOMPLETE_BOQ_LABEL = "Design incomplete";

export function safeFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isDesignComplete(panelCount: number, systemSizeKw: number): boolean {
  return panelCount > 0 && systemSizeKw > 0;
}

export function proposalClientPreviewLabel(_clientName?: string): string {
  return PROPOSAL_CLIENT_PREVIEW_LABEL;
}

export interface NormalizeObstaclesOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  roofBoundary?: DesignPoint[];
  minSizePx?: number;
}

function boundingBox(points: DesignPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function normalizeObstacles(
  obstacles: unknown,
  opts: NormalizeObstaclesOptions = {}
): DesignObstacle[] {
  const canvasWidth = safeFiniteNumber(opts.canvasWidth, 800);
  const canvasHeight = safeFiniteNumber(opts.canvasHeight, 500);
  const minSizePx = safeFiniteNumber(opts.minSizePx, 4);
  const boundary = Array.isArray(opts.roofBoundary)
    ? opts.roofBoundary.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    : [];
  const bounds =
    boundary.length >= 3
      ? boundingBox(boundary)
      : { minX: 0, minY: 0, maxX: canvasWidth, maxY: canvasHeight };

  if (!Array.isArray(obstacles)) return [];

  const normalized: DesignObstacle[] = [];
  for (let i = 0; i < obstacles.length; i += 1) {
    const raw = obstacles[i];
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const x0 = safeFiniteNumber(o.x, Number.NaN);
    const y0 = safeFiniteNumber(o.y, Number.NaN);
    let w = safeFiniteNumber(o.w ?? o.width, Number.NaN);
    let h = safeFiniteNumber(o.h ?? o.height, Number.NaN);
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    if (w <= 0 || h <= 0) continue;

    const x = Math.max(bounds.minX, Math.min(x0, bounds.maxX));
    const y = Math.max(bounds.minY, Math.min(y0, bounds.maxY));
    w = Math.min(w, bounds.maxX - x);
    h = Math.min(h, bounds.maxY - y);
    if (w < minSizePx || h < minSizePx) continue;

    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `obs-${i}`;
    normalized.push({ id, x, y, w, h });
  }
  return normalized;
}

export const STRUCTURE_OPTIONS: { id: DesignStructureType; label: string; note: string }[] = [
  { id: "standard", label: "Standard", note: "Flush rooftop rails on flat or pitched roof" },
  {
    id: "elevated_hbeam",
    label: "Elevated H-Beam / C-Channel",
    note: "Raised H-beam and C-channel frame for clearance and long spans",
  },
];

export const SYSTEM_TYPE_OPTIONS: { id: DesignSystemType; label: string; note: string }[] = [
  { id: "on-grid", label: "On-grid", note: "Net metering with grid-tied inverter" },
  { id: "hybrid", label: "Hybrid", note: "Battery backup with grid fallback" },
  { id: "off-grid", label: "Off-grid", note: "Standalone system with storage bank" },
];

export const PACKAGE_OPTIONS: { id: DesignPackageTier; label: string; note: string }[] = [
  { id: "budget", label: "Budget", note: "Value-tier panels, standard protection" },
  { id: "premium", label: "Premium", note: "Tier-1 panels, extended warranty bundle" },
];

export const SYSTEM_SIZE_PRESETS: readonly number[] = SUPPORTED_SYSTEM_SIZES_KW;

export function polygonArea(points: DesignPoint[]): number {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < valid.length; i += 1) {
    const a = valid[i];
    const b = valid[(i + 1) % valid.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(point: DesignPoint, polygon: DesignPoint[]): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const valid = polygon.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 3) return false;
  let inside = false;
  for (let i = 0, j = valid.length - 1; i < valid.length; j = i, i += 1) {
    const xi = valid[i].x;
    const yi = valid[i].y;
    const xj = valid[j].x;
    const yj = valid[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function buildIncompleteProposalPreviewPages(): ProposalPreviewPage[] {
  return [
    {
      id: "incomplete",
      title: "Proposal Preview",
      subtitle: DESIGN_INCOMPLETE_BOQ_LABEL,
      sections: [
        {
          heading: "Status",
          lines: [DESIGN_INCOMPLETE_MESSAGE],
        },
      ],
    },
  ];
}
