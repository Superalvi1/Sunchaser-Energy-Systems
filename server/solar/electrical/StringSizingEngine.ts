/**
 * String sizing — Voc@Tmin / Vmp@Tmax vs inverter limits.
 * Reuses simulation voltageAtTemp. Fail closed when stringing impossible.
 */

import { voltageAtTemp } from "../simulation/ModulePowerModel.ts";
import {
  ElectricalDesignError,
  round4,
  type InverterElectricalSpec,
  type PanelElectricalSpec,
  type PlacedPanelRef,
  type StringGroup,
  type StringingResult,
} from "./ElectricalModels.ts";

export interface StringSizingEngineInput {
  panels: PlacedPanelRef[];
  panelSpec: PanelElectricalSpec;
  inverter: InverterElectricalSpec;
  designTempMinC: number;
  designTempMaxC: number;
  allowUnequalStrings?: boolean;
}

function pickModulesPerString(
  moduleCount: number,
  minM: number,
  maxM: number,
  allowUnequal: boolean
): { modulesPerString: number; stringCount: number } | null {
  if (minM > maxM) return null;
  // Prefer largest valid string length that divides (or nearly divides) module count.
  for (let m = maxM; m >= minM; m -= 1) {
    if (moduleCount % m === 0) {
      return { modulesPerString: m, stringCount: moduleCount / m };
    }
  }
  if (!allowUnequal) return null;
  // Unequal allowed: use max modules/string and leftover shorter strings later.
  const stringCount = Math.ceil(moduleCount / maxM);
  return { modulesPerString: maxM, stringCount };
}

export function computeElectricalStringing(input: StringSizingEngineInput): StringingResult {
  const { panels, panelSpec, inverter, designTempMinC, designTempMaxC } = input;
  const allowUnequal = input.allowUnequalStrings !== false;
  const moduleCount = panels.length;

  const vocModuleAtTminV = round4(
    voltageAtTemp(panelSpec.vocStcV, panelSpec.tempCoeffVocPctPerC, designTempMinC)
  );
  const vmpModuleAtTmaxV = round4(
    voltageAtTemp(panelSpec.vmpStcV, panelSpec.tempCoeffVmpPctPerC, designTempMaxC)
  );

  // Global MPPT window = intersection of all MPPT channels (conservative).
  const mpptMinV = Math.max(...inverter.mppts.map((m) => m.minV));
  const mpptMaxV = Math.min(...inverter.mppts.map((m) => m.maxV));

  const maxModulesPerString = Math.max(0, Math.floor(inverter.maxDcVoltageV / vocModuleAtTminV));
  const minByMppt = Math.max(1, Math.ceil(mpptMinV / vmpModuleAtTmaxV));
  const maxByMppt = Math.max(0, Math.floor(mpptMaxV / vmpModuleAtTmaxV));
  const maxModulesPerStringEff = Math.min(maxModulesPerString, maxByMppt);
  const minModulesPerString = minByMppt;

  const issues: string[] = [];

  if (maxModulesPerStringEff < 1 || minModulesPerString > maxModulesPerStringEff) {
    issues.push(
      `Stringing impossible: min modules/string ${minModulesPerString} exceeds max ${maxModulesPerStringEff} (Voc@Tmin=${vocModuleAtTminV}V, Vmp@Tmax=${vmpModuleAtTmaxV}V).`
    );
    return {
      valid: false,
      modulesPerString: 0,
      stringCount: 0,
      minModulesPerString,
      maxModulesPerString: maxModulesPerStringEff,
      vocModuleAtTminV,
      vmpModuleAtTmaxV,
      stringVocAtTminV: 0,
      stringVmpAtTmaxV: 0,
      dcCurrentPerStringA: round4(panelSpec.impStcA),
      totalDcCurrentA: 0,
      strings: [],
      issues,
    };
  }

  const pick = pickModulesPerString(moduleCount, minModulesPerString, maxModulesPerStringEff, allowUnequal);
  if (!pick) {
    issues.push("No valid modules-per-string configuration for the placed panel count.");
    return {
      valid: false,
      modulesPerString: 0,
      stringCount: 0,
      minModulesPerString,
      maxModulesPerString: maxModulesPerStringEff,
      vocModuleAtTminV,
      vmpModuleAtTmaxV,
      stringVocAtTminV: 0,
      stringVmpAtTmaxV: 0,
      dcCurrentPerStringA: round4(panelSpec.impStcA),
      totalDcCurrentA: 0,
      strings: [],
      issues,
    };
  }

  const { modulesPerString, stringCount } = pick;
  const strings: StringGroup[] = [];
  let cursor = 0;
  let remaining = moduleCount;

  for (let s = 0; s < stringCount; s += 1) {
    const len = allowUnequal
      ? Math.min(modulesPerString, remaining)
      : modulesPerString;
    if (len < minModulesPerString) {
      issues.push(`String ${s + 1} has ${len} modules below minimum ${minModulesPerString}.`);
    }
    const panelIds = panels.slice(cursor, cursor + len).map((p) => p.panelId);
    cursor += len;
    remaining -= len;

    const vocAtTminV = round4(len * vocModuleAtTminV);
    const vmpAtTmaxV = round4(len * vmpModuleAtTmaxV);
    const stringIssues: string[] = [];
    if (vocAtTminV > inverter.maxDcVoltageV + 0.01) {
      stringIssues.push("Voc@Tmin exceeds inverter max DC voltage.");
    }
    if (vmpAtTmaxV < mpptMinV - 0.01 || vmpAtTmaxV > mpptMaxV + 0.01) {
      stringIssues.push("Vmp@Tmax outside MPPT window.");
    }
    strings.push({
      stringId: `string-${s + 1}`,
      mpptId: "", // filled by MpptAllocator
      modulesPerString: len,
      panelIds,
      vocAtTminV,
      vmpAtTmaxV,
      iscA: round4(panelSpec.iscStcA),
      impA: round4(panelSpec.impStcA),
      valid: stringIssues.length === 0,
      issues: stringIssues,
    });
  }

  const stringVocAtTminV = strings.length ? Math.max(...strings.map((s) => s.vocAtTminV)) : 0;
  const stringVmpAtTmaxV = strings.length ? Math.min(...strings.map((s) => s.vmpAtTmaxV)) : 0;
  const allValid = strings.every((s) => s.valid) && issues.length === 0;

  if (!allValid && issues.length === 0) {
    issues.push(...strings.flatMap((s) => s.issues));
  }

  return {
    valid: allValid,
    modulesPerString,
    stringCount: strings.length,
    minModulesPerString,
    maxModulesPerString: maxModulesPerStringEff,
    vocModuleAtTminV,
    vmpModuleAtTmaxV,
    stringVocAtTminV,
    stringVmpAtTmaxV,
    dcCurrentPerStringA: round4(panelSpec.impStcA),
    totalDcCurrentA: round4(panelSpec.impStcA * strings.length),
    strings,
    issues,
  };
}

/** Throw when caller requires valid stringing only. */
export function requireValidStringing(result: StringingResult): StringingResult {
  if (!result.valid) {
    throw new ElectricalDesignError(
      "STRINGING_IMPOSSIBLE",
      result.issues[0] ?? "Stringing is invalid."
    );
  }
  return result;
}
