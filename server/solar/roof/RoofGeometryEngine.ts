/**
 * Roof Intelligence Phase 2A — geometry engine orchestrator.
 */

import type { RoofPlaneMetrics, RoofSiteInput, RoofSiteMetrics } from "./RoofModels.ts";
import { ROOF_ENGINE_TIMESTAMP, round4 } from "./RoofModels.ts";
import { normalizeCoordinateSystem, trueAzimuthFromPlan } from "./RoofCoordinateSystem.ts";
import {
  normalizeRoofPlane,
  orientationFromAzimuth,
  type NormalizedRoofPlane,
} from "./RoofPlane.ts";
import { computeUsableArea, ridgeLengthM, valleyLengthM } from "./RoofUsableArea.ts";
import { perimeterM } from "./RoofMeasurement.ts";
import { validateRoofSiteStrict } from "./RoofValidation.ts";

export interface AnalyzeRoofSiteOptions {
  skipValidation?: boolean;
}

export function analyzeRoofPlane(
  plane: NormalizedRoofPlane,
  metersPerUnit: number,
  northAzimuthDeg = 0
): RoofPlaneMetrics {
  const usable = computeUsableArea(plane, metersPerUnit, plane.setbacks);
  const trueAz = trueAzimuthFromPlan(plane.azimuthDeg, normalizeCoordinateSystem(undefined, metersPerUnit, northAzimuthDeg));

  return {
    planeId: plane.id,
    planAreaM2: usable.planAreaM2,
    trueAreaM2: usable.trueAreaM2,
    perimeterM: perimeterM(plane.boundary, metersPerUnit),
    pitchDeg: plane.pitchDeg,
    azimuthDeg: round4(trueAz),
    orientation: orientationFromAzimuth(trueAz),
    panelMountOrientation: plane.panelMountOrientation,
    grossUsableAreaM2: usable.grossUsablePlanM2,
    obstacleAreaM2: usable.obstacleAreaM2,
    parapetAreaM2: usable.parapetAreaM2,
    walkwayAreaM2: usable.walkwayAreaM2,
    setbackAreaM2: round4(usable.edgeSetbackAreaM2 + usable.ridgeSetbackAreaM2 + usable.valleySetbackAreaM2),
    netUsableAreaM2: usable.netUsableTrueM2,
    ridgeLengthM: ridgeLengthM(plane, metersPerUnit),
    valleyLengthM: valleyLengthM(plane, metersPerUnit),
  };
}

export function analyzeRoofSite(input: RoofSiteInput, options: AnalyzeRoofSiteOptions = {}): RoofSiteMetrics {
  if (!options.skipValidation) {
    validateRoofSiteStrict(input);
  }

  const cs = normalizeCoordinateSystem(input.origin, input.metersPerUnit, input.northAzimuthDeg);
  const planes: RoofPlaneMetrics[] = [];

  for (const raw of input.planes) {
    const normalized = normalizeRoofPlane(raw);
    planes.push(analyzeRoofPlane(normalized, cs.metersPerUnit, cs.northAzimuthDeg));
  }

  const totalPlanAreaM2 = round4(planes.reduce((s, p) => s + p.planAreaM2, 0));
  const totalTrueAreaM2 = round4(planes.reduce((s, p) => s + p.trueAreaM2, 0));
  const totalNetUsableAreaM2 = round4(planes.reduce((s, p) => s + p.netUsableAreaM2, 0));

  return {
    generatedAt: ROOF_ENGINE_TIMESTAMP,
    siteId: input.siteId,
    planeCount: planes.length,
    totalPlanAreaM2,
    totalTrueAreaM2,
    totalNetUsableAreaM2,
    planes,
    warnings: [],
  };
}
