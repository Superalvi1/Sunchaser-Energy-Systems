/**
 * Solar Simulation Engine V1 — 8760-hour Float64Array orchestrator.
 * PVsyst/Helioscope-style engineering calculations. Pure deterministic TypeScript.
 */

import {
  HOURS_PER_YEAR,
  LAHORE_DEFAULTS,
  MONTH_LABELS,
  SIMULATION_ENGINE_TIMESTAMP,
  SolarSimulationInternalError,
  daysInMonth,
  moduleCountForSystemKw,
  recordAssumption,
  round2,
  round4,
  safeFinite,
  hourToMonthDay,
  type MonthIndex,
  type SimulationAssumption,
  type SolarSimulationInput,
  type SolarSimulationResult,
} from "./SolarSimulationModels.ts";
import {
  assertFiniteSimulationResult,
  validateAndNormalizeSimulationInput,
} from "./SolarSimulationValidation.ts";
import { buildWeatherSeries8760, aggregateMonthlyFromHourly, sumArray } from "./WeatherSeries.ts";
import { buildSunPositionSeries } from "./SunPositionPSA.ts";
import { TRANSPOSITION_MODEL, buildPoaSeries8760 } from "./IrradianceTransposition.ts";
import { buildCellTempSeries8760 } from "./TemperatureFaiman.ts";
import { buildArrayDcSeries8760, normalizeModule } from "./ModulePowerModel.ts";
import { buildAcSeries8760, normalizeInverter } from "./InverterClipping.ts";
import { computeStringSizing } from "./StringSizingEngine.ts";
import { computeDcAcVoltageDrop } from "./VoltageDropCalculator.ts";
import { computeSystemCableLossKwhYear } from "./CableLossCalculator.ts";
import { computePerformanceRatio } from "./PerformanceRatio.ts";
import { computeFinancialYield } from "./FinancialYieldModel.ts";

export interface RunSolarSimulationOptions {
  /** Equivalent full-load hours/year for cable loss estimate (default 1200). */
  equivalentFullLoadHours?: number;
}

function defaultDcCableLengthM(sizeKw: number): number {
  return sizeKw * 15 + 40;
}

function defaultAcCableLengthM(sizeKw: number): number {
  return Math.max(12, Math.round(sizeKw * 2.5 + 8));
}

function defaultCapexPkr(sizeKw: number): number {
  return sizeKw * 185000;
}

function assertPipelineFinite(...arrays: Float64Array[]): void {
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i += 1) {
      if (!Number.isFinite(arr[i])) {
        throw new SolarSimulationInternalError("PIPELINE_NAN", `Pipeline produced non-finite value at index ${i}.`);
      }
    }
  }
}

function aggregateMonthlyPoaKwhM2(poaWm2: Float64Array): number[] {
  const monthly = new Array(12).fill(0);
  for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
    const { month } = hourToMonthDay(i);
    monthly[month] += safeFinite(poaWm2[i]) / 1000;
  }
  return monthly.map((v) => round4(v));
}

function aggregateMonthlyGhiKwhM2(ghiWm2: Float64Array): number[] {
  const monthly = new Array(12).fill(0);
  for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
    const { month } = hourToMonthDay(i);
    monthly[month] += safeFinite(ghiWm2[i]) / 1000;
  }
  return monthly.map((v) => round4(v));
}

function aggregateMonthlyAvgCellTemp(cellTempC: Float64Array): number[] {
  const sums = new Array(12).fill(0);
  const counts = new Array(12).fill(0);
  for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
    const { month } = hourToMonthDay(i);
    sums[month] += safeFinite(cellTempC[i]);
    counts[month] += 1;
  }
  return sums.map((s, m) => round4(counts[m] > 0 ? s / counts[m] : 0));
}

