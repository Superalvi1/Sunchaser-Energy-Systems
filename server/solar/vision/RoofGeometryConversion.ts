/**
 * Roof geometry conversion — the bridge from vision output to the existing
 * Roof Geometry Engine objects.
 *
 * Accept into CAD is fail-closed and goes through injected studio mutations
 * (addPlane / addObstacle) — vision never mutates CAD directly and never
 * duplicates polygon math (uses engine hasPolygonSelfIntersection / filterFiniteVertices).
 *
 * Phase 3A stops at geometry: no production estimate, no panel placement.
 */

import { assertValidRoofSite } from "../roof/RoofValidation.ts";
import { hasPolygonSelfIntersection, filterFiniteVertices } from "../roof/RoofPolygon.ts";
import type {
  Point2D,
  RoofPlaneInput,
  RoofPolygonDef,
  RoofSiteInput,
} from "../roof/RoofModels.ts";
import {
  VisionPipelineError,
  type ExtractedPolygon,
  type RoofExtractionSuggestion,
  type SatelliteImageRef,
} from "./VisionModels.ts";
import type { RoofExtractionVersionStore } from "./RoofExtractionVersioning.ts";

/** Per-plane roof attributes the vision layer cannot infer (pitch/azimuth). */
export interface PlaneAttributeDefaults {
  /** Roof pitch in degrees. Defaults to 0 (flat) — no slope inferred from imagery in V1. */
  pitchDeg?: number;
  /** Roof azimuth in degrees. Defaults to 180 (south) as a neutral placeholder. */
  azimuthDeg?: number;
}

export interface RoofGeometryConversionOptions extends PlaneAttributeDefaults {
  /** Per-polygon overrides keyed by polygonId. */
  perPolygon?: Record<string, PlaneAttributeDefaults>;
}

/** Studio mutation ports — implemented by roofStudioClient in the UI layer. */
export interface StudioAcceptMutations<TState> {
  addPlane: (state: TState, boundary: Point2D[], opts?: { pitchDeg?: number; azimuthDeg?: number }) => TState;
  addObstacle: (
    state: TState,
    planeId: string,
    obstacle: {
      id: string;
      name: string;
      shape: "polygon";
      vertices: Point2D[];
      rotationDeg: number;
      heightM: number;
      clearanceM: number;
    }
  ) => TState;
  nextObstacleId: () => string;
  getSelectedOrLastPlaneId: (state: TState) => string | null;
}

export type AcceptSuggestionResult<TState> =
  | { ok: true; state: TState }
  | { ok: false; error: string; code: string; state: TState };

/** Convert one extracted polygon to a RoofPolygonDef (pixel coordinates preserved). */
export function toRoofPolygonDef(polygon: ExtractedPolygon): RoofPolygonDef {
  return {
    id: polygon.polygonId,
    vertices: polygon.verticesPx.map((v: Point2D) => ({ x: v.x, y: v.y })),
  };
}

/** Convert one extracted polygon to a RoofPlaneInput. */
export function toRoofPlaneInput(
  polygon: ExtractedPolygon,
  options: RoofGeometryConversionOptions = {}
): RoofPlaneInput {
  const override = options.perPolygon?.[polygon.polygonId] ?? {};
  return {
    id: polygon.polygonId,
    boundary: polygon.verticesPx.map((v: Point2D) => ({ x: v.x, y: v.y })),
    pitchDeg: override.pitchDeg ?? options.pitchDeg ?? 0,
    azimuthDeg: override.azimuthDeg ?? options.azimuthDeg ?? 180,
  };
}

/**
 * Convert a full extracted polygon set to a validated RoofSiteInput. The
 * pixel→meter scale is carried on metersPerUnit so the engine measures true
 * areas without any conversion math living here.
 */
export function toRoofSiteInput(
  image: SatelliteImageRef,
  polygons: ExtractedPolygon[],
  options: RoofGeometryConversionOptions = {}
): RoofSiteInput {
  const roofPolygons = polygons.filter((p) => p.kind !== "obstacle");
  if (roofPolygons.length === 0) {
    throw new VisionPipelineError("NO_POLYGONS", "Cannot build a roof site from zero roof polygons.");
  }

  const planes = roofPolygons.map((p) => toRoofPlaneInput(p, options));

  const site: RoofSiteInput = {
    siteId: `roofsite-${image.imageId}`,
    planes,
    metersPerUnit: image.metersPerPixel,
    origin: { x: 0, y: 0 },
    northAzimuthDeg: image.northAzimuthDeg ?? 0,
  };

  assertValidRoofSite(site);
  return site;
}

