/**
 * 8760-hour weather series — Float64Array pipeline input.
 */

import {
  HOURS_PER_YEAR,
  LAHORE_DEFAULTS,
  SolarSimulationValidationError,
  daysInMonth,
  hourToMonthDay,
  round4,
  safeFinite,
  type MonthIndex,
} from "./SolarSimulationModels.ts";

export interface WeatherSeriesMeta {
  usedDefaultGhi: boolean;
  usedDefaultTemp: boolean;
  usedDefaultWind: boolean;
  synthesizedFromMonthly: boolean;
}

export interface WeatherSeries8760 {
  ghiWm2: Float64Array;
  dniWm2: Float64Array;
  dhiWm2: Float64Array;
  ambientTempC: Float64Array;
  windSpeedMs: Float64Array;
  meta: WeatherSeriesMeta;
}

function toFloat64Array(data: Float64Array | number[] | undefined, length: number, field: string): Float64Array | null {
  if (!data) return null;
  const arr = data instanceof Float64Array ? data : new Float64Array(data);
  if (arr.length !== length) {
    throw new SolarSimulationValidationError("INVALID_WEATHER_LENGTH", `${field} must have length ${length}.`);
  }
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) {
      throw new SolarSimulationValidationError("INVALID_WEATHER_VALUE", `${field}[${i}] is not finite.`);
    }
  }
  return arr;
}

/** Synthesize bell-shaped daily GHI profile from monthly daily-average kWh/m²/day. */
function synthesizeHourlyGhiFromMonthly(dailyGhiKwhM2: number[]): Float64Array {
  const ghi = new Float64Array(HOURS_PER_YEAR);
  let hour = 0;
  for (let m = 0; m < 12; m += 1) {
    const month = m as MonthIndex;
    const days = daysInMonth(month);
    const dailyKwh = safeFinite(dailyGhiKwhM2[month], LAHORE_DEFAULTS.dailyGhiKwhM2[month]);
    const peakWm2 = (dailyKwh * 1000) / 6.5;
    for (let d = 0; d < days; d += 1) {
      for (let h = 0; h < 24; h += 1) {
        const x = (h - 12) / 4.5;
        const shape = Math.exp(-0.5 * x * x);
        ghi[hour] = Math.max(0, peakWm2 * shape);
        hour += 1;
      }
    }
  }
  return ghi;
}

function expandMonthlyTemp(ambientTempCByMonth: number[]): Float64Array {
  const temp = new Float64Array(HOURS_PER_YEAR);
  let hour = 0;
  for (let m = 0; m < 12; m += 1) {
    const month = m as MonthIndex;
    const days = daysInMonth(month);
    const base = safeFinite(ambientTempCByMonth[month], LAHORE_DEFAULTS.ambientTempCByMonth[month]);
    for (let d = 0; d < days; d += 1) {
      for (let h = 0; h < 24; h += 1) {
        const swing = 6 * Math.sin(((h - 6) / 24) * Math.PI);
        temp[hour] = base + swing;
        hour += 1;
      }
    }
  }
  return temp;
}

/** Erbs split: derive DNI/DHI from GHI (W/m²). */
export function decomposeGhiToDniDhi(ghiWm2: Float64Array, latitudeDeg: number): { dni: Float64Array; dhi: Float64Array } {
  const dni = new Float64Array(HOURS_PER_YEAR);
  const dhi = new Float64Array(HOURS_PER_YEAR);
  for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
    const ghi = Math.max(0, ghiWm2[i]);
    if (ghi < 1) {
      dni[i] = 0;
      dhi[i] = 0;
      continue;
    }
    const { month, hour } = hourToMonthDay(i);
    const dayOfYear = month * 30 + 15;
    const decl = 23.45 * Math.sin((Math.PI / 180) * ((360 / 365) * (dayOfYear - 81)));
    const lat = (latitudeDeg * Math.PI) / 180;
    const ha = ((hour - 12) * 15 * Math.PI) / 180;
    const cosZen = Math.sin(lat) * Math.sin((decl * Math.PI) / 180) + Math.cos(lat) * Math.cos((decl * Math.PI) / 180) * Math.cos(ha);
    const extraterrestrial = Math.max(0, 1361 * Math.max(0, cosZen));
    const kt = extraterrestrial > 0 ? Math.min(1, ghi / extraterrestrial) : 0;
    let fd = 1;
    if (kt <= 0.22) fd = 1 - 0.09 * kt;
    else if (kt <= 0.8) fd = 0.9511 - 0.1604 * kt + 4.388 * kt * kt - 16.638 * kt ** 3 + 12.336 * kt ** 4;
    else fd = 0.165;
    dhi[i] = Math.max(0, fd * ghi);
    const cosZ = Math.max(0.1, cosZen);
    dni[i] = Math.max(0, (ghi - dhi[i]) / cosZ);
  }
  return { dni, dhi };
}

