/**
 * Roof Intelligence — Phase 3A (AI-assisted roof extraction).
 *
 * Shared models for the vision pipeline. Pure TypeScript. Deterministic.
 * No cloud dependency, no backend mutation, no persistence, no UI.
 *
 * Geometry primitives (Point2D, RoofBounds2D, RoofPolygonDef, RoofPlaneInput,
 * RoofSiteInput) are RE-USED from the existing Roof Geometry Engine — this
 * module never re-declares them. AI outputs are designed to convert into
 * those objects (see RoofGeometryConversion.ts).
 */

import type { Point2D, RoofBounds2D } from "../roof/RoofModels.ts";
import { VisionPipelineError } from "./VisionErrors.ts";

export { VisionPipelineError, RoofVisionProviderNotConfiguredError } from "./VisionErrors.ts";
export type { VisionErrorCode } from "./VisionErrors.ts";

export const VISION_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/** Provider families the segmentation abstraction can plug in. */
export const VISION_PROVIDER_KINDS = ["fixture", "sam", "yolo", "opencv", "cloud"] as const;
export type VisionProviderKind = (typeof VISION_PROVIDER_KINDS)[number];

const VISION_PROVIDER_KIND_SET = new Set<string>(VISION_PROVIDER_KINDS);
export function isVisionProviderKind(value: string): value is VisionProviderKind {
  return VISION_PROVIDER_KIND_SET.has(value);
}

/** Where an extracted suggestion or a correction came from. */
export const ROOF_SUGGESTION_SOURCES = ["ai", "manual"] as const;
export type RoofSuggestionSource = (typeof ROOF_SUGGESTION_SOURCES)[number];

/** Lifecycle of a versioned suggestion. Correction supersedes the prior version. */
export const ROOF_SUGGESTION_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "superseded",
  "corrected",
] as const;
export type RoofSuggestionStatus = (typeof ROOF_SUGGESTION_STATUSES)[number];

/** Polygon role in the extraction (maps to plane boundary vs obstacle). */
export const EXTRACTED_POLYGON_KINDS = ["roof", "obstacle"] as const;
export type ExtractedPolygonKind = (typeof EXTRACTED_POLYGON_KINDS)[number];

/**
 * Reference to an uploaded satellite image. The pixel bytes are intentionally
 * NOT modeled here — V1 works from image metadata + a checksum so the pipeline
 * stays deterministic and free of decode/cloud dependencies.
 */
export interface SatelliteImageRef {
  imageId: string;
  widthPx: number;
  heightPx: number;
  /** Ground sampling distance — meters per pixel. Enables later scale conversion. */
  metersPerPixel: number;
  /** Deterministic content hash of the source bytes (caller-supplied). */
  checksum: string;
  /** Optional capture metadata; never rendered, only echoed. */
  capturedAt?: string;
  northAzimuthDeg?: number;
}

/** One segmented region as returned by a provider (pixel space). */
export interface SegmentationRegion {
  regionId: string;
  /** Coarse boundary in pixel coordinates. */
  contourPx: Point2D[];
  /** Model confidence for this region, in [0, 1]. */
  confidence: number;
  /** Provider-specific class label, e.g. "roof", "obstacle". */
  label: string;
}

/** Full provider output for one image. */
export interface SegmentationResult {
  imageId: string;
  providerKind: VisionProviderKind;
  providerVersion: string;
  regions: SegmentationRegion[];
  /** Optional per-cell confidence field the provider may emit (pixel grid). */
  confidenceField?: ConfidenceField;
}

/** A coarse confidence field over the image, cell-averaged. */
export interface ConfidenceField {
  cellSizePx: number;
  cols: number;
  rows: number;
  /** Row-major values in [0, 1], length === cols * rows. */
  values: number[];
}

/** One editable CAD polygon extracted from a segmentation region. */
export interface ExtractedPolygon {
  polygonId: string;
  regionId: string;
  kind: ExtractedPolygonKind;
  /** Simplified, validated boundary in pixel coordinates. */
  verticesPx: Point2D[];
  confidence: number;
  label: string;
  boundsPx: RoofBounds2D;
  areaPx2: number;
}

/** Confidence heatmap cell derived from the segmentation + polygons. */
export interface ConfidenceHeatmapCell {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Aggregate confidence in [0, 1]. */
  value: number;
}

export interface ConfidenceHeatmap {
  cellSizePx: number;
  cols: number;
  rows: number;
  cells: ConfidenceHeatmapCell[];
  /** Mean confidence across covered cells, in [0, 1]. */
  meanConfidence: number;
}

/**
 * A single versioned AI/manual suggestion. Every suggestion — the initial AI
 * extraction and every manual correction — is an immutable version in a chain.
 */
export interface RoofExtractionSuggestion {
  suggestionId: string;
  version: number;
  parentVersion: number | null;
  source: RoofSuggestionSource;
  status: RoofSuggestionStatus;
  createdAt: string;
  imageId: string;
  polygons: ExtractedPolygon[];
  /** Human-readable note describing what produced this version. */
  note: string;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function polygonKindFromLabel(label: string): ExtractedPolygonKind {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("obstacle") || normalized.includes("obstruction")) return "obstacle";
  return "roof";
}

export function assertFiniteVertices(vertices: Point2D[], context: string): void {
  for (let i = 0; i < vertices.length; i += 1) {
    const v = vertices[i];
    if (!isFiniteNumber(v?.x) || !isFiniteNumber(v?.y)) {
      throw new VisionPipelineError("INVALID_EDIT", `${context}: vertex[${i}] must be finite.`);
    }
  }
}
