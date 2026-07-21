/**
 * Roof extraction versioning — true append-only, immutable history.
 *
 * Model:
 * - Every call to append / accept / reject / correct pushes a NEW record.
 * - Existing records are never rewritten (byte-for-byte stable).
 * - accept/reject/correct are status-transition records that reference
 *   parentVersion; the parent record's status field is never changed.
 * - Effective activity is derived: a proposed/corrected version is inactive
 *   once a later accepted|rejected|corrected|superseded child references it.
 *
 * Public reads return deep-cloned, deeply-frozen copies.
 * append() validates polygons (finite, ≥3 verts, no self-intersection) first.
 */

import { hasPolygonSelfIntersection } from "../roof/RoofPolygon.ts";
import { isFiniteNumber } from "../roof/RoofModels.ts";
import type { Point2D } from "../roof/RoofModels.ts";
import {
  VISION_ENGINE_TIMESTAMP,
  VisionPipelineError,
  type ExtractedPolygon,
  type RoofExtractionSuggestion,
  type RoofSuggestionSource,
  type RoofSuggestionStatus,
} from "./VisionModels.ts";

export interface AppendSuggestionInput {
  source: RoofSuggestionSource;
  polygons: ExtractedPolygon[];
  note: string;
  status?: RoofSuggestionStatus;
  /** Parent version to branch from. Defaults to the current head. */
  parentVersion?: number;
}

export interface RoofExtractionVersionStoreOptions {
  suggestionIdPrefix?: string;
  now?: () => string;
}

const CLOSING_STATUSES: ReadonlySet<RoofSuggestionStatus> = new Set([
  "accepted",
  "rejected",
  "corrected",
  "superseded",
]);

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

/** Recursively assert every number in a public result is finite. */
export function assertFiniteVisionResult(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new VisionPipelineError(
        "NON_FINITE_VISION_RESULT",
        `${path} must be finite (got ${String(value)}).`
      );
    }
    return;
  }
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteVisionResult(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertFiniteVisionResult(child, `${path}.${key}`);
    }
  }
}

