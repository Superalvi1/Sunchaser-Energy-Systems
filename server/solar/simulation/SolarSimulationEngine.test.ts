import assert from "node:assert/strict";
import { runSolarSimulation } from "./SolarSimulationEngine.ts";
import { buildSunPositionSeries, psaDeclinationRad, assertSunElevationBounds } from "./SunPositionPSA.ts";
import { buildPoaSeries8760, assertIrradianceNonNegative, hdkrPoaWm2 } from "./IrradianceTransposition.ts";
import { faimanCellTempC, temperatureDerateFactor, assertCellTempReasonable, buildCellTempSeries8760 } from "./TemperatureFaiman.ts";
import { normalizeModule, moduleDcPowerW, voltageAtTemp, buildArrayDcSeries8760 } from "./ModulePowerModel.ts";
import { inverterAcPowerW, normalizeInverter, systemAvailabilityFactor, assertNoNanInfinity } from "./InverterClipping.ts";
import { computeStringSizing } from "./StringSizingEngine.ts";
import { computeVoltageDrop, computeDcAcVoltageDrop } from "./VoltageDropCalculator.ts";
import { computeCableEnergyLossKwhYear } from "./CableLossCalculator.ts";
import { buildWeatherSeries8760, aggregateMonthlyFromHourly } from "./WeatherSeries.ts";
import { computePerformanceRatio } from "./PerformanceRatio.ts";
import { computeFinancialYield } from "./FinancialYieldModel.ts";
import {
  HOURS_PER_YEAR,
  LAHORE_DEFAULTS,
  SUPPORTED_SIMULATION_SIZES_KW,
  SIMULATION_SYSTEM_TYPES,
  SolarSimulationValidationError,
  SolarSimulationInternalError,
  moduleCountForSystemKw,
} from "./SolarSimulationModels.ts";
import {
  validateAndNormalizeSimulationInput,
  assertFiniteSimulationResult,
} from "./SolarSimulationValidation.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

/** Assert that running the sim with `input` throws a validation error of `code`. */
function expectRejected(code: string, input: unknown): boolean {
  try {
    runSolarSimulation(input as never);
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError && e.code === code;
  }
}

check("PSA declination June positive", () => psaDeclinationRad(172) > 0.35);
check("PSA declination December negative", () => psaDeclinationRad(355) < -0.08);
check("sun elevation positive at Lahore noon June", () => {
  const series = buildSunPositionSeries(31.52, 74.35, 5);
  const juneNoon = series[172 * 24 + 12];
  return juneNoon.elevationDeg > 50;
});
check("sun position bounds all 8760 hours", () => {
  const series = buildSunPositionSeries(31.52, 74.35, 5);
  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    if (!assertSunElevationBounds(series[h])) return false;
  }
  return true;
});

check("weather series length 8760", () => {
  const w = buildWeatherSeries8760({ latitudeDeg: 31.52 });
  return w.ghiWm2.length === HOURS_PER_YEAR && w.ambientTempC.length === HOURS_PER_YEAR;
});
check("weather defaults warn meta", () => {
  const w = buildWeatherSeries8760({ latitudeDeg: 31.52 });
  return w.meta.usedDefaultGhi && w.meta.usedDefaultTemp;
});
check("hourly GHI invalid length throws", () => {
  try {
    buildWeatherSeries8760({ latitudeDeg: 31.52, hourly: { ghiWm2: [1, 2, 3] } });
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError && e.code === "INVALID_WEATHER_LENGTH";
  }
});

check("HDKR POA non-negative", () => {
  const poa = hdkrPoaWm2(800, 600, 200, 0.8, 30, 15, 0.2);
  return poa >= 0;
});
check("POA series all non-negative", () => {
  const weather = buildWeatherSeries8760({ latitudeDeg: 31.52 });
  const sun = buildSunPositionSeries(31.52, 74.35, 5);
  const poa = buildPoaSeries8760({
    ghiWm2: weather.ghiWm2,
    dniWm2: weather.dniWm2,
    dhiWm2: weather.dhiWm2,
    sunPositions: sun,
    tiltDeg: 15,
    azimuthDeg: 180,
    albedo: 0.2,
  });
  return assertIrradianceNonNegative(poa);
});

