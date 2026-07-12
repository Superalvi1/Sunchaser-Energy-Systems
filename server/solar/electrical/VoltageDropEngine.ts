/**
 * Voltage drop + cable loss % — reuses simulation VoltageDropCalculator.
 */

import { computeDcAcVoltageDrop } from "../simulation/VoltageDropCalculator.ts";
import { computeCablePowerLossKw } from "../simulation/CableLossCalculator.ts";
import { round4, type VoltageDropResult } from "./ElectricalModels.ts";

export interface ElectricalVoltageDropInput {
  dcCurrentA: number;
  acCurrentA: number;
  dcCableLengthM: number;
  acCableLengthM: number;
  dcCableMm2: number;
  acCableMm2: number;
  dcStringVoltageV: number;
  acNominalVoltageV: number;
  routeFactor?: number;
}

export function computeElectricalVoltageDrop(input: ElectricalVoltageDropInput): VoltageDropResult {
  const rf = input.routeFactor ?? 1.1;
  const drops = computeDcAcVoltageDrop({
    dcCurrentA: input.dcCurrentA,
    acCurrentA: input.acCurrentA,
    dcCableLengthM: input.dcCableLengthM * rf,
    acCableLengthM: input.acCableLengthM * rf,
    dcCableMm2: input.dcCableMm2,
    acCableMm2: input.acCableMm2,
    dcStringVoltageV: input.dcStringVoltageV,
    acNominalVoltageV: input.acNominalVoltageV,
  });

  const dcLossKw = computeCablePowerLossKw({
    currentA: input.dcCurrentA,
    lengthM: input.dcCableLengthM * rf,
    crossSectionMm2: input.dcCableMm2,
    operatingHoursPerYear: 1,
    roundTrip: true,
  });
  const acLossKw = computeCablePowerLossKw({
    currentA: input.acCurrentA,
    lengthM: input.acCableLengthM * rf,
    crossSectionMm2: input.acCableMm2,
    operatingHoursPerYear: 1,
    roundTrip: false,
  });

  const dcPowerKw = (input.dcStringVoltageV * input.dcCurrentA) / 1000;
  const acPowerKw = (input.acNominalVoltageV * input.acCurrentA) / 1000;

  return {
    dcVoltageDropV: drops.dcVoltageDropV,
    dcVoltageDropPct: drops.dcVoltageDropPct,
    acVoltageDropV: drops.acVoltageDropV,
    acVoltageDropPct: drops.acVoltageDropPct,
    dcCableLossPct: dcPowerKw > 0 ? round4((dcLossKw / dcPowerKw) * 100) : 0,
    acCableLossPct: acPowerKw > 0 ? round4((acLossKw / acPowerKw) * 100) : 0,
  };
}
