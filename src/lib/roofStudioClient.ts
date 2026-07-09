/**
 * Roof Intelligence Studio — frontend CAD editor client adapter.
 *
 * All geometry math is delegated to server/solar/roof (RoofGeometryEngine and its
 * primitives). This module owns editor state, history (undo/redo), snapping, and
 * mapping between the editor model and the engine's RoofSiteInput. It performs NO
 * area/pitch/azimuth/orientation calculations of its own.
 *
 * Frontend only. No API, AI, persistence, PDF, quotation, or CRM writes.
 */

import { analyzeRoofSite } from "../../server/solar/roof/RoofGeometryEngine.ts";
import { validateRoofSiteStrict } from "../../server/solar/roof/RoofValidation.ts";
import {
  InvalidRoofBoundaryError,
  RoofGeometryError,
  type ObstacleDef,
  type ParapetDef,
  type Point2D,
  type RidgeDef,
  type RoofPlaneInput,
  type RoofPlaneMetrics,
  type RoofSiteInput,
  type RoofSiteMetrics,
  type ValleyDef,
  type MaintenanceWalkwayDef,
} from "../../server/solar/roof/RoofModels.ts";
import {
  detectPolygonSelfIntersections,
  distancePointToSegment,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonPerimeter,
} from "../../server/solar/roof/RoofPolygon.ts";
import {
  angleBetweenPointsDeg,
  lengthM,
  panelCapacityEstimateKw,
  segmentLength,
  unitsToMeters,
} from "../../server/solar/roof/RoofMeasurement.ts";
import {
  normalizeObstacles,
  obstacleFootprintWithClearance,
} from "../../server/solar/roof/RoofObstacle.ts";
import type { ScaleCalibration } from "./roofStudioCalibration.ts";
import { isScaleCalibrated, isValidScale, requireValidScale, RoofCalibrationError } from "./roofStudioCalibration.ts";
import type { DimensionAnnotation } from "./roofStudioDimensions.ts";
import type { EditableBoqLine } from "./roofStudioBoq.ts";
import { DEFAULT_PANEL_MODULE, type PanelModuleSpec, type StudioPanelPlacement } from "./roofStudioPanels.ts";
import { DEFAULT_STRUCTURE_LAYOUT, type StructureLayout } from "./roofStudioStructure.ts";
import { DEFAULT_SITE_GEO, type SiteGeoReference } from "./roofStudioGeoReference.ts";

export type { SiteGeoReference };

export type { Point2D, RoofSiteMetrics, RoofPlaneMetrics };
export type { ScaleCalibration, DimensionAnnotation, EditableBoqLine, PanelModuleSpec, StudioPanelPlacement, StructureLayout };
export { isScaleCalibrated, requireValidScale, RoofCalibrationError };

/** Physical area of one PV module (m²) — matches roof engine estimator default. */
export const PANEL_AREA_M2 = 2.58;
export const PANEL_WATTAGE = 580;
export const MAX_HISTORY = 60;

export type ToolMode =
  | "select"
  | "pan"
  | "calibrate-scale"
  | "dimension-line"
  | "panel-place"
  | "structure-h-beam"
  | "structure-c-channel"
  | "structure-column"
  | "structure-foundation"
  | "plane"
  | "obstacle-rect"
  | "obstacle-circle"
  | "obstacle-polygon"
  | "walkway"
  | "parapet"
  | "ridge"
  | "valley"
  | "measure-distance"
  | "measure-area"
  | "measure-angle";

export type LayerType =
  | "boundary"
  | "plane"
  | "obstacle"
  | "walkway"
  | "parapet"
  | "ridge"
  | "valley"
  | "panels"
  | "structure"
  | "measurements"
  | "north";

export const LAYER_ORDER: LayerType[] = [
  "boundary",
  "plane",
  "obstacle",
  "walkway",
  "parapet",
  "ridge",
  "valley",
  "panels",
  "structure",
  "measurements",
  "north",
];

export const LAYER_LABELS: Record<LayerType, string> = {
  boundary: "Roof Boundary",
  plane: "Roof Plane",
  obstacle: "Obstacle",
  walkway: "Walkway",
  parapet: "Parapet",
  ridge: "Ridge",
  valley: "Valley",
  panels: "Panels",
  structure: "Elevated Structure",
  measurements: "Measurements",
  north: "North Arrow",
};

export interface LayerState {
  type: LayerType;
  name: string;
  visible: boolean;
  locked: boolean;
}

export type ObstacleShape = "rect" | "circle" | "polygon";