check("Faiman cell temp rises with POA", () => {
  const low = faimanCellTempC(200, 25, 2.5);
  const high = faimanCellTempC(900, 25, 2.5);
  return high > low;
});
check("temp derate < 1 at hot cell temp", () => {
  const f = temperatureDerateFactor(55, -0.35);
  return f < 1 && f > 0.7;
});
check("cell temp series reasonable", () => {
  const weather = buildWeatherSeries8760({ latitudeDeg: 31.52 });
  const sun = buildSunPositionSeries(31.52, 74.35, 5);
  const poa = buildPoaSeries8760({
    ghiWm2: weather.ghiWm2, dniWm2: weather.dniWm2, dhiWm2: weather.dhiWm2,
    sunPositions: sun, tiltDeg: 15, azimuthDeg: 180, albedo: 0.2,
  });
  const cell = buildCellTempSeries8760(poa, weather.ambientTempC, weather.windSpeedMs);
  return assertCellTempReasonable(cell);
});

check("voltageAtTemp cold Voc > STC Voc for negative coeff", () => {
  const m = normalizeModule();
  return voltageAtTemp(m.vocStcV, m.tempCoeffVocPctPerC, 0) > m.vocStcV;
});
check("module count 5kW 580W", () => moduleCountForSystemKw(5) === 9);
check("module DC power at STC 1000 W/m²", () => {
  const m = normalizeModule();
  const p = moduleDcPowerW(1000, m.wattageW, 25, m.tempCoeffPmaxPctPerC);
  return Math.abs(p - m.wattageW) < 1;
});

check("inverter clipping when DC exceeds AC rating", () => {
  const inv = normalizeInverter(5);
  const c = inverterAcPowerW(8000, inv);
  return c.clipW > 0 && c.acW <= inv.acRatingKw * 1000 + 1;
});
check("hybrid availability < on-grid", () =>
  systemAvailabilityFactor("hybrid") < systemAvailabilityFactor("on-grid")
);

check("string sizing 5kW within bounds", () => {
  const s = computeStringSizing({ systemSizeKw: 5 });
  return s.moduleCount >= 8 && s.modulesPerString >= 1 && s.stringCount >= 1;
});
check("string Voc cold below max DC for 5kW default", () => {
  const s = computeStringSizing({ systemSizeKw: 5 });
  return s.withinMaxDc;
});

check("voltage drop increases with length", () => {
  const a = computeVoltageDrop({ currentA: 10, lengthM: 10, crossSectionMm2: 6, nominalVoltageV: 400 });
  const b = computeVoltageDrop({ currentA: 10, lengthM: 30, crossSectionMm2: 6, nominalVoltageV: 400 });
  return b.voltageDropV > a.voltageDropV;
});
check("DC AC voltage drop both non-negative", () => {
  const v = computeDcAcVoltageDrop({
    dcCurrentA: 12, acCurrentA: 20, dcCableLengthM: 50, acCableLengthM: 15,
    dcCableMm2: 6, acCableMm2: 4, dcStringVoltageV: 350,
  });
  return v.dcVoltageDropV >= 0 && v.acVoltageDropV >= 0;
});

check("cable loss increases with current", () => {
  const a = computeCableEnergyLossKwhYear({ currentA: 5, lengthM: 40, crossSectionMm2: 6, operatingHoursPerYear: 1000 });
  const b = computeCableEnergyLossKwhYear({ currentA: 15, lengthM: 40, crossSectionMm2: 6, operatingHoursPerYear: 1000 });
  return b > a;
});

check("8760 DC series no NaN", () => {
  const weather = buildWeatherSeries8760({ latitudeDeg: 31.52 });
  const sun = buildSunPositionSeries(31.52, 74.35, 5);
  const poa = buildPoaSeries8760({
    ghiWm2: weather.ghiWm2, dniWm2: weather.dniWm2, dhiWm2: weather.dhiWm2,
    sunPositions: sun, tiltDeg: 15, azimuthDeg: 180, albedo: 0.2,
  });
  const cell = buildCellTempSeries8760(poa, weather.ambientTempC, weather.windSpeedMs);
  const dc = buildArrayDcSeries8760(poa, cell, 9, normalizeModule());
  return assertNoNanInfinity(dc.dcPowerW);
});

