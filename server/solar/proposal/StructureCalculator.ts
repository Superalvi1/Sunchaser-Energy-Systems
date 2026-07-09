/**
 * Roof mounting structure pricing by panel count and structure type.
 */

import type { StructureType } from "./SolarProposalModels.ts";
import { round2 } from "./SolarProposalModels.ts";

export interface StructureCalculation {
  structureType: StructureType;
  panelCount: number;
  unitLabel: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotalCost: number;
  lineTotalPrice: number;
  description: string;
}

const STANDARD_PER_PANEL_COST = 4800;
const STANDARD_PER_PANEL_PRICE = 5600;
const ELEVATED_BASE_JOB_COST = 147600;
const ELEVATED_BASE_JOB_PRICE = 175000;
const ELEVATED_PER_PANEL_COST = 4200;
const ELEVATED_PER_PANEL_PRICE = 5000;

export function calculateStructure(panelCount: number, structureType: StructureType): StructureCalculation {
  if (structureType === "elevated_hbeam") {
    const lineTotalCost = round2(ELEVATED_BASE_JOB_COST + panelCount * ELEVATED_PER_PANEL_COST);
    const lineTotalPrice = round2(ELEVATED_BASE_JOB_PRICE + panelCount * ELEVATED_PER_PANEL_PRICE);
    return {
      structureType,
      panelCount,
      unitLabel: "Job",
      quantity: 1,
      unitCost: lineTotalCost,
      unitPrice: lineTotalPrice,
      lineTotalCost,
      lineTotalPrice,
      description: `Elevated H-Beam / C-Channel fabrication for ${panelCount} panels`,
    };
  }

  const lineTotalCost = round2(panelCount * STANDARD_PER_PANEL_COST);
  const lineTotalPrice = round2(panelCount * STANDARD_PER_PANEL_PRICE);
  return {
    structureType,
    panelCount,
    unitLabel: "Panel",
    quantity: panelCount,
    unitCost: STANDARD_PER_PANEL_COST,
    unitPrice: STANDARD_PER_PANEL_PRICE,
    lineTotalCost,
    lineTotalPrice,
    description: `Standard roof mounting rails and clamps for ${panelCount} panels`,
  };
}
