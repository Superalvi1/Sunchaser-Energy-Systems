/**
 * Solar Simulation Engine V1 — types, Lahore defaults, validation.
 * 8760-hour Float64Array pipeline. Pure TypeScript. No routes/UI/AI/DB/network.
 */

export const SIMULATION_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
export const HOURS_PER_YEAR = 8760;

export const SUPPORTED_SIMULATION_SIZES_KW = [3, 5, 6, 8, 10, 15] as const;
export type SimulationSystemSizeKw = (typeof SUPPORTED_SIMULATION_SIZES_KW)[number];

export const SIMULATION_SYSTEM_TYPES = ["on-grid", "hybrid", "off-grid"] as const;
export type SimulationSystemType = (typeof SIMULATION_SYSTEM_TYPES)[number];

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export class SolarSimulationValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SolarSimulationValidationError";
    this.code = code;
  }
}

/** Thrown when internal calculations produce a non-finite value that escaped input validation. */
export class SolarSimulationInternalError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, message: string, path = "") {
    super(message);
    this.name = "SolarSimulationInternalError";
    this.code = code;
    this.path = path;
  }
}

export interface SimulationAssumption {
  id: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
  source: "input" | "default";
}

export interface HourlyWeatherInput {
  /** Global horizontal irradiance W/m² — length 8760. */
  ghiWm2?: Float64Array | number[];
  /** Direct normal irradiance W/m² — optional, derived from GHI if absent. */
  dniWm2?: Float64Array | number[];
  /** Diffuse horizontal irradiance W/m² — optional. */
  dhiWm2?: Float64Array | number[];
  /** Ambient temperature °C — length 8760. */
  ambientTempC?: Float64Array | number[];
  /** Wind speed m/s — optional for Faiman. */
  windSpeedMs?: Float64Array | number[];
}

export interface MonthlyWeatherInput {
  /** Average daily GHI kWh/m²/day per month (12 values). */
  dailyGhiKwhM2?: number[];
  /** Average ambient °C per month (12 values). */
  ambientTempCByMonth?: number[];
}

export interface ModuleInput {
  wattageW?: number;
  vocStcV?: number;
  vmpStcV?: number;
  iscStcA?: number;
  impStcA?: number;
  tempCoeffPmaxPctPerC?: number;
  tempCoeffVocPctPerC?: number;
}

export interface InverterInput {
  acRatingKw?: number;
  maxDcVoltageV?: number;
  mpptMinV?: number;
  mpptMaxV?: number;
  efficiencyPct?: number;
}

export interface ArrayInput {
  tiltDeg?: number;
  azimuthDeg?: number;
  shadingLossFraction?: number;
  albedo?: number;
}

export interface SiteInput {
  latitudeDeg?: number;
  longitudeDeg?: number;
  timezoneOffsetHours?: number;
  hourly?: HourlyWeatherInput;
  monthly?: MonthlyWeatherInput;
}

export interface CableInput {
  dcCableLengthM?: number;
  acCableLengthM?: number;
  dcCableMm2?: number;
  acCableMm2?: number;
}

export interface FinancialInput {
  electricityTariffPkrPerKwh?: number;
  systemCapexPkr?: number;
  selfConsumptionFraction?: number;
}

export interface SolarSimulationInput {
  systemSizeKw: SimulationSystemSizeKw;
  systemType: SimulationSystemType;
  site?: SiteInput;
  array?: ArrayInput;
  module?: ModuleInput;
  inverter?: InverterInput;
  cables?: CableInput;
  finance?: FinancialInput;
}

export interface LossBreakdown {
  shadingKwh: number;
  temperatureKwh: number;
  inverterClippingKwh: number;
  cableKwh: number;
  systemAvailabilityKwh: number;
  totalLossKwh: number;
}

export interface StringSizingResult {
  moduleCount: number;
  modulesPerString: number;
  stringCount: number;
  minModulesPerString: number;
  maxModulesPerString: number;
  vocAtTminV: number;
  vmpAtTmaxV: number;
  stringVocColdV: number;
  stringVmpHotV: number;
  withinMppt: boolean;
  withinMaxDc: boolean;
  warnings: string[];
}

export interface CableLossResult {
  dcVoltageDropV: number;
  dcVoltageDropPct: number;
  acVoltageDropV: number;
  acVoltageDropPct: number;
  annualCableLossKwh: number;
  cableLossFraction: number;
}

export interface MonthlyProductionRow {
  month: MonthIndex;
  label: string;
  ghiKwhM2: number;
  poaKwhM2: number;
  dcKwh: number;
  acKwh: number;
  avgCellTempC: number;
  clippingKwh: number;
}

