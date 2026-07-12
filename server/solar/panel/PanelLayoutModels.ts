/**
 * Phase 3B — Intelligent Panel Layout Engine V2 models.
 * Deterministic panel packing only. No AI, electrical, production, CRM, save, PDF.
 *
 * Geometry primitives come from server/solar/roof — never re-declared here.
 */

import type {
  MaintenanceWalkwayDef,
  ObstacleDef,
  Point2D,
  RoofSetbackConfig,
} from "../roof/RoofModels.ts";

export const PANEL_LAYOUT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type PanelOrientation = "portrait" | "landscape";

/** Orientation policies the solver supports. */
export type PanelOrientationPolicy =
  | "portrait_only"
  | "landscape_only"
  | "auto"
  /** Future interface only — not implemented in V2. */
  | "mixed";

export interface PanelModuleSpec {
  moduleId: string;
  name: string;
  /** Short edge (m) — typically module width. */
  widthM: number;
  /** Long edge (m) — typically module length. */
  heightM: number;
  wattage: number;
}

export interface PanelSpacingConstraints {
  /** Gap between panels along a row (m). */
  gapM: number;
  /** Gap between rows (m). */
  rowSpacingM: number;
  /** Extra edge clearance beyond fire/setback inset (m). */
  edgeClearanceM: number;
  /** Clearance around obstacles / structure (m). */
  structureClearanceM: number;
}

export interface PanelLayoutConstraints {
  spacing: PanelSpacingConstraints;
  /** Fire / code setbacks — merged with roof engine defaults. */
  setbacks: Partial<RoofSetbackConfig>;
}

export interface PanelLayoutPlaneInput {
  planeId: string;
  boundary: Point2D[];
  obstacles?: ObstacleDef[];
  walkways?: MaintenanceWalkwayDef[];
  setbacks?: Partial<RoofSetbackConfig>;
}

export interface PanelLayoutInput {
  plane: PanelLayoutPlaneInput;
  /** Meters per coordinate unit (calibrated scale). */
  metersPerUnit: number;
  module: PanelModuleSpec;
  orientationPolicy: PanelOrientationPolicy;
  constraints?: Partial<PanelLayoutConstraints>;
}

export interface PlacedPanel {
  panelId: string;
  planeId: string;
  /** Top-left corner in world/plan units. */
  x: number;
  y: number;
  widthUnits: number;
  heightUnits: number;
  orientation: PanelOrientation;
  row: number;
  column: number;
  wattage: number;
}

export interface UnusedRegion {
  regionId: string;
  /** Axis-aligned leftover cell in plan units (approximate unused strip). */
  x: number;
  y: number;
  widthUnits: number;
  heightUnits: number;
  areaM2: number;
}

export interface PanelLayoutResult {
  generatedAt: string;
  planeId: string;
  moduleId: string;
  orientationPolicy: PanelOrientationPolicy;
  orientationUsed: PanelOrientation | "none";
  panels: PlacedPanel[];
  panelCount: number;
  dcCapacityKw: number;
  usableAreaM2: number;
  coveredAreaM2: number;
  utilizationPct: number;
  unusedRegions: UnusedRegion[];
  warnings: string[];
}

export const PANEL_ORIENTATION_POLICIES = [
  "portrait_only",
  "landscape_only",
  "auto",
  "mixed",
] as const;

export type PanelLayoutErrorCode =
  | "INVALID_METERS_PER_UNIT"
  | "INVALID_MODULE"
  | "INVALID_BOUNDARY"
  | "INVALID_OBSTACLE"
  | "INVALID_WALKWAY"
  | "INVALID_ORIENTATION_POLICY"
  | "SELF_INTERSECTING_ROOF"
  | "ZERO_AREA_ROOF"
  | "INSUFFICIENT_VERTICES"
  | "NON_FINITE"
  | "MIXED_NOT_IMPLEMENTED"
  | "NO_USABLE_AREA";

export class PanelLayoutError extends Error {
  readonly code: PanelLayoutErrorCode;
  constructor(code: PanelLayoutErrorCode, message: string) {
    super(message);
    this.name = "PanelLayoutError";
    this.code = code;
  }
}
