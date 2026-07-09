/**
 * Roof plane orientation, pitch, and azimuth helpers.
 */

import type { PanelMountOrientation, Point2D, RoofOrientation, RoofPlaneInput } from "./RoofModels.ts";
import { isFiniteNumber, round4 } from "./RoofModels.ts";
import { polygonArea } from "./RoofPolygon.ts";
import { validateBoundaryVertices } from "./RoofValidation.ts";

export interface NormalizedRoofPlane extends RoofPlaneInput {
  boundary: Point2D[];
  pitchDeg: number;
  azimuthDeg: number;
  panelMountOrientation: PanelMountOrientation;
}

export function normalizePitchDeg(pitch: number): number {
  if (!isFiniteNumber(pitch)) return pitch;
  return Math.max(0, Math.min(60, pitch));
}

export function normalizeAzimuthDeg(azimuth: number): number {
  if (!isFiniteNumber(azimuth)) return azimuth;
  const a = azimuth % 360;
  return a < 0 ? a + 360 : a;
}

export function pitchRadians(pitchDeg: number): number {
  return (normalizePitchDeg(pitchDeg) * Math.PI) / 180;
}

export function trueAreaFromPlanM2(planAreaM2: number, pitchDeg: number): number {
  const rad = pitchRadians(pitchDeg);
  const cos = Math.cos(rad);
  if (cos < 1e-6) return planAreaM2;
  return round4(planAreaM2 / cos);
}

export function orientationFromAzimuth(azimuthDeg: number): RoofOrientation {
  const a = normalizeAzimuthDeg(azimuthDeg);
  if (a >= 337.5 || a < 22.5) return "north";
  if (a < 67.5) return "northeast";
  if (a < 112.5) return "east";
  if (a < 157.5) return "southeast";
  if (a < 202.5) return "south";
  if (a < 247.5) return "southwest";
  if (a < 292.5) return "west";
  return "northwest";
}

export function optimalAzimuthForHemisphere(hemisphere: "north" | "south" = "north"): number {
  return hemisphere === "north" ? 180 : 0;
}

export function azimuthDeviationFromOptimal(azimuthDeg: number, hemisphere: "north" | "south" = "north"): number {
  const optimal = optimalAzimuthForHemisphere(hemisphere);
  const a = normalizeAzimuthDeg(azimuthDeg);
  const diff = Math.abs(a - optimal);
  return Math.min(diff, 360 - diff);
}

export function normalizeRoofPlane(input: RoofPlaneInput): NormalizedRoofPlane {
  const boundary = validateBoundaryVertices(input.boundary, input.id);
  return {
    ...input,
    boundary,
    pitchDeg: input.pitchDeg,
    azimuthDeg: normalizeAzimuthDeg(input.azimuthDeg),
    panelMountOrientation: input.panelMountOrientation ?? "portrait",
    obstacles: input.obstacles ?? [],
    parapets: input.parapets ?? [],
    ridges: input.ridges ?? [],
    valleys: input.valleys ?? [],
    walkways: input.walkways ?? [],
  };
}

export function planePlanAreaUnits(plane: NormalizedRoofPlane): number {
  return polygonArea(plane.boundary);
}