check("monthly aggregation 12 months", () => {
  const hourly = new Float64Array(HOURS_PER_YEAR).fill(1);
  const m = aggregateMonthlyFromHourly(hourly);
  return m.length === 12 && m.every((v) => v > 0);
});

check("performance ratio bounded", () => {
  const pr = computePerformanceRatio({ acEnergyKwh: 7000, arrayDcKw: 5.22, referencePoaKwhM2Year: 1600 });
  return pr.performanceRatio > 0 && pr.performanceRatio <= 1.2;
});

check("financial yearly savings positive", () => {
  const f = computeFinancialYield({ monthlyAcKwh: Array(12).fill(500), electricityTariffPkrPerKwh: 45, systemCapexPkr: 900000 });
  return f.yearlySavingsPkr > 0 && f.simplePaybackYears !== null && f.simplePaybackYears > 0;
});

check("runSolarSimulation Lahore defaults deterministic", () => {
  const a = runSolarSimulation({ systemSizeKw: 5, systemType: "on-grid" });
  const b = runSolarSimulation({ systemSizeKw: 5, systemType: "on-grid" });
  return a.annualAcKwh === b.annualAcKwh && a.generatedAt === b.generatedAt;
});
check("runSolarSimulation returns assumptions when using defaults", () => {
  const r = runSolarSimulation({ systemSizeKw: 3, systemType: "on-grid" });
  return r.assumptions.length > 5 && r.warnings.length > 0;
});
check("runSolarSimulation annual ≈ monthly sum", () => {
  const r = runSolarSimulation({ systemSizeKw: 8, systemType: "on-grid" });
  const sum = r.monthly.reduce((s, m) => s + m.acKwh, 0);
  return Math.abs(sum - r.annualAcKwh) < 1;
});
check("off-grid yield < on-grid same size", () => {
  const on = runSolarSimulation({ systemSizeKw: 10, systemType: "on-grid" });
  const off = runSolarSimulation({ systemSizeKw: 10, systemType: "off-grid" });
  return off.annualAcKwh < on.annualAcKwh;
});
check("custom monthly GHI input recorded", () => {
  const custom = runSolarSimulation({
    systemSizeKw: 5, systemType: "on-grid",
    site: { monthly: { dailyGhiKwhM2: Array(12).fill(7) } },
  });
  return custom.annualAcKwh > 0 && custom.assumptions.some((a) => a.id === "weather.ghi" && a.source === "input");
});
check("invalid size throws validation error", () => {
  try {
    runSolarSimulation({ systemSizeKw: 7 as 5, systemType: "on-grid" });
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError;
  }
});
check("invalid shading throws", () => {
  try {
    runSolarSimulation({ systemSizeKw: 5, systemType: "on-grid", array: { shadingLossFraction: 1.5 } });
    return false;
  } catch (e) {
    return e instanceof SolarSimulationValidationError && e.code === "INVALID_SHADING";
  }
});
check("result has no NaN in key outputs", () => {
  const r = runSolarSimulation({ systemSizeKw: 5, systemType: "on-grid" });
  return [r.annualAcKwh, r.annualDcKwh, r.performanceRatio, r.clippingLossKwh].every(Number.isFinite);
});
check("result includes loss breakdown and cable", () => {
  const r = runSolarSimulation({ systemSizeKw: 5, systemType: "on-grid" });
  return r.losses.totalLossKwh >= 0 && r.cable.annualCableLossKwh >= 0 && r.stringSizing.moduleCount > 0;
});

// ---------------------------------------------------------------------------
// Numeric-safety validation (audit fix) — reproduced invalid-input cases.
// ---------------------------------------------------------------------------

const BASE = { systemSizeKw: 5 as const, systemType: "on-grid" as const };

