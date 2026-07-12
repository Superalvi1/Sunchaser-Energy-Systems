/**
 * Panel packing constraints — spacing + setbacks.
 * Setback merge reuses roof engine DEFAULT_ROOF_SETBACKS.
 */

import { mergeSetbackConfig, DEFAULT_ROOF_SETBACKS } from "../roof/RoofSetbackRules.ts";
import type { RoofSetbackConfig } from "../roof/RoofModels.ts";
import { isFiniteNumber } from "../roof/RoofModels.ts";
import {
  PanelLayoutError,
  type PanelLayoutConstraints,
  type PanelSpacingConstraints,
} from "./PanelLayoutModels.ts";

export const DEFAULT_PANEL_SPACING: PanelSpacingConstraints = {
  gapM: 0.02,
  rowSpacingM: 0.02,
  edgeClearanceM: 0,
  structureClearanceM: 0.3,
};

export function defaultPanelLayoutConstraints(): PanelLayoutConstraints {
  return {
    spacing: { ...DEFAULT_PANEL_SPACING },
    setbacks: { ...DEFAULT_ROOF_SETBACKS },
  };
}

export function mergePanelLayoutConstraints(
  partial?: Partial<PanelLayoutConstraints>
): PanelLayoutConstraints {
  const base = defaultPanelLayoutConstraints();
  const spacing: PanelSpacingConstraints = {
    gapM: partial?.spacing?.gapM ?? base.spacing.gapM,
    rowSpacingM: partial?.spacing?.rowSpacingM ?? base.spacing.rowSpacingM,
    edgeClearanceM: partial?.spacing?.edgeClearanceM ?? base.spacing.edgeClearanceM,
    structureClearanceM: partial?.spacing?.structureClearanceM ?? base.spacing.structureClearanceM,
  };
  validateSpacing(spacing);
  return {
    spacing,
    setbacks: mergeSetbackConfig({ ...base.setbacks, ...partial?.setbacks }),
  };
}

export function validateSpacing(spacing: PanelSpacingConstraints): void {
  for (const [key, value] of Object.entries(spacing) as [keyof PanelSpacingConstraints, number][]) {
    if (!isFiniteNumber(value) || value < 0) {
      throw new PanelLayoutError("NON_FINITE", `spacing.${key} must be a finite number >= 0.`);
    }
  }
}

export function effectiveEdgeInsetM(
  setbacks: RoofSetbackConfig,
  spacing: PanelSpacingConstraints,
  hasParapet: boolean
): number {
  const fire = Math.max(0, setbacks.edgeSetbackM) + (hasParapet ? Math.max(0, setbacks.parapetSetbackM) : 0);
  return fire + Math.max(0, spacing.edgeClearanceM);
}
