/**
 * Usable roof area after setbacks, obstacles, parapets, and walkways.
 */

import type { MaintenanceWalkwayDef, Point2D, RoofSetbackConfig } from "./RoofModels.ts";
import { round4 } from "./RoofModels.ts";
import type { NormalizedRoofPlane } from "./RoofPlane.ts";
import { trueAreaFromPlanM2 } from "./RoofPlane.ts";
import {
  normalizeObstacles,
  normalizeParapets,
  totalObstacleAreaUnits,
  totalParapetAreaUnits,
} from "./RoofObstacle.ts";
import {
  normalizeRidges,
  normalizeValleys,
  planAreaM2,
  requireValidMetersPerUnit,
  ridgeSetbackAreaUnits,
  totalRidgeLengthUnits,
  totalValleyLengthUnits,
  valleySetbackAreaUnits,
  lengthM,
} from "./RoofMeasurement.ts";
import { mergeSetbackConfig, effectiveEdgeSetbackM, setbackAreaFromEdgeInset } from "./RoofSetbackRules.ts";
import {
  filterFiniteVertices,
  insetPolygonTowardCentroid,
  overlapAreaPolygons,
  polygonArea,
  polygonPerimeter,
} from "./RoofPolygon.ts";

export interface WalkwayAreaResult {
  walkwayAreaUnits: number;
  walkwayAreaM2: number;
}

export interface UsableAreaBreakdown {
  planAreaM2: number;
  trueAreaM2: number;
  grossUsablePlanM2: number;
  edgeSetbackAreaM2: number;
  ridgeSetbackAreaM2: number;
  valleySetbackAreaM2: number;
  obstacleAreaM2: number;
  parapetAreaM2: number;
  walkwayAreaM2: number;
  netUsablePlanM2: number;
  netUsableTrueM2: number;
}

function normalizeWalkways(raw: unknown): MaintenanceWalkwayDef[] {
  if (!Array.isArray(raw)) return [];
  const out: MaintenanceWalkwayDef[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i];
    if (!w || typeof w !== "object") continue;
    const poly = filterFiniteVertices((w as MaintenanceWalkwayDef).polygon);
    if (poly.length < 3) continue;
    out.push({
      id: (w as MaintenanceWalkwayDef).id || `walk-${i}`,
      polygon: poly,
      widthM: Math.max(0.3, Number((w as MaintenanceWalkwayDef).widthM) || 0.6),
    });
  }
  return out;
}

export function walkwayAreaOnPlane(
  walkways: MaintenanceWalkwayDef[],
  planeBoundary: Point2D[],
  metersPerUnit: number
): WalkwayAreaResult {
  let units = 0;
  for (const w of walkways) {
    units += overlapAreaPolygons(w.polygon, planeBoundary);
  }
  return {
    walkwayAreaUnits: units,
    walkwayAreaM2: round4(units * metersPerUnit * metersPerUnit),
  };
}

export function computeUsableArea(
  plane: NormalizedRoofPlane,
  metersPerUnit: number,
  setbacks?: Partial<RoofSetbackConfig>
): UsableAreaBreakdown {
  const config = mergeSetbackConfig(setbacks ?? plane.setbacks);
  const mpu = requireValidMetersPerUnit(metersPerUnit);
  const planM2 = planAreaM2(plane.boundary, mpu);
  const trueM2 = trueAreaFromPlanM2(planM2, plane.pitchDeg);
  const perimeter = lengthM(polygonPerimeter(plane.boundary), mpu);

  const parapets = normalizeParapets(plane.parapets, plane.boundary);
  const obstacles = normalizeObstacles(plane.obstacles, plane.boundary);
  const ridges = normalizeRidges(plane.ridges);
  const valleys = normalizeValleys(plane.valleys);
  const walkways = normalizeWalkways(plane.walkways);

  const edgeInsetM = effectiveEdgeSetbackM(config, parapets.length > 0);
  const insetUnits = edgeInsetM / mpu;
  const insetPoly = insetPolygonTowardCentroid(plane.boundary, insetUnits);
  const insetAreaUnits = polygonArea(insetPoly);
  const fullAreaUnits = polygonArea(plane.boundary);
  const edgeSetbackUnits = Math.max(0, fullAreaUnits - insetAreaUnits);
  const edgeSetbackAreaM2 = round4(edgeSetbackUnits * mpu * mpu);

  const ridgeSetbackAreaM2 = round4(ridgeSetbackAreaUnits(ridges, config.ridgeSetbackM, mpu) * mpu * mpu);
  const valleySetbackAreaM2 = round4(valleySetbackAreaUnits(valleys, config.valleySetbackM, mpu) * mpu * mpu);
  const obstacleAreaM2 = round4(totalObstacleAreaUnits(obstacles, config.obstacleClearanceM, mpu, plane.boundary) * mpu * mpu);
  const parapetAreaM2 = round4(totalParapetAreaUnits(parapets) * mpu * mpu);
  const walkway = walkwayAreaOnPlane(walkways, plane.boundary, mpu);
  const walkwayAreaM2 = walkway.walkwayAreaM2;

  const grossUsablePlanM2 = round4(Math.max(0, planM2 - edgeSetbackAreaM2));
  const deductions =
    ridgeSetbackAreaM2 + valleySetbackAreaM2 + obstacleAreaM2 + parapetAreaM2 + walkwayAreaM2;
  const netUsablePlanM2 = round4(Math.max(0, grossUsablePlanM2 - deductions));
  const netUsableTrueM2 = trueAreaFromPlanM2(netUsablePlanM2, plane.pitchDeg);

  return {
    planAreaM2: planM2,
    trueAreaM2: trueM2,
    grossUsablePlanM2,
    edgeSetbackAreaM2: edgeSetbackAreaM2 || setbackAreaFromEdgeInset(planM2, edgeInsetM, perimeter),
    ridgeSetbackAreaM2,
    valleySetbackAreaM2,
    obstacleAreaM2,
    parapetAreaM2,
    walkwayAreaM2,
    netUsablePlanM2,
    netUsableTrueM2: round4(netUsableTrueM2),
  };
}

export function totalWalkwayLengthM(walkways: MaintenanceWalkwayDef[]): number {
  return walkways.reduce((s, w) => s + Math.max(0, w.widthM), 0);
}

export function ridgeLengthM(plane: NormalizedRoofPlane, metersPerUnit: number): number {
  return lengthM(totalRidgeLengthUnits(normalizeRidges(plane.ridges)), metersPerUnit);
}

export function valleyLengthM(plane: NormalizedRoofPlane, metersPerUnit: number): number {
  return lengthM(totalValleyLengthUnits(normalizeValleys(plane.valleys)), metersPerUnit);
}