export interface StudioObstacle {
  id: string;
  name: string;
  shape: ObstacleShape;
  /** Canonical polygon vertices in world units (already rotated). */
  vertices: Point2D[];
  rotationDeg: number;
  heightM: number;
  clearanceM: number;
}

export interface StudioWalkway {
  id: string;
  name: string;
  vertices: Point2D[];
  widthM: number;
}

export interface StudioParapet {
  id: string;
  name: string;
  vertices: Point2D[];
  heightM: number;
  thicknessM: number;
}

export interface StudioLine {
  id: string;
  name: string;
  start: Point2D;
  end: Point2D;
}

export interface StudioPlane {
  id: string;
  name: string;
  boundary: Point2D[];
  pitchDeg: number;
  azimuthDeg: number;
  obstacles: StudioObstacle[];
  walkways: StudioWalkway[];
  parapets: StudioParapet[];
  ridges: StudioLine[];
  valleys: StudioLine[];
}

export interface RoofStudioState {
  siteId: string;
  metersPerUnit: number;
  gridSizeUnits: number;
  northAzimuthDeg: number;
  geoReference: SiteGeoReference;
  planes: StudioPlane[];
  layers: Record<LayerType, LayerState>;
  selectedPlaneId: string | null;
  selectedObjectId: string | null;
  scaleCalibration: ScaleCalibration | null;
  dimensionAnnotations: DimensionAnnotation[];
  panelSpec: PanelModuleSpec;
  panelPlacements: StudioPanelPlacement[];
  structure: StructureLayout;
  boqLines: EditableBoqLine[];
}

export interface RoofStudioHistory {
  past: RoofStudioState[];
  present: RoofStudioState;
  future: RoofStudioState[];
}

export interface RoofStudioStatistics {
  planeCount: number;
  grossAreaM2: number;
  trueAreaM2: number;
  usableAreaM2: number;
  obstacleAreaM2: number;
  obstaclePercent: number;
  panelEstimate: number;
  capacityKw: number;
  warnings: string[];
}

export interface RoofStudioAnalysisError {
  errorCode: string;
  message: string;
  planeId?: string;
  edgeIndexes?: [number, number];
  intersectionPoint?: Point2D;
}

export interface RoofStudioAnalysis {
  ok: boolean;
  hasCompletePlane: boolean;
  metrics: RoofSiteMetrics | null;
  statistics: RoofStudioStatistics | null;
  error: RoofStudioAnalysisError | null;
}

let idCounter = 0;
export function nextStudioId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createDefaultLayers(): Record<LayerType, LayerState> {
  const layers = {} as Record<LayerType, LayerState>;
  for (const type of LAYER_ORDER) {
    layers[type] = { type, name: LAYER_LABELS[type], visible: true, locked: false };
  }
  return layers;
}

export function createInitialRoofStudioState(siteId = "roof-site"): RoofStudioState {
  return {
    siteId,
    metersPerUnit: 0,
    gridSizeUnits: 20,
    northAzimuthDeg: 0,
    geoReference: { ...DEFAULT_SITE_GEO },
    planes: [],
    layers: createDefaultLayers(),
    selectedPlaneId: null,
    selectedObjectId: null,
    scaleCalibration: null,
    dimensionAnnotations: [],
    panelSpec: { ...DEFAULT_PANEL_MODULE },
    panelPlacements: [],
    structure: { ...DEFAULT_STRUCTURE_LAYOUT, members: [], civilLabels: [...DEFAULT_STRUCTURE_LAYOUT.civilLabels] },
    boqLines: [],
  };
}

export function createHistory(state: RoofStudioState): RoofStudioHistory {
  return { past: [], present: state, future: [] };
}

/** Push a new state, clearing the redo stack and capping history depth. */
export function commit(history: RoofStudioHistory, next: RoofStudioState): RoofStudioHistory {
  const past = [...history.past, history.present];
  const trimmed = past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past;
  return { past: trimmed, present: next, future: [] };
}

export function canUndo(history: RoofStudioHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: RoofStudioHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: RoofStudioHistory): RoofStudioHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [history.present, ...history.future].slice(0, MAX_HISTORY);
  return { past, present: previous, future };
}

export function redo(history: RoofStudioHistory): RoofStudioHistory {
  if (history.future.length === 0) return history;
  const nextState = history.future[0];
  const future = history.future.slice(1);
  const past = [...history.past, history.present].slice(-MAX_HISTORY);
  return { past, present: nextState, future };
}

/* ---------------------------------------------------------------------------
 * Snapping (UI positioning helpers — not geometry engine domain)
 * ------------------------------------------------------------------------- */