function assertFiniteVertexCoordinate(value: unknown, path: string): asserts value is number {
  if (value === null || value === undefined) {
    throw new VisionPipelineError("INVALID_POLYGON_VERTEX", `${path} must be a number (got ${String(value)}).`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VisionPipelineError("INVALID_POLYGON_VERTEX", `${path} must be a finite number (got ${String(value)}).`);
  }
}

/** Fail-closed polygon validation before any history append. */
export function validatePolygonsForVersionAppend(polygons: ExtractedPolygon[]): ExtractedPolygon[] {
  if (!Array.isArray(polygons)) {
    throw new VisionPipelineError("INVALID_EDIT", "polygons must be an array.");
  }
  const validated: ExtractedPolygon[] = [];
  for (let pi = 0; pi < polygons.length; pi += 1) {
    const poly = polygons[pi];
    if (!poly || typeof poly !== "object") {
      throw new VisionPipelineError("INVALID_EDIT", `polygons[${pi}] must be an object.`);
    }
    if (!Array.isArray(poly.verticesPx)) {
      throw new VisionPipelineError("INVALID_POLYGON_VERTEX", `polygons[${pi}].verticesPx must be an array.`);
    }
    if (poly.verticesPx.length < 3) {
      throw new VisionPipelineError(
        "INSUFFICIENT_VERTICES",
        `polygons[${pi}] requires at least 3 vertices.`
      );
    }
    const verts: Point2D[] = [];
    for (let vi = 0; vi < poly.verticesPx.length; vi += 1) {
      const v = poly.verticesPx[vi];
      if (!v || typeof v !== "object") {
        throw new VisionPipelineError(
          "INVALID_POLYGON_VERTEX",
          `polygons[${pi}].verticesPx[${vi}] must be an object with x and y.`
        );
      }
      assertFiniteVertexCoordinate(v.x, `polygons[${pi}].verticesPx[${vi}].x`);
      assertFiniteVertexCoordinate(v.y, `polygons[${pi}].verticesPx[${vi}].y`);
      verts.push({ x: v.x, y: v.y });
    }
    if (hasPolygonSelfIntersection(verts)) {
      throw new VisionPipelineError(
        "SELF_INTERSECTING_SUGGESTION",
        `polygons[${pi}] self-intersects and cannot enter version history.`
      );
    }
    if (!isFiniteNumber(poly.confidence) || poly.confidence < 0 || poly.confidence > 1) {
      throw new VisionPipelineError(
        "INVALID_EDIT",
        `polygons[${pi}].confidence must be a finite number in [0, 1].`
      );
    }
    if (poly.boundsPx) {
      assertFiniteVisionResult(poly.boundsPx, `polygons[${pi}].boundsPx`);
    }
    if (!isFiniteNumber(poly.areaPx2)) {
      throw new VisionPipelineError("INVALID_EDIT", `polygons[${pi}].areaPx2 must be finite.`);
    }
    validated.push({
      ...poly,
      verticesPx: verts,
      boundsPx: poly.boundsPx
        ? { ...poly.boundsPx }
        : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
    });
  }
  return validated;
}

function publish<T>(value: T): T {
  assertFiniteVisionResult(value);
  return deepFreeze(deepClone(value));
}

/** Append-only version chain for a single image's extraction session. */
export class RoofExtractionVersionStore {
  private readonly imageId: string;
  /** Internal sealed records — never mutated after push. */
  private readonly versions: Readonly<RoofExtractionSuggestion>[] = [];
  private readonly prefix: string;
  private readonly now: () => string;

  constructor(imageId: string, options: RoofExtractionVersionStoreOptions = {}) {
    if (!imageId || !imageId.trim()) {
      throw new VisionPipelineError("INVALID_IMAGE_ID", "imageId is required for a version store.");
    }
    this.imageId = imageId;
    this.prefix = options.suggestionIdPrefix ?? "roofsug";
    this.now = options.now ?? (() => VISION_ENGINE_TIMESTAMP);
  }

  /** Append a new immutable version and return a frozen defensive copy. */
  append(input: AppendSuggestionInput): RoofExtractionSuggestion {
    const version = this.versions.length + 1;
    const parentVersion = input.parentVersion ?? (this.versions.length > 0 ? this.versions.length : null);

    if (parentVersion !== null && (parentVersion < 1 || parentVersion > this.versions.length)) {
      throw new VisionPipelineError("INVALID_PARENT_VERSION", `Parent version ${parentVersion} does not exist.`);
    }

    const polygons = validatePolygonsForVersionAppend(input.polygons);
    const status = input.status ?? "proposed";

    const suggestion: RoofExtractionSuggestion = {
      suggestionId: `${this.prefix}-${this.imageId}-v${version}`,
      version,
      parentVersion,
      source: input.source,
      status,
      createdAt: this.now(),
      imageId: this.imageId,
      polygons,
      note: input.note,
    };

    assertFiniteVisionResult(suggestion, "suggestion");
    const sealed = deepFreeze(deepClone(suggestion));
    this.versions.push(sealed);
    return publish(sealed);
  }

  /**
   * Append a corrected version. Parent record is left unchanged;
   * relation is expressed via parentVersion on the new record.
   */
  correct(polygons: ExtractedPolygon[], note: string, parentVersion?: number): RoofExtractionSuggestion {
    const parent = parentVersion ?? this.versions.length;
    this.requireVersion(parent);
    if (!this.isActive(parent)) {
      throw new VisionPipelineError(
        "SUGGESTION_NOT_ACTIVE",
        `Version ${parent} is not active and cannot be corrected.`
      );
    }
    return this.append({
      source: "manual",
      polygons,
      note,
      status: "corrected",
      parentVersion: parent,
    });
  }

  /** Append an accepted transition record. Does not mutate the target. */
  accept(version: number): RoofExtractionSuggestion {
    const target = this.requireVersion(version);
    if (!this.isActive(version)) {
      throw new VisionPipelineError(
        "SUGGESTION_NOT_ACTIVE",
        `Version ${version} is not active and cannot be accepted.`
      );
    }
    return this.append({
      source: "manual",
      polygons: deepClone(target.polygons) as ExtractedPolygon[],
      note: `Accepted version ${version}.`,
      status: "accepted",
      parentVersion: version,
    });
  }

  /** Append a rejected transition record. Does not mutate the target. */
  reject(version: number): RoofExtractionSuggestion {
    const target = this.requireVersion(version);
    if (!this.isActive(version)) {
      throw new VisionPipelineError(
        "SUGGESTION_NOT_ACTIVE",
        `Version ${version} is not active and cannot be rejected.`
      );
    }
    return this.append({
      source: "manual",
      polygons: deepClone(target.polygons) as ExtractedPolygon[],
      note: `Rejected version ${version}.`,
      status: "rejected",
      parentVersion: version,
    });
  }

  /** True when version is proposed/corrected and has no closing child transition. */
  isActive(version: number): boolean {
    const record = this.versions[version - 1];
    if (!record) return false;
    if (record.status !== "proposed" && record.status !== "corrected") return false;
    return !this.hasClosingChild(version);
  }

  private hasClosingChild(version: number): boolean {
    return this.versions.some(
      (r) => r.parentVersion === version && CLOSING_STATUSES.has(r.status)
    );
  }

  private requireVersion(version: number): RoofExtractionSuggestion {
    if (version < 1 || version > this.versions.length) {
      throw new VisionPipelineError("SUGGESTION_NOT_FOUND", `Version ${version} does not exist.`);
    }
    return this.versions[version - 1];
  }

  head(): RoofExtractionSuggestion | null {
    if (this.versions.length === 0) return null;
    return publish(this.versions[this.versions.length - 1]);
  }

  /** Active content suggestions: proposed/corrected with no closing child. */
  current(): RoofExtractionSuggestion[] {
    return this.versions.filter((v) => this.isActive(v.version)).map((v) => publish(v));
  }

  get(version: number): RoofExtractionSuggestion | null {
    if (version < 1 || version > this.versions.length) return null;
    return publish(this.versions[version - 1]);
  }

  history(): RoofExtractionSuggestion[] {
    return this.versions.map((v) => publish(v));
  }

  list(): RoofExtractionSuggestion[] {
    return this.history();
  }

  size(): number {
    return this.versions.length;
  }
}

export function createRoofExtractionVersionStore(
  imageId: string,
  options?: RoofExtractionVersionStoreOptions
): RoofExtractionVersionStore {
  return new RoofExtractionVersionStore(imageId, options);
}
