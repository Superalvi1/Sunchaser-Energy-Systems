/**
 * Default setback rules for roof planes.
 */

import type { RoofSetbackConfig } from "./RoofModels.ts";
import { finiteNum } from "./RoofModels.ts";

export const DEFAULT_ROOF_SETBACKS: RoofSetbackConfig = {
  edgeSetbackM: 0.6,
  ridgeSetbackM: 0.5,
  valleySetbackM: 0.4,
  parapetSetbackM: 0.3,
  obstacleClearanceM: 0.5,
  maintenanceWalkwayM: 0.6,
};

export function mergeSetbackConfig(partial?: Partial<RoofSetbackConfig>): RoofSetbackConfig {
  return {
    edgeSetbackM: finiteNum(partial?.edgeSetbackM, DEFAULT_ROOF_SETBACKS.edgeSetbackM),
    ridgeSetbackM: finiteNum(partial?.ridgeSetbackM, DEFAULT_ROOF_SETBACKS.ridgeSetbackM),
    valleySetbackM: finiteNum(partial?.valleySetbackM, DEFAULT_ROOF_SETBACKS.valleySetbackM),
    parapetSetbackM: finiteNum(partial?.parapetSetbackM, DEFAULT_ROOF_SETBACKS.parapetSetbackM),
    obstacleClearanceM: finiteNum(partial?.obstacleClearanceM, DEFAULT_ROOF_SETBACKS.obstacleClearanceM),
    maintenanceWalkwayM: finiteNum(partial?.maintenanceWalkwayM, DEFAULT_ROOF_SETBACKS.maintenanceWalkwayM),
  };
}

export function effectiveEdgeSetbackM(config: RoofSetbackConfig, hasParapet: boolean): number {
  const base = Math.max(0, config.edgeSetbackM);
  return hasParapet ? base + Math.max(0, config.parapetSetbackM) : base;
}

export function setbackAreaFromEdgeInset(planAreaM2: number, insetM: number, perimeterM: number): number {
  if (insetM <= 0 || planAreaM2 <= 0) return 0;
  const approx = perimeterM * insetM;
  return Math.min(planAreaM2 * 0.45, Math.max(0, approx * 0.85));
}