export function snapToGrid(point: Point2D, gridSizeUnits: number): Point2D {
  if (!Number.isFinite(gridSizeUnits) || gridSizeUnits <= 0) return point;
  return {
    x: Math.round(point.x / gridSizeUnits) * gridSizeUnits,
    y: Math.round(point.y / gridSizeUnits) * gridSizeUnits,
  };
}

export function collectVertices(state: RoofStudioState): Point2D[] {
  const verts: Point2D[] = [];
  for (const plane of state.planes) {
    verts.push(...plane.boundary);
    for (const o of plane.obstacles) verts.push(...o.vertices);
    for (const w of plane.walkways) verts.push(...w.vertices);
    for (const p of plane.parapets) verts.push(...p.vertices);
    for (const r of plane.ridges) verts.push(r.start, r.end);
    for (const v of plane.valleys) verts.push(v.start, v.end);
  }
  return verts;
}

export function snapToVertices(point: Point2D, vertices: Point2D[], thresholdUnits: number): Point2D {
  let best: Point2D | null = null;
  let bestDist = thresholdUnits;
  for (const v of vertices) {
    const d = Math.hypot(v.x - point.x, v.y - point.y);
    if (d <= bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best ? { x: best.x, y: best.y } : point;
}

export function resolveSnappedPoint(
  point: Point2D,
  state: RoofStudioState,
  opts: { snapGrid: boolean; snapVertices: boolean; vertexThresholdUnits?: number }
): Point2D {
  let result = point;
  if (opts.snapVertices) {
    result = snapToVertices(result, collectVertices(state), opts.vertexThresholdUnits ?? state.gridSizeUnits / 2);
  }
  if (opts.snapGrid) {
    result = snapToGrid(result, state.gridSizeUnits);
  }
  return result;
}

/* ---------------------------------------------------------------------------
 * Polygon / shape construction (UI shape helpers)
 * ------------------------------------------------------------------------- */

export function rotatePolygon(vertices: Point2D[], degrees: number, center?: Point2D): Point2D[] {
  if (!Number.isFinite(degrees) || degrees === 0) return vertices.map((v) => ({ ...v }));
  const c = center ?? polygonCentroid(vertices) ?? boundsCenter(vertices);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return vertices.map((v) => {
    const dx = v.x - c.x;
    const dy = v.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  });
}

function boundsCenter(vertices: Point2D[]): Point2D {
  const b = polygonBounds(vertices);
  if (!b) return { x: 0, y: 0 };
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function rectVertices(x: number, y: number, w: number, h: number): Point2D[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function circleVertices(cx: number, cy: number, radius: number, segments = 24): Point2D[] {
  const verts: Point2D[] = [];
  const n = Math.max(8, Math.floor(segments));
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    verts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return verts;
}

/* ---------------------------------------------------------------------------
 * Vertex editing (pure array transforms; guards min polygon)
 * ------------------------------------------------------------------------- */

export function insertVertex(boundary: Point2D[], edgeIndex: number, point: Point2D): Point2D[] {
  if (edgeIndex < 0 || edgeIndex >= boundary.length) return boundary;
  const next = [...boundary];
  next.splice(edgeIndex + 1, 0, point);
  return next;
}

export function moveVertex(boundary: Point2D[], index: number, point: Point2D): Point2D[] {
  if (index < 0 || index >= boundary.length) return boundary;
  const next = [...boundary];
  next[index] = point;
  return next;
}

export function deleteVertex(boundary: Point2D[], index: number): Point2D[] {
  if (boundary.length <= 3 || index < 0 || index >= boundary.length) return boundary;
  const next = [...boundary];
  next.splice(index, 1);
  return next;
}

/** Nearest edge index for point-insertion, delegating distance math to the engine. */
export function nearestEdgeIndex(boundary: Point2D[], point: Point2D): number {
  if (boundary.length < 2) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const d = distancePointToSegment(point, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Measurement tools (delegate to engine primitives)
 * ------------------------------------------------------------------------- */

export function measureDistanceM(a: Point2D, b: Point2D, metersPerUnit: number): number {
  return unitsToMeters(segmentLength(a, b), requireValidScale(metersPerUnit));
}

export function measurePathLengthM(points: Point2D[], metersPerUnit: number): number {
  const mpu = requireValidScale(metersPerUnit);
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += segmentLength(points[i], points[i + 1]);
  }
  return unitsToMeters(total, mpu);
}

/** @deprecated Use RoofCalibrationError */
export class RoofStudioMeasurementScaleError extends RoofCalibrationError {
  constructor(message = "Calibrate scale first") {
    super(message);
    this.name = "RoofStudioMeasurementScaleError";
  }
}

/** @deprecated Use isValidScale from roofStudioCalibration */
export function isValidMeasurementScale(metersPerUnit: number): boolean {
  return isValidScale(metersPerUnit);
}

export function tryMeasureAreaM2(
  points: Point2D[],
  metersPerUnit: number
): { ok: true; areaM2: number } | { ok: false; message: string } {
  if (!isValidScale(metersPerUnit)) {
    return { ok: false, message: "Calibrate scale first" };
  }
  if (points.length < 3) {
    return { ok: true, areaM2: 0 };
  }
  const areaM2 = Math.round(polygonArea(points) * metersPerUnit * metersPerUnit * 100) / 100;
  if (!Number.isFinite(areaM2) || areaM2 < 0) {
    return { ok: false, message: "Calibrate scale first" };
  }
  return { ok: true, areaM2 };
}

export function measureAreaM2(points: Point2D[], metersPerUnit: number): number {
  const mpu = requireValidScale(metersPerUnit);
  if (points.length < 3) return 0;
  const areaM2 = Math.round(polygonArea(points) * mpu * mpu * 100) / 100;
  if (!Number.isFinite(areaM2) || areaM2 < 0) {
    throw new RoofCalibrationError("Scale not calibrated");
  }
  return areaM2;
}

/** Angle tool — delegates entirely to the roof engine's measurement primitive. */
export function measureAngleDeg(a: Point2D, vertex: Point2D, b: Point2D): number {
  return angleBetweenPointsDeg(a, vertex, b);
}

/* ---------------------------------------------------------------------------
 * Layer operations
 * ------------------------------------------------------------------------- */

/**
 * Generic layer-metadata mutation. Routes through `canMutateLayer`.
 *
 * The `locked` flag is the single escape hatch: toggling lock is ALWAYS permitted
 * (otherwise a locked layer could never be unlocked). Every other metadata change
 * (name, visibility, …) is blocked when the layer is locked — fail-closed.
 */
export function setLayer(state: RoofStudioState, type: LayerType, patch: Partial<LayerState>): RoofStudioState {
  const onlyLockChange = Object.keys(patch).length > 0 && Object.keys(patch).every((k) => k === "locked");
  if (!onlyLockChange && !canMutateLayer(state, type)) return state;
  return {
    ...state,
    layers: { ...state.layers, [type]: { ...state.layers[type], ...patch } },
  };
}

export function toggleLayerVisibility(state: RoofStudioState, type: LayerType): RoofStudioState {
  return setLayer(state, type, { visible: !state.layers[type].visible });
}

export function toggleLayerLock(state: RoofStudioState, type: LayerType): RoofStudioState {
  return setLayer(state, type, { locked: !state.layers[type].locked });
}

/** Generic metadata update (name/visibility). Cannot change lock; always guarded via setLayer. */
export function updateLayer(state: RoofStudioState, type: LayerType, patch: Partial<Omit<LayerState, "locked">>): RoofStudioState {
  return setLayer(state, type, patch);
}

export function renameLayer(state: RoofStudioState, type: LayerType, name: string): RoofStudioState {
  const clean = name.trim() || LAYER_LABELS[type];
  return setLayer(state, type, { name: clean });
}

/** "Delete" a layer clears all objects of that type across planes (boundary/plane wipe planes). */
export function clearLayer(state: RoofStudioState, type: LayerType): RoofStudioState {
  if (!canMutateLayer(state, type)) return state;
  if (type === "plane" || type === "boundary") {
    return { ...state, planes: [], selectedPlaneId: null, selectedObjectId: null };
  }
  const planes = state.planes.map((p) => {
    switch (type) {
      case "obstacle":
        return { ...p, obstacles: [] };
      case "walkway":
        return { ...p, walkways: [] };
      case "parapet":
        return { ...p, parapets: [] };
      case "ridge":
        return { ...p, ridges: [] };
      case "valley":
        return { ...p, valleys: [] };
      default:
        return p;
    }
  });
  return { ...state, planes };
}

/** Alias for the audit vocabulary — clears a layer's contents (guarded). */
export function deleteLayerContents(state: RoofStudioState, type: LayerType): RoofStudioState {
  return clearLayer(state, type);
}

export function isLayerVisible(state: RoofStudioState, type: LayerType): boolean {
  return state.layers[type]?.visible ?? true;
}

export function isLayerLocked(state: RoofStudioState, type: LayerType): boolean {
  return state.layers[type]?.locked ?? false;
}

/** Plane geometry (boundary + vertices + plane props) is governed by both layers. */
export function planeGeometryLocked(state: RoofStudioState): boolean {
  return isLayerLocked(state, "plane") || isLayerLocked(state, "boundary");
}

/**
 * THE central lock guard. Every state-mutating export routes its decision through
 * this one function — there is no other place lock logic is implemented.
 *
 * Fail-closed: returns `true` (mutable) only when none of the governing layers are
 * locked. Plane geometry ("plane"/"boundary") is governed by BOTH layers.
 */
export function canMutateLayer(state: RoofStudioState, layer: LayerType | LayerType[]): boolean {
  const layers = Array.isArray(layer) ? layer : [layer];
  return layers.every((l) => (l === "plane" || l === "boundary" ? !planeGeometryLocked(state) : !isLayerLocked(state, l)));
}

/** Maps a StudioPlane patch key to the layer whose lock governs it. */
const PATCH_KEY_LAYER: Record<string, LayerType> = {
  boundary: "plane",
  name: "plane",
  pitchDeg: "plane",
  azimuthDeg: "plane",
  panelMountOrientation: "plane",
  obstacles: "obstacle",
  walkways: "walkway",
  parapets: "parapet",
  ridges: "ridge",
  valleys: "valley",
};

/** Layers a given plane patch touches (boundary edits also engage the boundary layer). */
export function layersForPlanePatch(patch: Partial<StudioPlane>): LayerType[] {
  const set = new Set<LayerType>();
  for (const key of Object.keys(patch)) {
    const layer = PATCH_KEY_LAYER[key];
    if (layer) set.add(layer);
    if (key === "boundary") set.add("boundary");
  }
  return [...set];
}

/** True when any layer touched by the patch is locked (fail-closed) — via the central guard. */
export function planePatchBlocked(state: RoofStudioState, patch: Partial<StudioPlane>): boolean {
  return !canMutateLayer(state, layersForPlanePatch(patch));
}

/** Convenience: which target layer a drawing tool writes into (for UI lock checks). */
export function layerForTool(tool: ToolMode): LayerType | null {
  switch (tool) {
    case "plane":
      return "plane";
    case "obstacle-rect":
    case "obstacle-circle":
    case "obstacle-polygon":
      return "obstacle";
    case "walkway":
      return "walkway";
    case "parapet":
      return "parapet";
    case "ridge":
      return "ridge";
    case "valley":
      return "valley";
    case "panel-place":
      return "panels";
    case "structure-h-beam":
    case "structure-c-channel":
    case "structure-column":
    case "structure-foundation":
      return "structure";
    case "dimension-line":
      return "measurements";
    default:
      return null;
  }
}

/* ---------------------------------------------------------------------------
 * Engine mapping + analysis
 * ------------------------------------------------------------------------- */

function obstacleToDef(o: StudioObstacle): ObstacleDef {
  return {
    id: o.id,
    polygon: o.vertices,
    heightM: o.heightM,
    setbackM: o.clearanceM,
  };
}

function walkwayToDef(w: StudioWalkway): MaintenanceWalkwayDef {
  return { id: w.id, polygon: w.vertices, widthM: w.widthM };
}

function parapetToDef(p: StudioParapet): ParapetDef {
  return { id: p.id, strip: p.vertices, heightM: p.heightM, thicknessM: p.thicknessM };
}

function ridgeToDef(r: StudioLine): RidgeDef {
  return { id: r.id, start: r.start, end: r.end };
}

function valleyToDef(v: StudioLine): ValleyDef {
  return { id: v.id, start: v.start, end: v.end };
}

export function planeToInput(plane: StudioPlane): RoofPlaneInput {
  return {
    id: plane.id,
    boundary: plane.boundary,
    pitchDeg: plane.pitchDeg,
    azimuthDeg: plane.azimuthDeg,
    obstacles: plane.obstacles.map(obstacleToDef),
    walkways: plane.walkways.map(walkwayToDef),
    parapets: plane.parapets.map(parapetToDef),
    ridges: plane.ridges.map(ridgeToDef),
    valleys: plane.valleys.map(valleyToDef),
  };
}

/** Planes with a closed boundary (>= 3 vertices) are "complete" and analyzable. */
export function isPlaneComplete(plane: StudioPlane): boolean {
  return plane.boundary.length >= 3;
}

export function toRoofSiteInput(state: RoofStudioState): RoofSiteInput {
  return {
    siteId: state.siteId,
    metersPerUnit: state.metersPerUnit,
    northAzimuthDeg: state.northAzimuthDeg,
    planes: state.planes.filter(isPlaneComplete).map(planeToInput),
  };
}

function statisticsFromMetrics(metrics: RoofSiteMetrics, scaleCalibrated: boolean): RoofStudioStatistics {
  const obstacleAreaM2 = metrics.planes.reduce((s, p) => s + p.obstacleAreaM2, 0);
  const grossAreaM2 = metrics.totalPlanAreaM2;
  const usableAreaM2 = metrics.totalNetUsableAreaM2;
  const obstaclePercent = grossAreaM2 > 0 ? Math.round((obstacleAreaM2 / grossAreaM2) * 1000) / 10 : 0;
  const panelEstimate =
    scaleCalibrated && usableAreaM2 > 0 ? Math.floor(usableAreaM2 / PANEL_AREA_M2) : 0;
  const capacityKw = scaleCalibrated ? panelCapacityEstimateKw(usableAreaM2, PANEL_AREA_M2, PANEL_WATTAGE) : 0;
  const warnings: string[] = [];
  if (!scaleCalibrated) warnings.push("Calibrate scale before panel capacity estimates.");
  if (usableAreaM2 <= 0) warnings.push("No usable PV area after setbacks and obstacles.");
  if (obstaclePercent > 40) warnings.push("Obstacles cover more than 40% of roof area.");
  return {
    planeCount: metrics.planeCount,
    grossAreaM2: Math.round(grossAreaM2 * 100) / 100,
    trueAreaM2: Math.round(metrics.totalTrueAreaM2 * 100) / 100,
    usableAreaM2: Math.round(usableAreaM2 * 100) / 100,
    obstacleAreaM2: Math.round(obstacleAreaM2 * 100) / 100,
    obstaclePercent,
    panelEstimate,
    capacityKw,
    warnings,
  };
}

/**
 * Live analysis. Returns engine metrics/statistics for complete planes, or a
 * structured error (e.g. self-intersection) surfaced from the engine. Never throws.
 */
export function analyzeStudio(state: RoofStudioState): RoofStudioAnalysis {
  const completePlanes = state.planes.filter(isPlaneComplete);
  if (completePlanes.length === 0) {
    return { ok: true, hasCompletePlane: false, metrics: null, statistics: null, error: null };
  }

  const input = toRoofSiteInput(state);
  const scaleOk = isScaleCalibrated(state.scaleCalibration, state.metersPerUnit);

  if (!scaleOk) {
    try {
      validateRoofSiteStrict({ ...input, metersPerUnit: undefined });
      return { ok: true, hasCompletePlane: true, metrics: null, statistics: null, error: null };
    } catch (e) {
      return studioGeometryErrorResult(e);
    }
  }

  try {
    const metrics = analyzeRoofSite(input);
    return {
      ok: true,
      hasCompletePlane: true,
      metrics,
      statistics: statisticsFromMetrics(metrics, true),
      error: null,
    };
  } catch (e) {
    return studioGeometryErrorResult(e);
  }
}

function studioGeometryErrorResult(e: unknown): RoofStudioAnalysis {
  if (e instanceof InvalidRoofBoundaryError) {
    return {
      ok: false,
      hasCompletePlane: true,
      metrics: null,
      statistics: null,
      error: {
        errorCode: e.errorCode,
        message: e.message,
        planeId: e.planeId,
        edgeIndexes: e.edgeIndexes,
        intersectionPoint: e.intersectionPoint,
      },
    };
  }
  if (e instanceof RoofGeometryError) {
    return {
      ok: false,
      hasCompletePlane: true,
      metrics: null,
      statistics: null,
      error: { errorCode: e.code, message: e.message },
    };
  }
  return {
    ok: false,
    hasCompletePlane: true,
    metrics: null,
    statistics: null,
    error: { errorCode: "UNKNOWN", message: e instanceof Error ? e.message : "Unknown geometry error." },
  };
}

/** Per-plane self-intersection check for live vertex-drag feedback (engine primitive). */
export function planeSelfIntersects(plane: StudioPlane): boolean {
  if (plane.boundary.length < 4) return false;
  return detectPolygonSelfIntersections(plane.boundary).length > 0;
}

/** Obstacle clearance footprint polygon for preview overlay (engine primitive). */
export function obstacleClearancePreview(
  plane: StudioPlane,
  obstacle: StudioObstacle,
  metersPerUnit: number
): Point2D[] {
  const normalized = normalizeObstacles([obstacleToDef(obstacle)], plane.boundary);
  if (normalized.length === 0) return obstacle.vertices;
  return obstacleFootprintWithClearance(normalized[0], obstacle.clearanceM, requireValidScale(metersPerUnit));
}

/** Plane perimeter in meters, delegated to the engine. */
export function planePerimeterM(plane: StudioPlane, metersPerUnit: number): number {
  return lengthM(polygonPerimeter(plane.boundary), requireValidScale(metersPerUnit));
}

/* ---------------------------------------------------------------------------
 * Plane mutation helpers
 * ------------------------------------------------------------------------- */

export function addPlane(state: RoofStudioState, boundary: Point2D[], opts?: { pitchDeg?: number; azimuthDeg?: number }): RoofStudioState {
  if (!canMutateLayer(state, "plane")) return state;
  const id = nextStudioId("plane");
  const plane: StudioPlane = {
    id,
    name: `Roof Plane ${state.planes.length + 1}`,
    boundary,
    pitchDeg: opts?.pitchDeg ?? 10,
    azimuthDeg: opts?.azimuthDeg ?? 180,
    obstacles: [],
    walkways: [],
    parapets: [],
    ridges: [],
    valleys: [],
  };
  return { ...state, planes: [...state.planes, plane], selectedPlaneId: id, selectedObjectId: null };
}

export function updatePlane(state: RoofStudioState, planeId: string, patch: Partial<StudioPlane>): RoofStudioState {
  if (!canMutateLayer(state, layersForPlanePatch(patch))) return state;
  return {
    ...state,
    planes: state.planes.map((p) => (p.id === planeId ? { ...p, ...patch } : p)),
  };
}

export function removePlane(state: RoofStudioState, planeId: string): RoofStudioState {
  if (!canMutateLayer(state, "plane")) return state;
  const planes = state.planes.filter((p) => p.id !== planeId);
  return {
    ...state,
    planes,
    selectedPlaneId: state.selectedPlaneId === planeId ? null : state.selectedPlaneId,
  };
}

export function getSelectedPlane(state: RoofStudioState): StudioPlane | null {
  return state.planes.find((p) => p.id === state.selectedPlaneId) ?? null;
}

/* ---------------------------------------------------------------------------
 * Central plane-collection mutator — the single path for all feature CRUD and
 * vertex edits. Every helper below funnels through `canMutateLayer` here.
 * ------------------------------------------------------------------------- */

function mutatePlaneCollection(
  state: RoofStudioState,
  planeId: string,
  layer: LayerType,
  updater: (plane: StudioPlane) => Partial<StudioPlane>
): RoofStudioState {
  if (!canMutateLayer(state, layer)) return state;
  const plane = state.planes.find((p) => p.id === planeId);
  if (!plane) return state;
  return {
    ...state,
    planes: state.planes.map((p) => (p.id === planeId ? { ...p, ...updater(p) } : p)),
  };
}

/* ---- boundary vertex edits (governed by the plane layer) ---- */

export function moveBoundaryVertex(state: RoofStudioState, planeId: string, index: number, point: Point2D): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "plane", (p) => ({ boundary: moveVertex(p.boundary, index, point) }));
}

export function insertBoundaryVertex(state: RoofStudioState, planeId: string, edgeIndex: number, point: Point2D): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "plane", (p) => ({ boundary: insertVertex(p.boundary, edgeIndex, point) }));
}

export function deleteBoundaryVertex(state: RoofStudioState, planeId: string, index: number): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "plane", (p) => ({ boundary: deleteVertex(p.boundary, index) }));
}

