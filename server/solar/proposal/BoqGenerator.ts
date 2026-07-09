/**
 * BOQ generator — Sunchaser 7-section format.
 */

import { calculateCables } from "./CableCalculator.ts";
import { calculateProtection } from "./ProtectionCalculator.ts";
import { layoutPanels, type PanelLayoutResult } from "./PanelLayoutEngine.ts";
import {
  earthingBoreRates,
  freightRates,
  installationRates,
  netMeteringRates,
  resolveEquipmentBundle,
  suppliesJobRates,
  surveyDesignRates,
} from "./SolarProductCatalog.ts";
import {
  panelCountForSystem,
  requiresBattery,
  requiresNetMetering,
  structureLabel,
  systemTypeLabel,
  tierLabel,
} from "./SolarDesignRules.ts";
import { calculateStructure } from "./StructureCalculator.ts";
import type {
  BoqLineItem,
  BoqSection,
  BoqSectionId,
  EquipmentTier,
  SolarProposalInput,
  StructureType,
  SupportedSystemSizeKw,
  SystemType,
} from "./SolarProposalModels.ts";
import { BOQ_SECTION_LABELS, round2 } from "./SolarProposalModels.ts";

export interface BoqBuildResult {
  sections: BoqSection[];
  panelCount: number;
  cableDistanceM: number;
  cableRolls: number;
  structureCost: number;
  warnings: string[];
}

let lineCounter = 0;
function nextSr(): string {
  lineCounter += 1;
  return String(lineCounter);
}

function line(
  sectionId: BoqSectionId,
  name: string,
  description: string,
  brand: string,
  unit: string,
  quantity: number,
  unitCost: number,
  unitPrice: number
): BoqLineItem {
  const id = `${sectionId}_${lineCounter}`;
  const lineTotal = round2(quantity * unitPrice);
  return {
    id,
    sectionId,
    srNo: nextSr(),
    name,
    description,
    brand,
    unit,
    quantity,
    unitCost,
    unitPrice,
    lineTotal,
  };
}

function sectionFromLines(id: BoqSectionId, lines: BoqLineItem[]): BoqSection {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  return { id, label: BOQ_SECTION_LABELS[id], lines, subtotal };
}

export interface BoqBuildOptions {
  /** When provided, panel layout is not recalculated inside BOQ generation. */
  precomputedLayout?: PanelLayoutResult;
}