check("wattage 0 rejected", () => expectRejected("INVALID_MODULE_WATTAGE", { ...BASE, module: { wattageW: 0 } }));
check("wattage NaN rejected", () => expectRejected("INVALID_MODULE_WATTAGE", { ...BASE, module: { wattageW: NaN } }));
check("wattage Infinity rejected", () => expectRejected("INVALID_MODULE_WATTAGE", { ...BASE, module: { wattageW: Infinity } }));
check("Voc 0 rejected", () => expectRejected("INVALID_MODULE_VOC", { ...BASE, module: { vocStcV: 0 } }));
check("Vmp negative rejected", () => expectRejected("INVALID_MODULE_VMP", { ...BASE, module: { vmpStcV: -1 } }));
check("Isc 0 rejected", () => expectRejected("INVALID_MODULE_ISC", { ...BASE, module: { iscStcA: 0 } }));
check("Imp NaN rejected", () => expectRejected("INVALID_MODULE_IMP", { ...BASE, module: { impStcA: NaN } }));

check("efficiency Infinity rejected", () => expectRejected("INVALID_INVERTER_EFFICIENCY", { ...BASE, inverter: { efficiencyPct: Infinity } }));
check("efficiency 0 rejected", () => expectRejected("INVALID_INVERTER_EFFICIENCY", { ...BASE, inverter: { efficiencyPct: 0 } }));
check("efficiency >100 rejected", () => expectRejected("INVALID_INVERTER_EFFICIENCY", { ...BASE, inverter: { efficiencyPct: 120 } }));
check("inverter rating NaN rejected", () => expectRejected("INVALID_INVERTER_RATING", { ...BASE, inverter: { acRatingKw: NaN } }));

check("tariff Infinity rejected", () => expectRejected("INVALID_TARIFF", { ...BASE, finance: { electricityTariffPkrPerKwh: Infinity } }));
check("tariff negative rejected", () => expectRejected("INVALID_TARIFF", { ...BASE, finance: { electricityTariffPkrPerKwh: -5 } }));
check("capex -Infinity rejected", () => expectRejected("INVALID_CAPEX", { ...BASE, finance: { systemCapexPkr: -Infinity } }));
check("selfConsumption >1 rejected", () => expectRejected("INVALID_SELF_CONSUMPTION", { ...BASE, finance: { selfConsumptionFraction: 1.2 } }));

check("latitude Infinity rejected", () => expectRejected("INVALID_LATITUDE", { ...BASE, site: { latitudeDeg: Infinity } }));
check("latitude out of range rejected", () => expectRejected("INVALID_LATITUDE", { ...BASE, site: { latitudeDeg: 120 } }));
check("longitude NaN rejected", () => expectRejected("INVALID_LONGITUDE", { ...BASE, site: { longitudeDeg: NaN } }));

check("azimuth NaN rejected", () => expectRejected("INVALID_AZIMUTH", { ...BASE, array: { azimuthDeg: NaN } }));
check("azimuth >360 rejected", () => expectRejected("INVALID_AZIMUTH", { ...BASE, array: { azimuthDeg: 400 } }));
check("albedo Infinity rejected", () => expectRejected("INVALID_ALBEDO", { ...BASE, array: { albedo: Infinity } }));
check("albedo >1 rejected", () => expectRejected("INVALID_ALBEDO", { ...BASE, array: { albedo: 1.5 } }));
check("tilt >90 rejected", () => expectRejected("INVALID_TILT", { ...BASE, array: { tiltDeg: 95 } }));
check("shading >1 rejected", () => expectRejected("INVALID_SHADING", { ...BASE, array: { shadingLossFraction: 1.5 } }));

check("negative DC cable length rejected", () => expectRejected("INVALID_CABLE_LENGTH", { ...BASE, cables: { dcCableLengthM: -10 } }));
check("negative AC cable length rejected", () => expectRejected("INVALID_CABLE_LENGTH", { ...BASE, cables: { acCableLengthM: -1 } }));
check("cable section 0 rejected", () => expectRejected("INVALID_CABLE_SECTION", { ...BASE, cables: { dcCableMm2: 0 } }));