/* ---- obstacles ---- */

export function addObstacle(state: RoofStudioState, planeId: string, obstacle: StudioObstacle): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "obstacle", (p) => ({ obstacles: [...p.obstacles, obstacle] }));
}

export function updateObstacle(state: RoofStudioState, planeId: string, obstacleId: string, patch: Partial<StudioObstacle>): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "obstacle", (p) => ({
    obstacles: p.obstacles.map((o) => (o.id === obstacleId ? { ...o, ...patch } : o)),
  }));
}

export function deleteObstacle(state: RoofStudioState, planeId: string, obstacleId: string): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "obstacle", (p) => ({ obstacles: p.obstacles.filter((o) => o.id !== obstacleId) }));
}

/* ---- walkways ---- */

export function addWalkway(state: RoofStudioState, planeId: string, walkway: StudioWalkway): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "walkway", (p) => ({ walkways: [...p.walkways, walkway] }));
}

export function updateWalkway(state: RoofStudioState, planeId: string, walkwayId: string, patch: Partial<StudioWalkway>): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "walkway", (p) => ({
    walkways: p.walkways.map((w) => (w.id === walkwayId ? { ...w, ...patch } : w)),
  }));
}

export function deleteWalkway(state: RoofStudioState, planeId: string, walkwayId: string): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "walkway", (p) => ({ walkways: p.walkways.filter((w) => w.id !== walkwayId) }));
}

