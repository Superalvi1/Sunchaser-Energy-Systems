/**
 * Fail-closed validation for electrical design inputs.
 */

import {
  ELECTRICAL_SYSTEM_TYPES,
  ElectricalDesignError,
  type CableRouteInput,
  type ElectricalDesignInput,
  type ElectricalSystemType,
  type InverterElectricalSpec,
  type PanelElectricalSpec,
  type PlacedPanelRef,
  type ProtectionPreferences,
  type SiteTemperatureAssumptions,
} from "./ElectricalModels.ts";

export function requireFinitePositive(value: unknown, field: string, code: ElectricalDesignError["code"] = "INVALID_NUMBER"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ElectricalDesignError(code, `${field} must be a finite number > 0.`);
  }
  return value;
}

export function requireFiniteNonNegative(value: unknown, field: string, code: ElectricalDesignError["code"] = "INVALID_NUMBER"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ElectricalDesignError(code, `${field} must be a finite number >= 0.`);
  }
  return value;
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ElectricalDesignError("INVALID_NUMBER", `${field} must be a finite number.`);
  }
  return value;
}

export function requireSystemType(value: unknown): ElectricalSystemType {
  if (typeof value !== "string" || !(ELECTRICAL_SYSTEM_TYPES as readonly string[]).includes(value)) {
    throw new ElectricalDesignError(
      "INVALID_SYSTEM_TYPE",
      `systemType must be one of: ${ELECTRICAL_SYSTEM_TYPES.join(", ")}.`
    );
  }
  return value as ElectricalSystemType;
}

export function validatePanelElectricalSpec(spec: PanelElectricalSpec): void {
  if (!spec || typeof spec !== "object") {
    throw new ElectricalDesignError("INVALID_PANEL_SPEC", "panelSpec is required.");
  }
  if (!spec.moduleId || !String(spec.moduleId).trim()) {
    throw new ElectricalDesignError("INVALID_PANEL_SPEC", "panelSpec.moduleId is required.");
  }
  requireFinitePositive(spec.wattageW, "panelSpec.wattageW", "INVALID_PANEL_SPEC");
  requireFinitePositive(spec.vocStcV, "panelSpec.vocStcV", "INVALID_PANEL_SPEC");
  requireFinitePositive(spec.vmpStcV, "panelSpec.vmpStcV", "INVALID_PANEL_SPEC");
  requireFinitePositive(spec.iscStcA, "panelSpec.iscStcA", "INVALID_PANEL_SPEC");
  requireFinitePositive(spec.impStcA, "panelSpec.impStcA", "INVALID_PANEL_SPEC");
  requireFiniteNumber(spec.tempCoeffVocPctPerC, "panelSpec.tempCoeffVocPctPerC");
  requireFiniteNumber(spec.tempCoeffVmpPctPerC, "panelSpec.tempCoeffVmpPctPerC");
  requireFiniteNumber(spec.tempCoeffIscPctPerC, "panelSpec.tempCoeffIscPctPerC");
  if (spec.tempCoeffVocPctPerC > 0 || spec.tempCoeffVocPctPerC < -1) {
    throw new ElectricalDesignError(
      "INVALID_PANEL_SPEC",
      "panelSpec.tempCoeffVocPctPerC must be in (-1, 0] %/°C."
    );
  }
  if (spec.tempCoeffVmpPctPerC > 0 || spec.tempCoeffVmpPctPerC < -1) {
    throw new ElectricalDesignError(
      "INVALID_PANEL_SPEC",
      "panelSpec.tempCoeffVmpPctPerC must be in (-1, 0] %/°C."
    );
  }
  if (spec.vmpStcV >= spec.vocStcV) {
    throw new ElectricalDesignError("INVALID_PANEL_SPEC", "panelSpec.vmpStcV must be < vocStcV.");
  }
  if (spec.impStcA > spec.iscStcA) {
    throw new ElectricalDesignError("INVALID_PANEL_SPEC", "panelSpec.impStcA must be <= iscStcA.");
  }
}

