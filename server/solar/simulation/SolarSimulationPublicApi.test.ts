/**
 * Public API boundary tests — ensures index.ts does not export unsafe
 * lower-level calculators that bypass centralized validation.
 */

import assert from "node:assert/strict";
import * as publicApi from "./index.ts";
import {
  runSolarSimulation,
  validateAndNormalizeSimulationInput,
  assertFiniteSimulationResult,
  SolarSimulationValidationError,
  SolarSimulationInternalError,
  SUPPORTED_SIMULATION_SIZES_KW,
  SIMULATION_SYSTEM_TYPES,
  type SolarSimulationInput,
} from "./index.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

/** Lower-level calculators that must NOT appear on the public barrel. */
const BLOCKED_EXPORTS = [
  "normalizeModule",
  "normalizeInverter",
  "computeStringSizing",
  "computeFinancialYield",
  "hdkrPoaWm2",
  "buildPoaSeries8760",
  "buildWeatherSeries8760",
  "buildSunPositionSeries",
  "buildCellTempSeries8760",
  "buildArrayDcSeries8760",
  "buildAcSeries8760",
  "inverterAcPowerW",
  "moduleDcPowerW",
  "computeVoltageDrop",
  "computeDcAcVoltageDrop",
  "computeCableEnergyLossKwhYear",
  "computeSystemCableLossKwhYear",
  "computePerformanceRatio",
  "faimanCellTempC",
  "temperatureDerateFactor",
  "voltageAtTemp",
  "decomposeGhiToDniDhi",
  "aggregateMonthlyFromHourly",
  "round4",
  "safeFinite",
  "moduleCountForSystemKw",
  "defaultInverterForSizeKw",
  "LAHORE_DEFAULTS",
] as const;

for (const name of BLOCKED_EXPORTS) {
  check(`index.ts does not export unsafe ${name}`, () => !(name in publicApi));
}

/** Safe exports that callers are expected to use. */
const ALLOWED_EXPORTS = [
  "runSolarSimulation",
  "validateAndNormalizeSimulationInput",
  "assertFiniteSimulationResult",
  "SolarSimulationValidationError",
  "SolarSimulationInternalError",
  "HOURS_PER_YEAR",
  "SIMULATION_ENGINE_TIMESTAMP",
  "SUPPORTED_SIMULATION_SIZES_KW",
  "SIMULATION_SYSTEM_TYPES",
  "MONTH_LABELS",
] as const;

for (const name of ALLOWED_EXPORTS) {
  check(`index.ts exports safe public ${name}`, () => name in publicApi);
}

check("runSolarSimulation is the only simulation runner on public API", () => {
  const fns = Object.keys(publicApi).filter(
    (k) => typeof (publicApi as Record<string, unknown>)[k] === "function"
  );
  const runners = fns.filter((k) => k.startsWith("run") || k.startsWith("build") || k.startsWith("compute"));
  return runners.length === 1 && runners[0] === "runSolarSimulation";
});

const BASE: SolarSimulationInput = { systemSizeKw: 5, systemType: "on-grid" };

function expectValidationError(code: string, input: SolarSimulationInput): boolean {
  try {
    runSolarSimulation(input);
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError && e.code === code;
  }
}

check("public runSolarSimulation rejects module.wattageW NaN", () =>
  expectValidationError("INVALID_MODULE_WATTAGE", { ...BASE, module: { wattageW: NaN } })
);
check("public runSolarSimulation rejects inverter.efficiencyPct Infinity", () =>
  expectValidationError("INVALID_INVERTER_EFFICIENCY", { ...BASE, inverter: { efficiencyPct: Infinity } })
);
check("public runSolarSimulation rejects site.latitudeDeg Infinity", () =>
  expectValidationError("INVALID_LATITUDE", { ...BASE, site: { latitudeDeg: Infinity } })
);

check("public validateAndNormalizeSimulationInput rejects before any calc", () => {
  try {
    validateAndNormalizeSimulationInput({ ...BASE, module: { vocStcV: 0 } });
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError && e.code === "INVALID_MODULE_VOC";
  }
});

check("public API cannot bypass validation via blocked export normalizeModule", () => {
  const mod = (publicApi as Record<string, unknown>).normalizeModule;
  return mod === undefined;
});
check("public API cannot bypass validation via blocked export hdkrPoaWm2", () => {
  const fn = (publicApi as Record<string, unknown>).hdkrPoaWm2;
  return fn === undefined;
});
check("public API cannot bypass validation via blocked export computeStringSizing", () => {
  const fn = (publicApi as Record<string, unknown>).computeStringSizing;
  return fn === undefined;
});

check("successful public runSolarSimulation output is fully finite", () => {
  for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
    for (const systemType of SIMULATION_SYSTEM_TYPES) {
      const result = runSolarSimulation({ systemSizeKw: sizeKw, systemType });
      assertFiniteSimulationResult(result);
    }
  }
  return true;
});

check("assertFiniteSimulationResult is exported and catches injected NaN", () => {
  const result = runSolarSimulation(BASE);
  result.annualAcKwh = NaN;
  try {
    assertFiniteSimulationResult(result);
    return false;
  } catch (e) {
    return e instanceof SolarSimulationInternalError;
  }
});

check("public barrel export count is bounded (no wildcard re-exports)", () => {
  const keys = Object.keys(publicApi);
  // Types are erased at runtime; only values/constants/functions appear.
  return keys.length <= 12;
});

console.log(`\nSolar simulation public API tests: ${pass} passed`);