check("invalid hourly weather (NaN) rejected", () => {
  const ghi = new Float64Array(HOURS_PER_YEAR).fill(500);
  ghi[100] = NaN;
  return expectRejected("INVALID_WEATHER_GHI", { ...BASE, site: { hourly: { ghiWm2: ghi } } });
});
check("invalid hourly weather (negative irradiance) rejected", () => {
  const ghi = new Float64Array(HOURS_PER_YEAR).fill(500);
  ghi[10] = -5;
  return expectRejected("INVALID_WEATHER_GHI", { ...BASE, site: { hourly: { ghiWm2: ghi } } });
});
check("invalid hourly weather (wrong length) rejected", () =>
  expectRejected("INVALID_WEATHER_GHI", { ...BASE, site: { hourly: { ghiWm2: [1, 2, 3] } } })
);
check("invalid monthly weather (Infinity) rejected", () => {
  const m = Array(12).fill(5);
  m[3] = Infinity;
  return expectRejected("INVALID_WEATHER_GHI", { ...BASE, site: { monthly: { dailyGhiKwhM2: m } } });
});
check("invalid weather wind (NaN) rejected", () => {
  const wind = new Float64Array(HOURS_PER_YEAR).fill(2);
  wind[5] = NaN;
  return expectRejected("INVALID_WEATHER_WIND", { ...BASE, site: { hourly: { windSpeedMs: wind } } });
});

check("size NaN rejected", () => expectRejected("INVALID_SIZE", { systemSizeKw: NaN, systemType: "on-grid" }));
check("unsupported size rejected", () => expectRejected("UNSUPPORTED_SIZE", { systemSizeKw: 7, systemType: "on-grid" }));
check("unsupported type rejected", () => expectRejected("UNSUPPORTED_TYPE", { systemSizeKw: 5, systemType: "micro-grid" }));

check("no calculation runs after validation failure (fails at gate, no result)", () => {
  // Invalid input must throw a *validation* error (the gate), never a pipeline
  // SolarSimulationInternalError and never a returned result. If calculations
  // ran on the NaN wattage, we'd instead see an internal error or a NaN result.
  let result: unknown;
  let error: unknown;
  try {
    result = runSolarSimulation({ ...BASE, module: { wattageW: NaN } } as never);
  } catch (e) {
    error = e;
  }
  return (
    result === undefined &&
    error instanceof SolarSimulationValidationError &&
    !(error instanceof SolarSimulationInternalError)
  );
});

check("validateAndNormalize returns input on valid", () => {
  const out = validateAndNormalizeSimulationInput({ ...BASE });
  return out.systemSizeKw === 5 && out.systemType === "on-grid";
});
check("validateAndNormalize does not mutate/replace provided values", () => {
  const out = validateAndNormalizeSimulationInput({ ...BASE, module: { wattageW: 600 } });
  return out.module?.wattageW === 600;
});

check("successful output contains only finite numbers (all sizes/types)", () => {
  for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
    for (const systemType of SIMULATION_SYSTEM_TYPES) {
      const r = runSolarSimulation({ systemSizeKw: sizeKw, systemType });
      // Would throw SolarSimulationInternalError if any numeric field were non-finite.
      assertFiniteSimulationResult(r);
    }
  }
  return true;
});

check("assertFiniteSimulationResult throws on injected NaN", () => {
  const r = runSolarSimulation({ ...BASE }) as unknown as { annualAcKwh: number };
  r.annualAcKwh = NaN;
  try {
    assertFiniteSimulationResult(r);
    return false;
  } catch (e) {
    return e instanceof SolarSimulationInternalError && e.code === "NON_FINITE_OUTPUT";
  }
});
check("assertFiniteSimulationResult throws on injected Infinity in nested field", () => {
  const r = runSolarSimulation({ ...BASE });
  r.losses.temperatureKwh = Infinity;
  try {
    assertFiniteSimulationResult(r);
    return false;
  } catch (e) {
    return e instanceof SolarSimulationInternalError && e.path.includes("losses.temperatureKwh");
  }
});
check("assertFiniteSimulationResult allows null payback", () => {
  const r = runSolarSimulation({ ...BASE, finance: { systemCapexPkr: 0 } });
  assertFiniteSimulationResult(r);
  return r.finance.simplePaybackYears === null;
});

console.log(`\nSolar simulation engine unit tests: ${pass} passed`);