/* ---- parapets ---- */

export function addParapet(state: RoofStudioState, planeId: string, parapet: StudioParapet): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "parapet", (p) => ({ parapets: [...p.parapets, parapet] }));
}

export function updateParapet(state: RoofStudioState, planeId: string, parapetId: string, patch: Partial<StudioParapet>): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "parapet", (p) => ({
    parapets: p.parapets.map((pp) => (pp.id === parapetId ? { ...pp, ...patch } : pp)),
  }));
}

export function deleteParapet(state: RoofStudioState, planeId: string, parapetId: string): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "parapet", (p) => ({ parapets: p.parapets.filter((pp) => pp.id !== parapetId) }));
}

/* ---- ridges ---- */

export function addRidge(state: RoofStudioState, planeId: string, ridge: StudioLine): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "ridge", (p) => ({ ridges: [...p.ridges, ridge] }));
}

export function updateRidge(state: RoofStudioState, planeId: string, ridgeId: string, patch: Partial<StudioLine>): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "ridge", (p) => ({
    ridges: p.ridges.map((r) => (r.id === ridgeId ? { ...r, ...patch } : r)),
  }));
}

export function deleteRidge(state: RoofStudioState, planeId: string, ridgeId: string): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "ridge", (p) => ({ ridges: p.ridges.filter((r) => r.id !== ridgeId) }));
}

