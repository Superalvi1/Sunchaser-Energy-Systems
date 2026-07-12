/**
 * Phase 3C — Electrical Design Engine orchestrator.
 *
 * Input: placed panels + electrical catalogs + site/cable assumptions.
 * Output: stringing, MPPT allocation, cables, protection, earthing, BOQ.
 *
 * Reuses simulation voltageAtTemp, VoltageDropCalculator, CableLossCalculator.
 * Fail closed. No AI/DB/routes/save/PDF.
 */

import {
  ELECTRICAL_ENGINE_TIMESTAMP,
  round4,
  type ElectricalAssumption,
  type ElectricalDesignInput,
  type ElectricalDesignResult,
} from "./ElectricalModels.ts";
import {
  assertFiniteElectricalResult,
  validateElectricalDesignInput,
} from "./ElectricalValidation.ts";
import { computeElectricalStringing } from "./StringSizingEngine.ts";
import { allocateStringsToMppts } from "./MpptAllocator.ts";
import { sizeCables } from "./CableSizingEngine.ts";
import { computeElectricalVoltageDrop } from "./VoltageDropEngine.ts";
import { acCurrentFromInverter, selectProtectionDevices } from "./ProtectionDeviceSelector.ts";
import { recommendEarthingLightning } from "./EarthingLightningRules.ts";
import { generateElectricalBoq } from "./ElectricalBoqGenerator.ts";

function pushAssumption(
  list: ElectricalAssumption[],
  id: string,
  label: string,
  value: string | number | boolean,
  source: ElectricalAssumption["source"],
  unit?: string
): void {
  list.push({ id, label, value, unit, source });
}

/**
 * Design electrical system from placed panels.
 * Invalid stringing returns structured result with valid=false (not fake success).
 * Invalid *input* throws ElectricalDesignError before design.
 */
export function designElectricalSystem(input: ElectricalDesignInput): ElectricalDesignResult {
  validateElectricalDesignInput(input);

  const assumptions: ElectricalAssumption[] = [];
  const warnings: string[] = [];

  pushAssumption(assumptions, "systemType", "System type", input.systemType, "input");
  pushAssumption(assumptions, "tmin", "Design min temperature", input.temperatures.designTempMinC, "input", "°C");
  pushAssumption(assumptions, "tmax", "Design max temperature", input.temperatures.designTempMaxC, "input", "°C");
  pushAssumption(assumptions, "dcLength", "DC cable length", input.cableRoute.dcLengthM, "input", "m");
  pushAssumption(assumptions, "acLength", "AC cable length", input.cableRoute.acLengthM, "input", "m");
  pushAssumption(
    assumptions,
    "routeFactor",
    "Cable route factor",
    input.cableRoute.routeFactor ?? 1.1,
    input.cableRoute.routeFactor !== undefined ? "input" : "default"
  );
  pushAssumption(
    assumptions,
    "maxVd",
    "Max voltage drop target",
    input.maxVoltageDropPct ?? 2,
    input.maxVoltageDropPct !== undefined ? "input" : "default",
    "%"
  );
  pushAssumption(assumptions, "panel", "Panel module", input.panelSpec.moduleId, "catalog");
  pushAssumption(assumptions, "inverter", "Inverter", input.inverterSpec.inverterId, "catalog");
  pushAssumption(
    assumptions,
    "unequalStrings",
    "Allow unequal strings",
    input.allowUnequalStrings !== false,
    "default"
  );

  const panelCount = input.placedPanels.length;
  const dcCapacityKw = round4((panelCount * input.panelSpec.wattageW) / 1000);

  const stringing = computeElectricalStringing({
    panels: input.placedPanels,
    panelSpec: input.panelSpec,
    inverter: input.inverterSpec,
    designTempMinC: input.temperatures.designTempMinC,
    designTempMaxC: input.temperatures.designTempMaxC,
    allowUnequalStrings: input.allowUnequalStrings,
  });

  if (!stringing.valid) {
    warnings.push(...stringing.issues);
  }

  const mppt = allocateStringsToMppts(stringing.strings, input.inverterSpec);
  if (!mppt.compatible) {
    warnings.push(...mppt.issues);
    stringing.valid = false;
    stringing.issues = [...stringing.issues, ...mppt.issues];
  }
  stringing.strings = mppt.strings;

  const acCurrentA = acCurrentFromInverter(input.inverterSpec);
  const dcCurrentA = stringing.valid ? stringing.totalDcCurrentA : input.panelSpec.impStcA;
  const dcNominalV = stringing.valid ? stringing.stringVmpAtTmaxV : input.panelSpec.vmpStcV;

  const cable = sizeCables({
    route: input.cableRoute,
    dcCurrentA,
    acCurrentA,
    dcNominalVoltageV: Math.max(dcNominalV, 1),
    acNominalVoltageV: input.inverterSpec.acNominalVoltageV,
    maxVoltageDropPct: input.maxVoltageDropPct,
  });
  for (const a of cable.assumptions) {
    pushAssumption(assumptions, `cable-${assumptions.length}`, a, true, "default");
  }

  const voltageDrop = computeElectricalVoltageDrop({
    dcCurrentA,
    acCurrentA,
    dcCableLengthM: input.cableRoute.dcLengthM,
    acCableLengthM: input.cableRoute.acLengthM,
    dcCableMm2: cable.dcCableMm2,
    acCableMm2: cable.acCableMm2,
    dcStringVoltageV: Math.max(dcNominalV, 1),
    acNominalVoltageV: input.inverterSpec.acNominalVoltageV,
    routeFactor: cable.routeFactor,
  });

  if (voltageDrop.dcVoltageDropPct > (input.maxVoltageDropPct ?? 2)) {
    warnings.push(`DC voltage drop ${voltageDrop.dcVoltageDropPct}% exceeds target.`);
  }
  if (voltageDrop.acVoltageDropPct > (input.maxVoltageDropPct ?? 2)) {
    warnings.push(`AC voltage drop ${voltageDrop.acVoltageDropPct}% exceeds target.`);
  }

  const protection = selectProtectionDevices({
    systemType: input.systemType,
    inverter: input.inverterSpec,
    stringCount: Math.max(1, stringing.stringCount),
    iscPerStringA: input.panelSpec.iscStcA,
    totalDcCurrentA: dcCurrentA,
    acCurrentA,
    preferences: input.protection,
  });

  const earthingLightning = recommendEarthingLightning({
    systemType: input.systemType,
    dcCapacityKw,
    preferences: input.protection,
  });
  for (const note of earthingLightning.notes) {
    pushAssumption(assumptions, `earth-${assumptions.length}`, note, true, "default");
  }

  const boq = generateElectricalBoq({
    panelSpec: input.panelSpec,
    inverter: input.inverterSpec,
    stringing,
    cable,
    protection,
    earthing: earthingLightning,
    dcLengthM: input.cableRoute.dcLengthM,
    acLengthM: input.cableRoute.acLengthM,
    panelCount,
  });

  const inverterCompatible = stringing.valid && mppt.compatible;
  const valid = stringing.valid && mppt.compatible;

  const result: ElectricalDesignResult = {
    generatedAt: ELECTRICAL_ENGINE_TIMESTAMP,
    systemType: input.systemType,
    panelCount,
    dcCapacityKw,
    stringing,
    mpptAllocations: mppt.allocations,
    inverterCompatible,
    cable,
    voltageDrop,
    protection,
    earthingLightning,
    boq,
    assumptions,
    warnings,
    valid,
  };

  assertFiniteElectricalResult(result);
  return result;
}

export const ElectricalDesignEngine = {
  design: designElectricalSystem,
};
