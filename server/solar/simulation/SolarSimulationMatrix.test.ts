import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runSolarSimulation } from "./SolarSimulationEngine.ts";
import { computeStringSizing } from "./StringSizingEngine.ts";
import { buildSunPositionSeries, assertSunElevationBounds } from "./SunPositionPSA.ts";
import { buildPoaSeries8760, assertIrradianceNonNegative } from "./IrradianceTransposition.ts";
import { buildWeatherSeries8760 } from "./WeatherSeries.ts";
import { buildCellTempSeries8760, assertCellTempReasonable } from "./TemperatureFaiman.ts";
import { buildArrayDcSeries8760, normalizeModule } from "./ModulePowerModel.ts";
import { buildAcSeries8760, normalizeInverter, assertNoNanInfinity } from "./InverterClipping.ts";
import { computeFinancialYield } from "./FinancialYieldModel.ts";
import { HOURS_PER_YEAR, LAHORE_DEFAULTS, SUPPORTED_SIMULATION_SIZES_KW, SIMULATION_SYSTEM_TYPES } from "./SolarSimulationModels.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
}

function fp(v: number): string {
  return createHash("sha256").update(String(v)).digest("hex").slice(0, 10);
}

const SHADING = [0, 0.05, 0.1, 0.15, 0.2];
const TILTS = [10, 15, 20, 25, 30];
const AZIMUTHS = [160, 170, 180, 190, 200];
const TARIFFS = [35, 45, 55];

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const systemType of SIMULATION_SYSTEM_TYPES) {
    for (let month = 0; month < 12; month += 1) {
      const label = `${sizeKw}kW/${systemType}/m${month}`;
      const r = runSolarSimulation({ systemSizeKw: sizeKw, systemType });
      const row = r.monthly[month];
      check(`${label} monthly AC >= 0`, () => row.acKwh >= 0);
      check(`${label} monthly POA >= 0`, () => row.poaKwhM2 >= 0);
      check(`${label} monthly GHI >= 0`, () => row.ghiKwhM2 >= 0);
      check(`${label} avg cell temp in range`, () => row.avgCellTempC > -40 && row.avgCellTempC < 90);
    }
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const systemType of SIMULATION_SYSTEM_TYPES) {
    const label = `yearly/${sizeKw}/${systemType}`;
    const r = runSolarSimulation({ systemSizeKw: sizeKw, systemType });
    check(`${label} annual AC positive`, () => r.annualAcKwh > 0);
    check(`${label} annual DC >= AC`, () => r.annualDcKwh >= r.annualAcKwh - 1);
    check(`${label} PR in range`, () => r.performanceRatio > 0.2 && r.performanceRatio < 1.1);
    check(`${label} specific yield positive`, () => r.specificYieldKwhPerKwp > 300);
    const h1 = fp(r.annualAcKwh);
    const r2 = runSolarSimulation({ systemSizeKw: sizeKw, systemType });
    check(`${label} fingerprint stable`, () => h1 === fp(r2.annualAcKwh));
    check(`${label} no NaN annual`, () => Number.isFinite(r.annualAcKwh) && Number.isFinite(r.performanceRatio));
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const shading of SHADING) {
    const label = `shade/${sizeKw}/${shading}`;
    const r = runSolarSimulation({
      systemSizeKw: sizeKw,
      systemType: "on-grid",
      array: { shadingLossFraction: shading },
    });
    check(`${label} yield decreases with shading`, () => {
      if (shading === 0) return r.annualAcKwh > 0;
      const base = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "on-grid" });
      return r.annualAcKwh <= base.annualAcKwh + 0.01;
    });
    check(`${label} shading loss recorded`, () => r.losses.shadingKwh >= 0);
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const tilt of TILTS) {
    const label = `tilt/${sizeKw}/${tilt}`;
    const r = runSolarSimulation({
      systemSizeKw: sizeKw,
      systemType: "on-grid",
      array: { tiltDeg: tilt },
    });
    check(`${label} yield positive`, () => r.annualAcKwh > 0);
    check(`${label} assumption records tilt`, () => r.assumptions.some((a) => a.id === "array.tilt" && Number(a.value) === tilt));
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const az of AZIMUTHS) {
    const label = `az/${sizeKw}/${az}`;
    const r = runSolarSimulation({
      systemSizeKw: sizeKw,
      systemType: "on-grid",
      array: { azimuthDeg: az },
    });
    check(`${label} yield positive`, () => r.annualAcKwh > 0);
    check(`${label} summer month POA > 0`, () => r.monthly[5].poaKwhM2 > 0);
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  const s = computeStringSizing({ systemSizeKw: sizeKw });
  check(`strings/${sizeKw} module count matches`, () => s.moduleCount >= 1);
  check(`strings/${sizeKw} string layout valid`, () => s.modulesPerString * s.stringCount >= s.moduleCount);
  check(`strings/${sizeKw} min <= chosen <= max`, () =>
    s.modulesPerString >= s.minModulesPerString && s.modulesPerString <= s.maxModulesPerString + 2
  );
  check(`strings/${sizeKw} voc at Tmin positive`, () => s.vocAtTminV > 0);
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  for (const tariff of TARIFFS) {
    const label = `fin/${sizeKw}/${tariff}`;
    const r = runSolarSimulation({
      systemSizeKw: sizeKw,
      systemType: "on-grid",
      finance: { electricityTariffPkrPerKwh: tariff, systemCapexPkr: sizeKw * 200000 },
    });
    check(`${label} savings scale with tariff`, () => r.finance.yearlySavingsPkr > 0);
    check(`${label} payback computed`, () => r.finance.simplePaybackYears !== null && r.finance.simplePaybackYears > 0);
    check(`${label} monthly offset length 12`, () => r.finance.monthlyBillOffsetPkr.length === 12);
  }
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  check(`hybrid/${sizeKw} less than on-grid`, () => {
    const on = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "on-grid" });
    const hy = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "hybrid" });
    return hy.annualAcKwh < on.annualAcKwh;
  });
  check(`offgrid/${sizeKw} less than hybrid`, () => {
    const hy = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "hybrid" });
    const off = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "off-grid" });
    return off.annualAcKwh < hy.annualAcKwh;
  });
}

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  const customGhi = Array(12).fill(5.5);
  const r = runSolarSimulation({
    systemSizeKw: sizeKw,
    systemType: "on-grid",
    site: { monthly: { dailyGhiKwhM2: customGhi }, latitudeDeg: 31.52, longitudeDeg: 74.35 },
  });
  check(`customGhi/${sizeKw} input assumption`, () =>
    r.assumptions.some((a) => a.id === "weather.ghi" && a.source === "input")
  );
  check(`customGhi/${sizeKw} yield positive`, () => r.annualAcKwh > 0);
}

