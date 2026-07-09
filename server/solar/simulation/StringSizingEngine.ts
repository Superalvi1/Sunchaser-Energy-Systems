/**
 * DC string sizing — min/max modules per string vs inverter MPPT and max DC voltage.
 */

import { LAHORE_DEFAULTS, moduleCountForSystemKw, round4, type InverterInput, type ModuleInput, type SimulationSystemSizeKw, type StringSizingResult } from "./SolarSimulationModels.ts";
import { normalizeModule, voltageAtTemp } from "./ModulePowerModel.ts";
import { normalizeInverter } from "./InverterClipping.ts";

export interface StringSizingInput {
  systemSizeKw: SimulationSystemSizeKw;
  module?: ModuleInput;
  inverter?: InverterInput;
  coldDesignTempC?: number;
  hotDesignTempC?: number;
}

export function computeStringSizing(input: StringSizingInput): StringSizingResult {
  const module = normalizeModule(input.module);
  const inverter = normalizeInverter(input.systemSizeKw, input.inverter);
  const coldT = input.coldDesignTempC ?? LAHORE_DEFAULTS.designTempMinC;
  const hotT = input.hotDesignTempC ?? LAHORE_DEFAULTS.designTempMaxC;
  const warnings: string[] = [];

  const moduleCount = moduleCountForSystemKw(input.systemSizeKw, module.wattageW);
  const vocAtTminV = voltageAtTemp(module.vocStcV, module.tempCoeffVocPctPerC, coldT);
  const vmpAtTmaxV = voltageAtTemp(module.vmpStcV, module.tempCoeffVocPctPerC, hotT);

  const maxModulesPerString = Math.max(1, Math.floor(inverter.maxDcVoltageV / vocAtTminV));
  const minModulesPerString = Math.max(1, Math.ceil(inverter.mpptMinV / vmpAtTmaxV));

  if (minModulesPerString > maxModulesPerString) {
    warnings.push(
      `String sizing conflict: min ${minModulesPerString} modules (hot MPPT) exceeds max ${maxModulesPerString} (cold Voc).`
    );
  }

  let modulesPerString = Math.min(maxModulesPerString, Math.max(minModulesPerString, Math.ceil(moduleCount / 2)));
  if (modulesPerString * vocAtTminV > inverter.maxDcVoltageV) {
    modulesPerString = maxModulesPerString;
    warnings.push("Adjusted modules per string to respect max DC voltage at cold temperature.");
  }
  if (modulesPerString * vmpAtTmaxV < inverter.mpptMinV) {
    modulesPerString = minModulesPerString;
    warnings.push("Adjusted modules per string to reach MPPT minimum at hot temperature.");
  }

  const stringCount = Math.max(1, Math.ceil(moduleCount / modulesPerString));
  const stringVocColdV = round4(modulesPerString * vocAtTminV);
  const stringVmpHotV = round4(modulesPerString * vmpAtTmaxV);

  const withinMaxDc = stringVocColdV <= inverter.maxDcVoltageV + 0.01;
  const withinMppt = stringVmpHotV >= inverter.mpptMinV - 0.01 && stringVmpHotV <= inverter.mpptMaxV + 0.01;

  if (!withinMaxDc) warnings.push("String Voc at cold exceeds inverter max DC voltage.");
  if (!withinMppt) warnings.push("String Vmp at hot outside inverter MPPT window.");

  return {
    moduleCount,
    modulesPerString,
    stringCount,
    minModulesPerString,
    maxModulesPerString,
    vocAtTminV: round4(vocAtTminV),
    vmpAtTmaxV: round4(vmpAtTmaxV),
    stringVocColdV,
    stringVmpHotV,
    withinMppt,
    withinMaxDc,
    warnings,
  };
}