/** Fail-closed validation before any CAD accept. */
export function validateSuggestionPolygon(
  vertices: Point2D[]
): { ok: true; vertices: Point2D[] } | { ok: false; code: string; error: string } {
  const finite = filterFiniteVertices(vertices);
  if (finite.length < 3) {
    return {
      ok: false,
      code: "INSUFFICIENT_VERTICES",
      error: "Suggestion polygon requires at least 3 finite vertices.",
    };
  }
  if (hasPolygonSelfIntersection(finite)) {
    return {
      ok: false,
      code: "SELF_INTERSECTING_SUGGESTION",
      error: "Suggestion polygon self-intersects.",
    };
  }
  return { ok: true, vertices: finite };
}

/**
 * Accept a versioned suggestion into CAD via injected studio mutations only.
 * Invalid polygons leave state unchanged.
 */
export function acceptSuggestionIntoStudio<TState>(
  state: TState,
  suggestion: RoofExtractionSuggestion,
  mutations: StudioAcceptMutations<TState>,
  options: {
    versionStore?: RoofExtractionVersionStore;
    planeDefaults?: PlaneAttributeDefaults;
  } = {}
): AcceptSuggestionResult<TState> {
  if (suggestion.status === "rejected" || suggestion.status === "superseded" || suggestion.status === "accepted") {
    return {
      ok: false,
      code: "SUGGESTION_NOT_ACTIVE",
      error: `Cannot accept suggestion in status "${suggestion.status}".`,
      state,
    };
  }
  if (options.versionStore && !options.versionStore.isActive(suggestion.version)) {
    return {
      ok: false,
      code: "SUGGESTION_NOT_ACTIVE",
      error: `Suggestion version ${suggestion.version} is no longer active in history.`,
      state,
    };
  }

  let next = state;
  const roofPolys = suggestion.polygons.filter((p) => p.kind !== "obstacle");
  const obstaclePolys = suggestion.polygons.filter((p) => p.kind === "obstacle");

  for (const poly of roofPolys) {
    const validated = validateSuggestionPolygon(poly.verticesPx);
    if (!validated.ok) {
      return { ok: false, code: (validated as any).code, error: (validated as any).error, state };
    }
    const before = next;
    next = mutations.addPlane(next, validated.vertices, {
      pitchDeg: options.planeDefaults?.pitchDeg ?? 0,
      azimuthDeg: options.planeDefaults?.azimuthDeg ?? 180,
    });
    if (Object.is(next, before)) {
      return {
        ok: false,
        code: "ACCEPT_REJECTED",
        error: "Studio refused plane mutation (layer locked or unchanged).",
        state,
      };
    }
  }

  if (obstaclePolys.length > 0) {
    const planeId = mutations.getSelectedOrLastPlaneId(next);
    if (!planeId) {
      return {
        ok: false,
        code: "ACCEPT_REJECTED",
        error: "Obstacle suggestions require an existing or newly accepted roof plane.",
        state,
      };
    }
    for (const poly of obstaclePolys) {
      const validated = validateSuggestionPolygon(poly.verticesPx);
      if (!validated.ok) {
        return { ok: false, code: (validated as any).code, error: (validated as any).error, state };
      }
      next = mutations.addObstacle(next, planeId, {
        id: mutations.nextObstacleId(),
        name: poly.label || "AI Obstacle",
        shape: "polygon",
        vertices: validated.vertices,
        rotationDeg: 0,
        heightM: 1,
        clearanceM: 0.3,
      });
    }
  }

  options.versionStore?.accept(suggestion.version);
  return { ok: true, state: next };
}

/** Reject a suggestion: version history updated, CAD state unchanged. */
export function rejectSuggestion<TState>(
  state: TState,
  suggestion: RoofExtractionSuggestion,
  versionStore: RoofExtractionVersionStore
): AcceptSuggestionResult<TState> {
  versionStore.reject(suggestion.version);
  return { ok: true, state };
}