export interface BuildWeatherSeriesInput {
  hourly?: {
    ghiWm2?: Float64Array | number[];
    dniWm2?: Float64Array | number[];
    dhiWm2?: Float64Array | number[];
    ambientTempC?: Float64Array | number[];
    windSpeedMs?: Float64Array | number[];
  };
  monthly?: {
    dailyGhiKwhM2?: number[];
    ambientTempCByMonth?: number[];
  };
  latitudeDeg: number;
}

export function buildWeatherSeries8760(input: BuildWeatherSeriesInput): WeatherSeries8760 {
  const meta: WeatherSeriesMeta = {
    usedDefaultGhi: false,
    usedDefaultTemp: false,
    usedDefaultWind: false,
    synthesizedFromMonthly: false,
  };

  let ghi = toFloat64Array(input.hourly?.ghiWm2, HOURS_PER_YEAR, "ghiWm2");
  let ambient = toFloat64Array(input.hourly?.ambientTempC, HOURS_PER_YEAR, "ambientTempC");
  let wind = toFloat64Array(input.hourly?.windSpeedMs, HOURS_PER_YEAR, "windSpeedMs");

  if (!ghi) {
    const monthly = input.monthly?.dailyGhiKwhM2;
    if (monthly && monthly.length === 12) {
      ghi = synthesizeHourlyGhiFromMonthly(monthly);
      meta.synthesizedFromMonthly = true;
    } else {
      ghi = synthesizeHourlyGhiFromMonthly([...LAHORE_DEFAULTS.dailyGhiKwhM2]);
      meta.usedDefaultGhi = true;
      meta.synthesizedFromMonthly = true;
    }
  }

  if (!ambient) {
    const monthlyT = input.monthly?.ambientTempCByMonth;
    ambient = expandMonthlyTemp(monthlyT && monthlyT.length === 12 ? monthlyT : [...LAHORE_DEFAULTS.ambientTempCByMonth]);
    meta.usedDefaultTemp = !monthlyT;
  }

  if (!wind) {
    wind = new Float64Array(HOURS_PER_YEAR).fill(LAHORE_DEFAULTS.windSpeedMs);
    meta.usedDefaultWind = true;
  }

  let dni = toFloat64Array(input.hourly?.dniWm2, HOURS_PER_YEAR, "dniWm2");
  let dhi = toFloat64Array(input.hourly?.dhiWm2, HOURS_PER_YEAR, "dhiWm2");
  if (!dni || !dhi) {
    const split = decomposeGhiToDniDhi(ghi, input.latitudeDeg);
    dni = dni ?? split.dni;
    dhi = dhi ?? split.dhi;
  }

  return { ghiWm2: ghi, dniWm2: dni, dhiWm2: dhi, ambientTempC: ambient, windSpeedMs: wind, meta };
}

export function aggregateMonthlyFromHourly(hourlyKwh: Float64Array): number[] {
  const monthly = new Array(12).fill(0);
  for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
    const { month } = hourToMonthDay(i);
    monthly[month] += safeFinite(hourlyKwh[i]);
  }
  return monthly.map((v) => round4(v));
}

export function sumArray(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) s += safeFinite(arr[i]);
  return round4(s);
}
