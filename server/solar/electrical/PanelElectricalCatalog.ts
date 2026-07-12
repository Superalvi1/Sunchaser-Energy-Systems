/**
 * Panel electrical catalog — STC specs for stringing.
 */

import type { PanelElectricalSpec } from "./ElectricalModels.ts";
import { validatePanelElectricalSpec } from "./ElectricalValidation.ts";

export const PANEL_ELEC_580W: PanelElectricalSpec = {
  moduleId: "mod-580w-elec",
  name: "580W Electrical",
  wattageW: 580,
  vocStcV: 49.5,
  vmpStcV: 41.5,
  iscStcA: 14.5,
  impStcA: 14.0,
  tempCoeffVocPctPerC: -0.28,
  tempCoeffVmpPctPerC: -0.35,
  tempCoeffIscPctPerC: 0.05,
};

export const PANEL_ELEC_550W: PanelElectricalSpec = {
  moduleId: "mod-550w-elec",
  name: "550W Electrical",
  wattageW: 550,
  vocStcV: 49.8,
  vmpStcV: 41.7,
  iscStcA: 13.9,
  impStcA: 13.2,
  tempCoeffVocPctPerC: -0.27,
  tempCoeffVmpPctPerC: -0.34,
  tempCoeffIscPctPerC: 0.05,
};

export const PANEL_ELEC_400W: PanelElectricalSpec = {
  moduleId: "mod-400w-elec",
  name: "400W Electrical",
  wattageW: 400,
  vocStcV: 41.2,
  vmpStcV: 34.5,
  iscStcA: 12.2,
  impStcA: 11.6,
  tempCoeffVocPctPerC: -0.28,
  tempCoeffVmpPctPerC: -0.35,
  tempCoeffIscPctPerC: 0.045,
};

const BUILTIN: Record<string, PanelElectricalSpec> = {
  [PANEL_ELEC_580W.moduleId]: PANEL_ELEC_580W,
  [PANEL_ELEC_550W.moduleId]: PANEL_ELEC_550W,
  [PANEL_ELEC_400W.moduleId]: PANEL_ELEC_400W,
};

export function listPanelElectricalCatalog(): PanelElectricalSpec[] {
  return Object.values(BUILTIN).map((p) => ({ ...p }));
}

export function getPanelElectricalSpec(moduleId: string): PanelElectricalSpec | null {
  const p = BUILTIN[moduleId];
  return p ? { ...p } : null;
}

export function requirePanelElectricalSpec(moduleId: string): PanelElectricalSpec {
  const p = getPanelElectricalSpec(moduleId);
  if (!p) {
    throw new Error(`Unknown panel electrical module: ${moduleId}`);
  }
  validatePanelElectricalSpec(p);
  return p;
}