export function validateInverterElectricalSpec(spec: InverterElectricalSpec): void {
  if (!spec || typeof spec !== "object") {
    throw new ElectricalDesignError("INVALID_INVERTER_SPEC", "inverterSpec is required.");
  }
  if (!spec.inverterId || !String(spec.inverterId).trim()) {
    throw new ElectricalDesignError("INVALID_INVERTER_SPEC", "inverterSpec.inverterId is required.");
  }
  requireSystemType(spec.systemType);
  requireFinitePositive(spec.acRatingKw, "inverterSpec.acRatingKw", "INVALID_INVERTER_SPEC");
  requireFinitePositive(spec.maxDcVoltageV, "inverterSpec.maxDcVoltageV", "INVALID_INVERTER_SPEC");
  requireFinitePositive(spec.maxDcCurrentA, "inverterSpec.maxDcCurrentA", "INVALID_INVERTER_SPEC");
  requireFinitePositive(spec.efficiencyPct, "inverterSpec.efficiencyPct", "INVALID_INVERTER_SPEC");
  if (spec.efficiencyPct > 100) {
    throw new ElectricalDesignError("INVALID_INVERTER_SPEC", "inverterSpec.efficiencyPct must be <= 100.");
  }
  requireFinitePositive(spec.acNominalVoltageV, "inverterSpec.acNominalVoltageV", "INVALID_INVERTER_SPEC");
  if (spec.acPhases !== 1 && spec.acPhases !== 3) {
    throw new ElectricalDesignError("INVALID_INVERTER_SPEC", "inverterSpec.acPhases must be 1 or 3.");
  }
  if (!Array.isArray(spec.mppts) || spec.mppts.length < 1) {
    throw new ElectricalDesignError("INVALID_INVERTER_SPEC", "inverterSpec.mppts must be a non-empty array.");
  }
  for (let i = 0; i < spec.mppts.length; i += 1) {
    const m = spec.mppts[i];
    if (!m?.mpptId) {
      throw new ElectricalDesignError("INVALID_INVERTER_SPEC", `mppts[${i}].mpptId is required.`);
    }
    requireFinitePositive(m.minV, `mppts[${i}].minV`, "INVALID_INVERTER_SPEC");
    requireFinitePositive(m.maxV, `mppts[${i}].maxV`, "INVALID_INVERTER_SPEC");
    requireFinitePositive(m.maxCurrentA, `mppts[${i}].maxCurrentA`, "INVALID_INVERTER_SPEC");
    if (m.minV >= m.maxV) {
      throw new ElectricalDesignError("INVALID_INVERTER_SPEC", `mppts[${i}].minV must be < maxV.`);
    }
    if (m.maxV > spec.maxDcVoltageV) {
      throw new ElectricalDesignError(
        "INVALID_INVERTER_SPEC",
        `mppts[${i}].maxV cannot exceed inverter maxDcVoltageV.`
      );
    }
    if (m.maxStrings !== undefined) {
      requireFinitePositive(m.maxStrings, `mppts[${i}].maxStrings`, "INVALID_INVERTER_SPEC");
    }
  }
}

export function validateTemperatures(temps: SiteTemperatureAssumptions): void {
  if (!temps || typeof temps !== "object") {
    throw new ElectricalDesignError("INVALID_TEMPERATURE", "temperatures are required.");
  }
  requireFiniteNumber(temps.designTempMinC, "temperatures.designTempMinC");
  requireFiniteNumber(temps.designTempMaxC, "temperatures.designTempMaxC");
  if (temps.designTempMinC >= temps.designTempMaxC) {
    throw new ElectricalDesignError(
      "INVALID_TEMPERATURE",
      "designTempMinC must be < designTempMaxC."
    );
  }
  if (temps.designTempMinC < -40 || temps.designTempMaxC > 85) {
    throw new ElectricalDesignError(
      "INVALID_TEMPERATURE",
      "design temperatures must be within [-40, 85] °C."
    );
  }
  if (temps.ambientDesignC !== undefined) {
    requireFiniteNumber(temps.ambientDesignC, "temperatures.ambientDesignC");
  }
}