export function runSolarSimulation(
  input: SolarSimulationInput,
  options: RunSolarSimulationOptions = {}
): SolarSimulationResult {
  validateAndNormalizeSimulationInput(input);

  const assumptions: SimulationAssumption[] = [];
  const warnings: string[] = [];

  const lat = input.site?.latitudeDeg ?? LAHORE_DEFAULTS.latitudeDeg;
  const lon = input.site?.longitudeDeg ?? LAHORE_DEFAULTS.longitudeDeg;
  const tz = input.site?.timezoneOffsetHours ?? LAHORE_DEFAULTS.timezoneOffsetHours;
  const tilt = input.array?.tiltDeg ?? LAHORE_DEFAULTS.tiltDeg;
  const azimuth = input.array?.azimuthDeg ?? LAHORE_DEFAULTS.azimuthDeg;
  const albedo = input.array?.albedo ?? LAHORE_DEFAULTS.albedo;
  const shadingLossFraction = input.array?.shadingLossFraction ?? 0;
  const shadingFactor = Math.max(0, 1 - shadingLossFraction);

  const weather = buildWeatherSeries8760({
    hourly: input.site?.hourly,
    monthly: input.site?.monthly,
    latitudeDeg: lat,
  });

  if (weather.meta.usedDefaultGhi) {
    warnings.push("Weather GHI: using Lahore default irradiance assumptions (8760 synthesis).");
    recordAssumption(assumptions, "weather.ghi", "GHI profile", "LAHORE_DEFAULTS.dailyGhiKwhM2", "default", "kWh/m²/day");
  } else if (weather.meta.synthesizedFromMonthly) {
    recordAssumption(assumptions, "weather.ghi", "GHI profile", "caller monthly → hourly synthesis", "input");
  } else {
    recordAssumption(assumptions, "weather.ghi", "GHI profile", "caller hourly 8760", "input");
  }
  if (weather.meta.usedDefaultTemp) {
    warnings.push("Ambient temperature: using Lahore monthly default assumptions.");
    recordAssumption(assumptions, "weather.ambient", "Ambient temperature", "LAHORE_DEFAULTS.ambientTempCByMonth", "default", "°C");
  } else {
    recordAssumption(assumptions, "weather.ambient", "Ambient temperature", "caller-supplied", "input");
  }
  if (weather.meta.usedDefaultWind) {
    recordAssumption(assumptions, "weather.wind", "Wind speed", LAHORE_DEFAULTS.windSpeedMs, "default", "m/s");
  }

  recordAssumption(assumptions, "site.latitude", "Site latitude", lat, input.site?.latitudeDeg !== undefined ? "input" : "default", "deg");
  recordAssumption(assumptions, "site.longitude", "Site longitude", lon, input.site?.longitudeDeg !== undefined ? "input" : "default", "deg");
  recordAssumption(assumptions, "array.tilt", "Array tilt", tilt, input.array?.tiltDeg !== undefined ? "input" : "default", "deg");
  recordAssumption(assumptions, "array.azimuth", "Array azimuth", azimuth, input.array?.azimuthDeg !== undefined ? "input" : "default", "deg");
  recordAssumption(assumptions, "array.albedo", "Ground albedo", albedo, input.array?.albedo !== undefined ? "input" : "default");
  recordAssumption(assumptions, "transposition", "Transposition model", TRANSPOSITION_MODEL, "default");
  recordAssumption(assumptions, "temperature", "Cell temperature model", "Faiman", "default");
  recordAssumption(assumptions, "module.dc", "Module DC model", "PVWatts-style", "default");
  recordAssumption(assumptions, "array.shading", "Shading loss fraction", shadingLossFraction, input.array?.shadingLossFraction !== undefined ? "input" : "default");

  const module = normalizeModule(input.module);
  const inverter = normalizeInverter(input.systemSizeKw, input.inverter);
  const moduleCount = moduleCountForSystemKw(input.systemSizeKw, module.wattageW);
  const arrayDcKw = round4((moduleCount * module.wattageW) / 1000);

  if (!input.module) warnings.push("Module electrical data: using DEFAULT_MODULE_580W assumptions.");
  if (!input.inverter) warnings.push(`Inverter: using default catalog rating for ${input.systemSizeKw} kW.`);

  recordAssumption(assumptions, "module.wattage", "Module wattage STC", module.wattageW, input.module?.wattageW !== undefined ? "input" : "default", "W");
  recordAssumption(assumptions, "inverter.acRating", "Inverter AC rating", inverter.acRatingKw, input.inverter?.acRatingKw !== undefined ? "input" : "default", "kW");
  recordAssumption(assumptions, "inverter.efficiency", "Inverter efficiency", inverter.efficiencyPct, input.inverter?.efficiencyPct !== undefined ? "input" : "default", "%");

  const sunPositions = buildSunPositionSeries(lat, lon, tz);
  const poaWm2 = buildPoaSeries8760({
    ghiWm2: weather.ghiWm2,
    dniWm2: weather.dniWm2,
    dhiWm2: weather.dhiWm2,
    sunPositions,
    tiltDeg: tilt,
    azimuthDeg: azimuth,
    albedo,
    shadingFactor,
  });

  const cellTempC = buildCellTempSeries8760(poaWm2, weather.ambientTempC, weather.windSpeedMs);
  const dcSeries = buildArrayDcSeries8760(poaWm2, cellTempC, moduleCount, module);
  const acSeries = buildAcSeries8760(dcSeries.dcPowerW, inverter, input.systemType);

  assertPipelineFinite(poaWm2, cellTempC, dcSeries.dcPowerW, acSeries.acPowerW);

  const monthlyDcKwh = aggregateMonthlyFromHourly(
    new Float64Array(Array.from(dcSeries.dcPowerW).map((w) => w / 1000))
  );
  const monthlyAcKwhGross = aggregateMonthlyFromHourly(
    new Float64Array(Array.from(acSeries.acPowerW).map((w) => w / 1000))
  );
  const monthlyClippingKwh = aggregateMonthlyFromHourly(
    new Float64Array(Array.from(acSeries.clippingLossW).map((w) => w / 1000))
  );
  const monthlyGhiKwhM2 = aggregateMonthlyGhiKwhM2(weather.ghiWm2);
  const monthlyPoaKwhM2 = aggregateMonthlyPoaKwhM2(poaWm2);
  const monthlyAvgCellTemp = aggregateMonthlyAvgCellTemp(cellTempC);

  const stringSizing = computeStringSizing({
    systemSizeKw: input.systemSizeKw,
    module: input.module,
    inverter: input.inverter,
  });
  warnings.push(...stringSizing.warnings);

  const dcLen = input.cables?.dcCableLengthM ?? defaultDcCableLengthM(input.systemSizeKw);
  const acLen = input.cables?.acCableLengthM ?? defaultAcCableLengthM(input.systemSizeKw);
  const dcMm2 = input.cables?.dcCableMm2 ?? 6;
  const acMm2 = input.cables?.acCableMm2 ?? 4;
  if (!input.cables?.dcCableLengthM) warnings.push("DC cable length: using default rule (size_kW×15+40 m).");
  if (!input.cables?.acCableLengthM) warnings.push("AC cable length: using default rule.");

  const dcCurrentA = round4((stringSizing.moduleCount * module.impStcA) / stringSizing.stringCount);
  const acCurrentA = round4((input.systemSizeKw * 1000) / (230 * 0.95));

  const voltageDrop = computeDcAcVoltageDrop({
    dcCurrentA,
    acCurrentA,
    dcCableLengthM: dcLen,
    acCableLengthM: acLen,
    dcCableMm2: dcMm2,
    acCableMm2: acMm2,
    dcStringVoltageV: stringSizing.stringVmpHotV,
  });
  if (voltageDrop.dcVoltageDropPct > 3) warnings.push(`DC voltage drop ${voltageDrop.dcVoltageDropPct}% exceeds 3% guideline.`);
  if (voltageDrop.acVoltageDropPct > 3) warnings.push(`AC voltage drop ${voltageDrop.acVoltageDropPct}% exceeds 3% guideline.`);

  const eqHours = options.equivalentFullLoadHours ?? 1200;
  const cableLossYear = computeSystemCableLossKwhYear({
    dcCurrentA,
    acCurrentA,
    dcCableLengthM: dcLen,
    acCableLengthM: acLen,
    dcCableMm2: dcMm2,
    acCableMm2: acMm2,
    equivalentFullLoadHours: eqHours,
  });

  const annualDcKwhGross = sumArray(new Float64Array(monthlyDcKwh));
  const annualAcKwhGross = sumArray(new Float64Array(monthlyAcKwhGross));
  const cableLossFraction = annualAcKwhGross > 0 ? Math.min(0.12, cableLossYear / annualAcKwhGross) : 0;
  if (cableLossFraction >= 0.05) {
    warnings.push(`Cable I²R loss derate ${round4(cableLossFraction * 100)}% applied to AC energy.`);
  }

  const monthlyAcKwhNet = monthlyAcKwhGross.map((kwh) => {
    const cableLoss = round4(kwh * cableLossFraction);
    return round4(Math.max(0, kwh - cableLoss));
  });
  const annualAcKwh = round4(monthlyAcKwhNet.reduce((s, v) => s + v, 0));
  const annualDcKwh = round4(annualDcKwhGross);
  const annualCableLossKwh = round4(annualAcKwhGross * cableLossFraction);

  const monthly = Array.from({ length: 12 }, (_, m) => {
    const month = m as MonthIndex;
    const grossAc = monthlyAcKwhGross[month];
    const cableLoss = round4(grossAc * cableLossFraction);
    return {
      month,
      label: MONTH_LABELS[month],
      ghiKwhM2: monthlyGhiKwhM2[month],
      poaKwhM2: monthlyPoaKwhM2[month],
      dcKwh: monthlyDcKwh[month],
      acKwh: round4(Math.max(0, grossAc - cableLoss)),
      avgCellTempC: monthlyAvgCellTemp[month],
      clippingKwh: monthlyClippingKwh[month],
    };
  });

  const shadingKwh = shadingFactor < 1 && shadingFactor > 0
    ? round4(annualDcKwh * (shadingLossFraction / shadingFactor))
    : round4(annualDcKwh * shadingLossFraction);
  const temperatureKwh = round4(sumArray(new Float64Array(
    Array.from(dcSeries.tempLossW).map((w) => w / 1000)
  )));
  const clippingLossKwh = round4(sumArray(new Float64Array(
    Array.from(acSeries.clippingLossW).map((w) => w / 1000)
  )));
  const systemAvailabilityKwh = round4(sumArray(new Float64Array(
    Array.from(acSeries.availabilityLossW).map((w) => w / 1000)
  )));
  const totalLossKwh = round4(shadingKwh + temperatureKwh + clippingLossKwh + annualCableLossKwh + systemAvailabilityKwh);

  const refPoaYear = round4(monthlyPoaKwhM2.reduce((s, v) => s + v, 0));
  const pr = computePerformanceRatio({
    acEnergyKwh: annualAcKwh,
    arrayDcKw,
    referencePoaKwhM2Year: refPoaYear,
  });

  const tariff = input.finance?.electricityTariffPkrPerKwh;
  const capex = input.finance?.systemCapexPkr ?? defaultCapexPkr(input.systemSizeKw);
  if (!input.finance?.electricityTariffPkrPerKwh) {
    warnings.push("Electricity tariff: using Lahore default PKR/kWh assumption.");
  }
  if (!input.finance?.systemCapexPkr) {
    warnings.push("System CAPEX: using indicative default (size_kW × 185,000 PKR).");
  }

  const finance = computeFinancialYield({
    monthlyAcKwh: monthlyAcKwhNet,
    electricityTariffPkrPerKwh: tariff,
    systemCapexPkr: capex,
    selfConsumptionFraction: input.finance?.selfConsumptionFraction,
  });

  recordAssumption(assumptions, "finance.tariff", "Electricity tariff", finance.tariffPkrPerKwh, tariff !== undefined ? "input" : "default", "PKR/kWh");
  recordAssumption(assumptions, "finance.capex", "System CAPEX", capex, input.finance?.systemCapexPkr !== undefined ? "input" : "default", "PKR");
  recordAssumption(assumptions, "pipeline.hours", "Simulation timestep", HOURS_PER_YEAR, "default", "hours/year");

  const result: SolarSimulationResult = {
    generatedAt: SIMULATION_ENGINE_TIMESTAMP,
    systemSizeKw: input.systemSizeKw,
    systemType: input.systemType,
    assumptions,
    warnings,
    moduleCount,
    arrayDcKw,
    monthly,
    annualDcKwh,
    annualAcKwh,
    performanceRatio: pr.performanceRatio,
    specificYieldKwhPerKwp: pr.specificYieldKwhPerKwp,
    losses: {
      shadingKwh,
      temperatureKwh,
      inverterClippingKwh: clippingLossKwh,
      cableKwh: annualCableLossKwh,
      systemAvailabilityKwh,
      totalLossKwh,
    },
    stringSizing,
    cable: {
      dcVoltageDropV: voltageDrop.dcVoltageDropV,
      dcVoltageDropPct: voltageDrop.dcVoltageDropPct,
      acVoltageDropV: voltageDrop.acVoltageDropV,
      acVoltageDropPct: voltageDrop.acVoltageDropPct,
      annualCableLossKwh,
      cableLossFraction: round4(cableLossFraction),
    },
    clippingLossKwh,
    finance: {
      ...finance,
      yearlySavingsPkr: round2(finance.yearlySavingsPkr),
    },
  };

  return assertFiniteSimulationResult(result);
}