export interface FinancialSummary {
  tariffPkrPerKwh: number;
  monthlyBillOffsetPkr: number[];
  yearlySavingsPkr: number;
  simplePaybackYears: number | null;
  selfConsumptionFraction: number;
}

export interface SolarSimulationResult {
  generatedAt: string;
  systemSizeKw: SimulationSystemSizeKw;
  systemType: SimulationSystemType;
  assumptions: SimulationAssumption[];
  warnings: string[];
  moduleCount: number;
  arrayDcKw: number;
  monthly: MonthlyProductionRow[];
  annualDcKwh: number;
  annualAcKwh: number;
  performanceRatio: number;
  specificYieldKwhPerKwp: number;
  losses: LossBreakdown;
  stringSizing: StringSizingResult;
  cable: CableLossResult;
  clippingLossKwh: number;
  finance: FinancialSummary;
}

/** Lahore, Pakistan — named engineering defaults. */
export const LAHORE_DEFAULTS = {
  latitudeDeg: 31.52,
  longitudeDeg: 74.35,
  timezoneOffsetHours: 5,
  tiltDeg: 15,
  azimuthDeg: 180,
  albedo: 0.2,
  dailyGhiKwhM2: [3.2, 4.1, 5.0, 5.8, 6.2, 5.9, 5.1, 5.0, 5.3, 4.8, 3.8, 3.0] as const,
  ambientTempCByMonth: [12, 15, 22, 28, 34, 36, 33, 32, 30, 24, 18, 13] as const,
  designTempMinC: 0,
  designTempMaxC: 45,
  electricityTariffPkrPerKwh: 45,
  windSpeedMs: 2.5,
} as const;

export const DEFAULT_MODULE_580W = {
  wattageW: 580,
  vocStcV: 49.5,
  vmpStcV: 41.5,
  iscStcA: 14.5,
  impStcA: 14.0,
  tempCoeffPmaxPctPerC: -0.35,
  tempCoeffVocPctPerC: -0.28,
} as const;

export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function safeFinite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

export function requireFinite(n: unknown, field: string): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new SolarSimulationValidationError("INVALID_NUMBER", `${field} must be a finite number.`);
  }
  return n;
}

export function isSupportedSimulationSizeKw(kw: number): kw is SimulationSystemSizeKw {
  return (SUPPORTED_SIMULATION_SIZES_KW as readonly number[]).includes(kw);
}

export function moduleCountForSystemKw(sizeKw: SimulationSystemSizeKw, wattageW = DEFAULT_MODULE_580W.wattageW): number {
  return Math.max(1, Math.ceil((sizeKw * 1000) / wattageW));
}

export function daysInMonth(month: MonthIndex): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

export function hourToMonthDay(hourIndex: number): { month: MonthIndex; day: number; hour: number } {
  let h = Math.max(0, Math.min(HOURS_PER_YEAR - 1, Math.floor(hourIndex)));
  for (let m = 0; m < 12; m += 1) {
    const month = m as MonthIndex;
    const hrs = daysInMonth(month) * 24;
    if (h < hrs) {
      return { month, day: Math.floor(h / 24) + 1, hour: h % 24 };
    }
    h -= hrs;
  }
  return { month: 11, day: 31, hour: 23 };
}

export function defaultInverterForSizeKw(sizeKw: SimulationSystemSizeKw): Required<InverterInput> {
  const map: Record<SimulationSystemSizeKw, Required<InverterInput>> = {
    3: { acRatingKw: 3, maxDcVoltageV: 600, mpptMinV: 80, mpptMaxV: 550, efficiencyPct: 97.5 },
    5: { acRatingKw: 5, maxDcVoltageV: 600, mpptMinV: 90, mpptMaxV: 550, efficiencyPct: 97.8 },
    6: { acRatingKw: 6, maxDcVoltageV: 600, mpptMinV: 90, mpptMaxV: 550, efficiencyPct: 97.8 },
    8: { acRatingKw: 8, maxDcVoltageV: 600, mpptMinV: 100, mpptMaxV: 550, efficiencyPct: 98.0 },
    10: { acRatingKw: 10, maxDcVoltageV: 600, mpptMinV: 100, mpptMaxV: 550, efficiencyPct: 98.0 },
    15: { acRatingKw: 15, maxDcVoltageV: 1000, mpptMinV: 120, mpptMaxV: 800, efficiencyPct: 98.2 },
  };
  return map[sizeKw];
}

export function recordAssumption(
  list: SimulationAssumption[],
  id: string,
  label: string,
  value: string | number | boolean,
  source: "input" | "default",
  unit?: string
): void {
  list.push({ id, label, value, unit, source });
}