/* ---- valleys ---- */

export function addValley(state: RoofStudioState, planeId: string, valley: StudioLine): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "valley", (p) => ({ valleys: [...p.valleys, valley] }));
}

export function updateValley(state: RoofStudioState, planeId: string, valleyId: string, patch: Partial<StudioLine>): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "valley", (p) => ({
    valleys: p.valleys.map((v) => (v.id === valleyId ? { ...v, ...patch } : v)),
  }));
}

export function deleteValley(state: RoofStudioState, planeId: string, valleyId: string): RoofStudioState {
  return mutatePlaneCollection(state, planeId, "valley", (p) => ({ valleys: p.valleys.filter((v) => v.id !== valleyId) }));
}

/* ---------------------------------------------------------------------------
 * Local background image (Google Earth / rooftop screenshot).
 *
 * The image never leaves the browser: it is held only as an in-memory object
 * URL. The manager owns the object-URL lifecycle and guarantees the previous
 * URL is revoked whenever a new image is set or the image is cleared, so no
 * blob leaks. The object-URL adapter is injectable so this logic is unit
 * testable in Node (no DOM required) and never performs network/DB/AI calls.
 * ------------------------------------------------------------------------- */

export const SUPPORTED_ROOF_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function isSupportedRoofImageType(mimeType: unknown): boolean {
  return typeof mimeType === "string" && (SUPPORTED_ROOF_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

export interface RoofObjectUrlAdapter {
  create: (blob: unknown) => string;
  revoke: (url: string) => void;
}

/** Adapter backed by the browser URL API; falls back to a no-op off-DOM. */
export function browserObjectUrlAdapter(): RoofObjectUrlAdapter {
  const urlApi = typeof URL !== "undefined" ? URL : undefined;
  return {
    create: (blob) =>
      urlApi && typeof urlApi.createObjectURL === "function"
        ? urlApi.createObjectURL(blob as Blob)
        : "",
    revoke: (url) => {
      if (urlApi && typeof urlApi.revokeObjectURL === "function" && url) urlApi.revokeObjectURL(url);
    },
  };
}

export interface RoofBackgroundImage {
  url: string;
  fileName: string;
}

export interface RoofBackgroundImageManager {
  set(file: unknown, fileName: string): RoofBackgroundImage | null;
  clear(): void;
  get(): RoofBackgroundImage | null;
  /** Diagnostics for tests: total object URLs revoked over the lifetime. */
  revokedCount(): number;
}

/**
 * Creates a background-image manager. Setting a new image or clearing always
 * revokes the previously held object URL first (revoke-before-replace), which
 * is the invariant the "object URL revoked" test asserts.
 */
export function createRoofBackgroundImageManager(
  adapter: RoofObjectUrlAdapter = browserObjectUrlAdapter()
): RoofBackgroundImageManager {
  let current: RoofBackgroundImage | null = null;
  let revoked = 0;

  const revokeCurrent = () => {
    if (current) {
      adapter.revoke(current.url);
      revoked += 1;
      current = null;
    }
  };

  return {
    set(file, fileName) {
      revokeCurrent();
      const url = adapter.create(file);
      if (!url) return null;
      current = { url, fileName: fileName || "rooftop-image" };
      return current;
    },
    clear() {
      revokeCurrent();
    },
    get() {
      return current;
    },
    revokedCount() {
      return revoked;
    },
  };
}
