/**
 * Inverter electrical catalog — MPPT channels by system size/type.
 */

import type { ElectricalSystemSizeKw, ElectricalSystemType, InverterElectricalSpec } from "./ElectricalModels.ts";
import { validateInverterElectricalSpec } from "./ElectricalValidation.ts";

function mppt(id: string, minV: number, maxV: number, maxCurrentA: number, maxStrings = 2) {
  return { mpptId: id, minV, maxV, maxCurrentA, maxStrings };
}

function buildInverter(
  sizeKw: ElectricalSystemSizeKw,
  systemType: ElectricalSystemType,
  maxDcVoltageV: number,
  mppts: InverterElectricalSpec["mppts"],
  efficiencyPct: number
): InverterElectricalSpec {
  return {
    inverterId: `inv-${systemType}-${sizeKw}kw`,
    name: `${sizeKw} kW ${systemType} inverter`,
    systemType,
    acRatingKw: sizeKw,
    maxDcVoltageV,
    maxDcCurrentA: Math.max(...mppts.map((m) => m.maxCurrentA)) * mppts.length,
    efficiencyPct,
    acNominalVoltageV: sizeKw >= 10 ? 400 : 230,
    acPhases: sizeKw >= 10 ? 3 : 1,
    mppts,
  };
}

const ON_GRID: Record<ElectricalSystemSizeKw, InverterElectricalSpec> = {
  3: buildInverter(3, "on-grid", 600, [mppt("mppt-1", 80, 550, 15, 2)], 97.5),
  5: buildInverter(5, "on-grid", 600, [mppt("mppt-1", 90, 550, 18, 2), mppt("mppt-2", 90, 550, 18, 2)], 97.8),
  6: buildInverter(6, "on-grid", 600, [mppt("mppt-1", 90, 550, 18, 2), mppt("mppt-2", 90, 550, 18, 2)], 97.8),
  8: buildInverter(8, "on-grid", 600, [mppt("mppt-1", 100, 550, 20, 2), mppt("mppt-2", 100, 550, 20, 2)], 98.0),
  10: buildInverter(10, "on-grid", 1000, [mppt("mppt-1", 120, 850, 22, 3), mppt("mppt-2", 120, 850, 22, 3)], 98.0),
  15: buildInverter(15, "on-grid", 1000, [mppt("mppt-1", 120, 850, 26, 3), mppt("mppt-2", 120, 850, 26, 3), mppt("mppt-3", 120, 850, 26, 3)], 98.2),
};

function withType(base: InverterElectricalSpec, systemType: ElectricalSystemType): InverterElectricalSpec {
  return {
    ...base,
    systemType,
    inverterId: `inv-${systemType}-${base.acRatingKw}kw`,
    name: `${base.acRatingKw} kW ${systemType} inverter`,
    mppts: base.mppts.map((m) => ({ ...m })),
  };
}

export function getInverterElectricalSpec(
  sizeKw: ElectricalSystemSizeKw,
  systemType: ElectricalSystemType
): InverterElectricalSpec {
  const base = ON_GRID[sizeKw];
  if (!base) {
    throw new Error(`Unsupported inverter size: ${sizeKw}`);
  }
  const spec = withType(base, systemType);
  validateInverterElectricalSpec(spec);
  return spec;
}

export function listInverterElectricalCatalog(): InverterElectricalSpec[] {
  const sizes = [3, 5, 6, 8, 10, 15] as ElectricalSystemSizeKw[];
  const types: ElectricalSystemType[] = ["on-grid", "hybrid", "off-grid"];
  const out: InverterElectricalSpec[] = [];
  for (const size of sizes) {
    for (const t of types) out.push(getInverterElectricalSpec(size, t));
  }
  return out;
}