export function validateCableRoute(route: CableRouteInput): void {
  if (!route || typeof route !== "object") {
    throw new ElectricalDesignError("INVALID_CABLE_LENGTH", "cableRoute is required.");
  }
  requireFiniteNonNegative(route.dcLengthM, "cableRoute.dcLengthM", "INVALID_CABLE_LENGTH");
  requireFiniteNonNegative(route.acLengthM, "cableRoute.acLengthM", "INVALID_CABLE_LENGTH");
  if (route.dcCableMm2 !== undefined) {
    requireFinitePositive(route.dcCableMm2, "cableRoute.dcCableMm2", "INVALID_CABLE_SIZE");
  }
  if (route.acCableMm2 !== undefined) {
    requireFinitePositive(route.acCableMm2, "cableRoute.acCableMm2", "INVALID_CABLE_SIZE");
  }
  if (route.routeFactor !== undefined) {
    requireFinitePositive(route.routeFactor, "cableRoute.routeFactor", "INVALID_NUMBER");
  }
}

export function validatePlacedPanels(panels: PlacedPanelRef[]): void {
  if (!Array.isArray(panels) || panels.length === 0) {
    throw new ElectricalDesignError("INVALID_PLACED_PANELS", "placedPanels must be a non-empty array.");
  }
  const seen = new Set<string>();
  for (let i = 0; i < panels.length; i += 1) {
    const p = panels[i];
    if (!p || typeof p !== "object") {
      throw new ElectricalDesignError("INVALID_PLACED_PANELS", `placedPanels[${i}] must be an object.`);
    }
    const id = p.panelId;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new ElectricalDesignError(
        "INVALID_PANEL_ID",
        `placedPanels[${i}].panelId must be a non-empty string.`
      );
    }
    if (seen.has(id)) {
      throw new ElectricalDesignError(
        "DUPLICATE_PANEL_ID",
        `Duplicate placedPanels panelId "${id}" at index ${i}.`
      );
    }
    seen.add(id);
    requireFinitePositive(p.wattage, `placedPanels[${i}].wattage`, "INVALID_PLACED_PANELS");
  }
}

export function validateProtectionPreferences(protection: ProtectionPreferences | undefined): void {
  if (protection === undefined || protection === null) return;
  if (typeof protection !== "object") {
    throw new ElectricalDesignError("INVALID_NUMBER", "protection must be an object when provided.");
  }
  if (!("earthingConductorMm2" in protection) || protection.earthingConductorMm2 === undefined) {
    return;
  }
  const v = protection.earthingConductorMm2;
  if (v === null || typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new ElectricalDesignError(
      "INVALID_EARTHING_CONDUCTOR",
      "protection.earthingConductorMm2 must be a finite number > 0 when provided."
    );
  }
}

/** Validate entire design input before any calculation. */
export function validateElectricalDesignInput(input: ElectricalDesignInput): void {
  if (!input || typeof input !== "object") {
    throw new ElectricalDesignError("INVALID_NUMBER", "ElectricalDesignInput is required.");
  }
  requireSystemType(input.systemType);
  if (input.systemType !== input.inverterSpec?.systemType) {
    throw new ElectricalDesignError(
      "INVALID_SYSTEM_TYPE",
      "input.systemType must match inverterSpec.systemType."
    );
  }
  validatePlacedPanels(input.placedPanels);
  validatePanelElectricalSpec(input.panelSpec);
  validateInverterElectricalSpec(input.inverterSpec);
  validateTemperatures(input.temperatures);
  validateCableRoute(input.cableRoute);
  validateProtectionPreferences(input.protection);
  if (input.maxVoltageDropPct !== undefined) {
    requireFinitePositive(input.maxVoltageDropPct, "maxVoltageDropPct");
  }
}

/** Recursively assert every number in output is finite. */
export function assertFiniteElectricalResult(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ElectricalDesignError("NON_FINITE_OUTPUT", `${path} must be finite (got ${String(value)}).`);
    }
    return;
  }
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteElectricalResult(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertFiniteElectricalResult(child, `${path}.${key}`);
    }
  }
}