export function buildBoq(input: SolarProposalInput, options?: BoqBuildOptions): BoqBuildResult {
  lineCounter = 0;
  const {
    systemSizeKw,
    tier,
    systemType,
    structureType,
    panelWattage,
    siteComplexityScore = 0,
    netMeteringRequired,
  } = input;

  const bundle = resolveEquipmentBundle(systemSizeKw, tier, systemType);
  const panelCount = panelCountForSystem(systemSizeKw, panelWattage ?? bundle.panelWattage);
  const layout =
    options?.precomputedLayout ??
    layoutPanels({ ...input, panelWattage: panelWattage ?? bundle.panelWattage });
  const cables = calculateCables(systemSizeKw, systemType, structureType, siteComplexityScore);
  const protection = calculateProtection(systemSizeKw, systemType, tier);
  const structure = calculateStructure(panelCount, structureType);
  const warnings = [...layout.warnings];

  const imported: BoqLineItem[] = [
    line(
      "imported_equipment",
      `${bundle.panelBrand} ${bundle.panelWattage}W Mono PERC Panel`,
      `${panelCount} panels — ${tierLabel(tier)} tier`,
      bundle.panelBrand,
      "Nos",
      panelCount,
      bundle.panelUnitCost,
      bundle.panelUnitPrice
    ),
    line(
      "imported_equipment",
      `${bundle.inverterBrand} ${bundle.inverterCapacity} Inverter`,
      `${systemTypeLabel(systemType)} inverter`,
      bundle.inverterBrand,
      "Nos",
      1,
      bundle.inverterUnitCost,
      bundle.inverterUnitPrice
    ),
  ];

  if (requiresBattery(systemType) && bundle.batteryLabel) {
    imported.push(
      line(
        "imported_equipment",
        bundle.batteryLabel,
        "Energy storage for hybrid/off-grid",
        "Pylontech / Goodwe",
        "Nos",
        1,
        bundle.batteryUnitCost,
        bundle.batteryUnitPrice
      )
    );
  }

  const cableLines: BoqLineItem[] = [
    line(
      "cable_conductors",
      "4mm² Solar DC Cable Roll",
      `${cables.cableRolls} roll(s) @ complexity x${cables.complexityMultiplier}`,
      "Fast Cables / Pak Elektron",
      "Roll",
      cables.cableRolls,
      cables.rollUnitPrice,
      cables.rollUnitPrice
    ),
    line(
      "cable_conductors",
      "4mm² DC Solar Cable (metered allowance)",
      `${cables.adjustedDcDistanceM} m adjusted DC run (included in roll pricing)`,
      "Fast Cables",
      "Meter",
      cables.adjustedDcDistanceM,
      cables.dcCableCost / Math.max(1, cables.adjustedDcDistanceM),
      0
    ),
    line(
      "cable_conductors",
      "6mm² AC Cable",
      `${cables.acDistanceM} m inverter to DB`,
      "Fast Cables",
      "Meter",
      cables.acDistanceM,
      cables.acCableCost / Math.max(1, cables.acDistanceM),
      cables.acCablePrice / Math.max(1, cables.acDistanceM)
    ),
  ];

  const dbLines: BoqLineItem[] = protection.lines.map((p) =>
    line("db_boxes_breakers", p.name, "Protection and distribution", p.brand, p.unit, p.quantity, p.unitCost, p.unitPrice)
  );

  const supplies = suppliesJobRates(tier);
  const supplyLines: BoqLineItem[] = [
    line(
      "electrical_mechanical_supplies",
      "Electrical & Mechanical Installation Supplies",
      "Conduit, glands, lugs, fasteners",
      "Local",
      "Job",
      1,
      supplies.cost,
      supplies.price
    ),
    line(
      "electrical_mechanical_supplies",
      "MC4 Connectors & Junction Accessories",
      "DC side connectors",
      "Staubli / Generic",
      "Set",
      1,
      tier === "premium" ? 8500 : 6500,
      tier === "premium" ? 9500 : 7500
    ),
  ];

  const earthing = earthingBoreRates(tier);
  const earthLines: BoqLineItem[] = [
    line(
      "system_earthing",
      "Earthing Bore & Chemical Earthing",
      "2 bore pits with copper plate",
      "Local",
      "Job",
      1,
      earthing.cost,
      earthing.price
    ),
    line(
      "system_earthing",
      "Earthing Wire 16mm²",
      `${cables.earthDistanceM} m`,
      "Pak Elektron",
      "Meter",
      cables.earthDistanceM,
      cables.earthWireCost / Math.max(1, cables.earthDistanceM),
      cables.earthWirePrice / Math.max(1, cables.earthDistanceM)
    ),
  ];

  const structureLines: BoqLineItem[] = [
    line(
      "roof_mounting_structure",
      structureLabel(structureType),
      structure.description,
      "Mughal / Local Fabrication",
      structure.unitLabel,
      structure.quantity,
      structure.unitCost,
      structure.unitPrice
    ),
  ];

  const install = installationRates(systemSizeKw, tier);
  const freight = freightRates(tier);
  const survey = surveyDesignRates(tier);
  const serviceLines: BoqLineItem[] = [
    line(
      "sunchaser_energy_services",
      "Professional Installation & Commissioning",
      `${systemSizeKw}kW ${systemTypeLabel(systemType)}`,
      "Sunchaser Energy",
      "Job",
      1,
      install.cost,
      install.price
    ),
    line(
      "sunchaser_energy_services",
      "Site Survey & System Design",
      "Layout, shading, load study",
      "Sunchaser Energy",
      "Job",
      1,
      survey.cost,
      survey.price
    ),
    line(
      "sunchaser_energy_services",
      "Transportation & Handling",
      "Delivery to site",
      "Sunchaser Energy",
      "Job",
      1,
      freight.cost,
      freight.price
    ),
  ];

  if (requiresNetMetering(systemType, systemSizeKw, netMeteringRequired)) {
    const nm = netMeteringRates(systemSizeKw);
    serviceLines.push(
      line(
        "sunchaser_energy_services",
        "Net Metering Documentation & Liaison",
        "DISCO coordination",
        "Sunchaser Energy",
        "Job",
        1,
        nm.cost,
        nm.price
      )
    );
  }

  const sections: BoqSection[] = [
    sectionFromLines("imported_equipment", imported),
    sectionFromLines("cable_conductors", cableLines),
    sectionFromLines("db_boxes_breakers", dbLines),
    sectionFromLines("electrical_mechanical_supplies", supplyLines),
    sectionFromLines("system_earthing", earthLines),
    sectionFromLines("roof_mounting_structure", structureLines),
    sectionFromLines("sunchaser_energy_services", serviceLines),
  ];

  return {
    sections,
    panelCount,
    cableDistanceM: cables.adjustedDcDistanceM,
    cableRolls: cables.cableRolls,
    structureCost: structure.lineTotalPrice,
    warnings,
  };
}

export function assertBoqSectionOrder(sections: BoqSection[]): boolean {
  const ids = sections.map((s) => s.id);
  const expected: BoqSectionId[] = [
    "imported_equipment",
    "cable_conductors",
    "db_boxes_breakers",
    "electrical_mechanical_supplies",
    "system_earthing",
    "roof_mounting_structure",
    "sunchaser_energy_services",
  ];
  return expected.every((id, i) => ids[i] === id);
}
