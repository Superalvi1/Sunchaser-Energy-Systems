/**
 * Roof Intelligence Phase 2A — shared models and constants.
 * Pure TypeScript. Deterministic. No AI, routes, UI, or DB.
 */

export const ROOF_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
export const ROOF_EPSILON = 1e-9;

export interface Point2D {
  x: number;
  y: number;
}

export interface RoofBounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export type RoofOrientation = "north" | "northeast" | "east" | "southeast" | "south" | "southwest" | "west" | "northwest" | "flat";

export type PanelMountOrientation = "portrait" | "landscape";

export interface RoofPolygonDef {
  id: string;
  vertices: Point2D[];
}

export interface RidgeDef {
  id: string;
  start: Point2D;
  end: Point2D;
}

export interface ValleyDef {
  id: string;
  start: Point2D;
  end: Point2D;
}

export interface ParapetDef {
  id: string;
  /** Edge index on plane boundary, or standalone strip polygon */
  edgeIndex?: number;
  heightM: number;
  thicknessM: number;
  strip?: Point2D[];
}

export interface ObstacleDef {
  id: string;
  polygon: Point2D[];
  heightM?: number;
  setbackM?: number;
}

export interface MaintenanceWalkwayDef {
  id: string;
  polygon: Point2D[];
  widthM: number;
}

export interface RoofSetbackConfig {
  edgeSetbackM: number;
  ridgeSetbackM: number;
  valleySetbackM: number;
  parapetSetbackM: number;
  obstacleClearanceM: number;
  maintenanceWalkwayM: number;
}

export interface RoofPlaneInput {
  id: string;
  boundary: Point2D[];
  pitchDeg: number;
  azimuthDeg: number;
  panelMountOrientation?: PanelMountOrientation;
  obstacles?: ObstacleDef[];
  parapets?: ParapetDef[];
  ridges?: RidgeDef[];
  valleys?: ValleyDef[];
  walkways?: MaintenanceWalkwayDef[];
  setbacks?: Partial<RoofSetbackConfig>;
}

export interface RoofSiteInput {
  siteId: string;
  planes: RoofPlaneInput[];
  /** Meters per coordinate unit when working in plan pixels */
  metersPerUnit?: number;
  origin?: Point2D;
  northAzimuthDeg?: number;
}

export interface RoofPlaneMetrics {
  planeId: string;
  planAreaM2: number;
  trueAreaM2: number;
  perimeterM: number;
  pitchDeg: number;
  azimuthDeg: number;
  orientation: RoofOrientation;
  panelMountOrientation: PanelMountOrientation;
  grossUsableAreaM2: number;
  obstacleAreaM2: number;
  parapetAreaM2: number;
  walkwayAreaM2: number;
  setbackAreaM2: number;
  netUsableAreaM2: number;
  ridgeLengthM: number;
  valleyLengthM: number;
}

export interface RoofSiteMetrics {
  generatedAt: string;
  siteId: string;
  planeCount: number;
  totalPlanAreaM2: number;
  totalTrueAreaM2: number;
  totalNetUsableAreaM2: number;
  planes: RoofPlaneMetrics[];
  warnings: string[];
}

export class RoofGeometryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RoofGeometryError";
  }
}

export interface InvalidRoofBoundaryDetails {
  errorCode: string;
  edgeIndexes?: [number, number];
  intersectionPoint?: Point2D;
  planeId?: string;
  vertexIndex?: number;
}

export class InvalidRoofBoundaryError extends RoofGeometryError {
  readonly errorCode: string;
  readonly edgeIndexes?: [number, number];
  readonly intersectionPoint?: Point2D;
  readonly planeId?: string;
  readonly vertexIndex?: number;

  constructor(details: InvalidRoofBoundaryDetails & { message: string }) {
    super(details.errorCode, details.message);
    this.name = "InvalidRoofBoundaryError";
    this.errorCode = details.errorCode;
    this.edgeIndexes = details.edgeIndexes;
    this.intersectionPoint = details.intersectionPoint;
    this.planeId = details.planeId;
    this.vertexIndex = details.vertexIndex;
  }
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** @deprecated Use requireFiniteNumber in validation paths — fail closed, no fallback. */
export function finiteNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isFinitePoint(p: Point2D): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}
