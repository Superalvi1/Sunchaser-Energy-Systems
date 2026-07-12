/**
 * Electrical BOQ section generator — quantities only, no pricing/CRM.
 */

import type {
  CableSizingResult,
  EarthingLightningResult,
  ElectricalBoqLine,
  InverterElectricalSpec,
  PanelElectricalSpec,
  ProtectionDevices,
  StringingResult,
} from "./ElectricalModels.ts";

export interface ElectricalBoqInput {
  panelSpec: PanelElectricalSpec;
  inverter: InverterElectricalSpec;
  stringing: StringingResult;
  cable: CableSizingResult;
  protection: ProtectionDevices;
  earthing: EarthingLightningResult;
  dcLengthM: number;
  acLengthM: number;
  panelCount: number;
}

export function generateElectricalBoq(input: ElectricalBoqInput): ElectricalBoqLine[] {
  const lines: ElectricalBoqLine[] = [];
  let n = 0;
  const add = (category: string, description: string, qty: number, unit: string, notes?: string) => {
    n += 1;
    lines.push({ id: `eboq-${n}`, category, description, qty, unit, notes });
  };

  add("PV Modules", `${input.panelSpec.name} (${input.panelSpec.wattageW}W)`, input.panelCount, "pcs");
  add("Inverter", input.inverter.name, 1, "pcs");
  add("DC Cable", `Cu ${input.cable.dcCableMm2} mm² DC`, Math.ceil(input.dcLengthM * 2), "m", "Round-trip estimate");
  add("AC Cable", `Cu ${input.cable.acCableMm2} mm² AC`, Math.ceil(input.acLengthM), "m");
  add("DC Isolator", input.protection.dcIsolator.label, 1, "pcs");
  add(
    "DC Protection",
    input.protection.dcBreakerOrFuse.label,
    Math.max(1, input.stringing.stringCount),
    "pcs"
  );
  add("DC SPD", input.protection.dcSpd.label, 1, "pcs");
  add("AC Breaker", input.protection.acBreaker.label, 1, "pcs");
  add("AC SPD", input.protection.acSpd.label, 1, "pcs");
  if (input.protection.batteryFuseDisconnect?.required) {
    add("Battery Protection", input.protection.batteryFuseDisconnect.label, 1, "pcs");
  }
  add("Earthing", input.earthing.earthingLabel, Math.ceil(input.dcLengthM * 0.5 + 10), "m");
  if (input.earthing.lightningArrestorRecommended) {
    add("Lightning", input.earthing.lightningLabel, 1, "set");
  }
  add("MC4 / Connectors", "DC connectors pair", input.stringing.stringCount * 2, "pairs");

  return lines;
}
