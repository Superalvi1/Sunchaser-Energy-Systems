/**
 * Panel module catalog — deterministic defaults for packing.
 * No CRM / quotation pricing.
 */

import type { PanelModuleSpec } from "./PanelLayoutModels.ts";
import { PanelLayoutError } from "./PanelLayoutModels.ts";
import { isFiniteNumber } from "../roof/RoofModels.ts";

/** Common 580 W residential/commercial module (matches studio defaults). */
export const CATALOG_MODULE_580W: PanelModuleSpec = {
  moduleId: "mod-580w-2278x1134",
  name: "580W Standard",
  widthM: 1.134,
  heightM: 2.278,
  wattage: 580,
};

export const CATALOG_MODULE_550W: PanelModuleSpec = {
  moduleId: "mod-550w-2278x1134",
  name: "550W Standard",
  widthM: 1.134,
  heightM: 2.278,
  wattage: 550,
};

export const CATALOG_MODULE_400W: PanelModuleSpec = {
  moduleId: "mod-400w-1722x1134",
  name: "400W Compact",
  widthM: 1.134,
  heightM: 1.722,
  wattage: 400,
};

const BUILTIN: Record<string, PanelModuleSpec> = {
  [CATALOG_MODULE_580W.moduleId]: CATALOG_MODULE_580W,
  [CATALOG_MODULE_550W.moduleId]: CATALOG_MODULE_550W,
  [CATALOG_MODULE_400W.moduleId]: CATALOG_MODULE_400W,
};

export function listCatalogModules(): PanelModuleSpec[] {
  return Object.values(BUILTIN).map((m) => ({ ...m }));
}

export function getCatalogModule(moduleId: string): PanelModuleSpec | null {
  const m = BUILTIN[moduleId];
  return m ? { ...m } : null;
}

export function validatePanelModule(module: PanelModuleSpec): void {
  if (!module || typeof module !== "object") {
    throw new PanelLayoutError("INVALID_MODULE", "Panel module is required.");
  }
  if (!module.moduleId || !String(module.moduleId).trim()) {
    throw new PanelLayoutError("INVALID_MODULE", "moduleId is required.");
  }
  if (!isFiniteNumber(module.widthM) || module.widthM <= 0) {
    throw new PanelLayoutError("INVALID_MODULE", "widthM must be a positive finite number.");
  }
  if (!isFiniteNumber(module.heightM) || module.heightM <= 0) {
    throw new PanelLayoutError("INVALID_MODULE", "heightM must be a positive finite number.");
  }
  if (!isFiniteNumber(module.wattage) || module.wattage <= 0) {
    throw new PanelLayoutError("INVALID_MODULE", "wattage must be a positive finite number.");
  }
}