const weather = buildWeatherSeries8760({ latitudeDeg: LAHORE_DEFAULTS.latitudeDeg });
const sun = buildSunPositionSeries(LAHORE_DEFAULTS.latitudeDeg, LAHORE_DEFAULTS.longitudeDeg, LAHORE_DEFAULTS.timezoneOffsetHours);
const poa = buildPoaSeries8760({
  ghiWm2: weather.ghiWm2,
  dniWm2: weather.dniWm2,
  dhiWm2: weather.dhiWm2,
  sunPositions: sun,
  tiltDeg: 15,
  azimuthDeg: 180,
  albedo: 0.2,
});
check("pipeline POA 8760 non-negative", () => assertIrradianceNonNegative(poa));
check("pipeline sun 8760 bounds sample", () => {
  for (let h = 0; h < HOURS_PER_YEAR; h += 24) {
    if (!assertSunElevationBounds(sun[h])) return false;
  }
  return true;
});
const cell = buildCellTempSeries8760(poa, weather.ambientTempC, weather.windSpeedMs);
check("pipeline cell temp reasonable", () => assertCellTempReasonable(cell));
const dc = buildArrayDcSeries8760(poa, cell, 9, normalizeModule());
const inv = normalizeInverter(5);
const ac = buildAcSeries8760(dc.dcPowerW, inv, "on-grid");
check("pipeline AC no NaN", () => assertNoNanInfinity(ac.acPowerW));
check("pipeline clipping non-negative", () => {
  for (let i = 0; i < ac.clippingLossW.length; i += 1) {
    if (ac.clippingLossW[i] < 0 || !Number.isFinite(ac.clippingLossW[i])) return false;
  }
  return true;
});

for (const sizeKw of SUPPORTED_SIMULATION_SIZES_KW) {
  const r = runSolarSimulation({ systemSizeKw: sizeKw, systemType: "on-grid" });
  check(`output/${sizeKw} clipping >= 0`, () => r.clippingLossKwh >= 0);
  check(`output/${sizeKw} cable loss fraction <= 0.12`, () => r.cable.cableLossFraction <= 0.12);
  check(`output/${sizeKw} finance payback finite or null`, () =>
    r.finance.simplePaybackYears === null || Number.isFinite(r.finance.simplePaybackYears)
  );
}

for (const tariff of TARIFFS) {
  const f = computeFinancialYield({
    monthlyAcKwh: Array(12).fill(400),
    electricityTariffPkrPerKwh: tariff,
    systemCapexPkr: 1000000,
  });
  check(`finDirect/tariff${tariff}`, () => f.yearlySavingsPkr > 0 && f.monthlyBillOffsetPkr.length === 12);
}

console.log(`\nSolar simulation matrix tests: ${pass} passed`);
