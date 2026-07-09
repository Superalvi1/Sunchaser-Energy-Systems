/**
 * Centralized numeric-safety validation for the Solar Simulation Engine.
 *
 * Contract:
 *  - Every public entry point MUST call validateAndNormalizeSimulationInput()
 *    BEFORE any calculation runs.
 *  - Provided numeric fields that are NaN/Infinity/-Infinity/null/non-number are
 *    rejected immediately with a typed SolarSimulationValidationError.
 *  - Provided numeric fields outside safe engineering bounds are rejected.
 *  - Invalid values are NEVER silently coerced to defaults/0/max. Absent
 *    (omitted) optional fields are left untouched so the engine can apply its
 *    documented defaults downstream.
 *  - assertFiniteSimulationResult() recursively guards the output object and
 *    throws SolarSimulationInternalError if any numeric field is non-finite.
 */

import {
  HOURS_PER_YEAR,
  SIMULATION_SYSTEM_TYPES,
  SUPPORTED_SIMULATION_SIZES_KW,
  SolarSimulationInternalError,
  SolarSimulationValidationError,
  type SolarSimulationInput,
} from "./SolarSimulationModels.ts";

export { SolarSimulationValidationError, SolarSimulationInternalError };

interface NumericRule {
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
  code: string;
  label: string;
  unit?: string;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
  }
  return `${typeof value}(${String(value)})`;
}

/** True only when `key` is an own, explicitly-present property of `obj`. */
function present(obj: unknown, key: string): boolean {
  return obj != null && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Validate a single optional numeric field. Absent fields are skipped so the
 * engine can use defaults. Present fields must be finite and within bounds.
 */
function validateOptionalNumber(obj: unknown, key: string, rule: NumericRule): void {
  if (!present(obj, key)) return;
  const value = (obj as Record<string, unknown>)[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SolarSimulationValidationError(
      rule.code,
      `${rule.label} must be a finite number${rule.unit ? ` (${rule.unit})` : ""}; received ${describe(value)}.`
    );
  }
  if (rule.min !== undefined) {
    const below = rule.exclusiveMin ? value <= rule.min : value < rule.min;
    if (below) {
      throw new SolarSimulationValidationError(
        rule.code,
        `${rule.label} must be ${rule.exclusiveMin ? ">" : ">="} ${rule.min}; received ${value}.`
      );
    }
  }
  if (rule.max !== undefined) {
    const above = rule.exclusiveMax ? value >= rule.max : value > rule.max;
    if (above) {
      throw new SolarSimulationValidationError(
        rule.code,
        `${rule.label} must be ${rule.exclusiveMax ? "<" : "<="} ${rule.max}; received ${value}.`
      );
    }
  }
}

function validateNumericArray(
  data: unknown,
  fieldLabel: string,
  code: string,
  opts: { expectedLength?: number; min?: number } = {}
): void {
  const isArrayLike = Array.isArray(data) || data instanceof Float64Array;
  if (!isArrayLike) {
    throw new SolarSimulationValidationError(code, `${fieldLabel} must be an array of finite numbers; received ${describe(data)}.`);
  }
  const arr = data as ArrayLike<unknown>;
  if (opts.expectedLength !== undefined && arr.length !== opts.expectedLength) {
    throw new SolarSimulationValidationError(code, `${fieldLabel} must have length ${opts.expectedLength}; received length ${arr.length}.`);
  }
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new SolarSimulationValidationError(code, `${fieldLabel}[${i}] must be a finite number; received ${describe(v)}.`);
    }
    if (opts.min !== undefined && v < opts.min) {
      throw new SolarSimulationValidationError(code, `${fieldLabel}[${i}] must be >= ${opts.min}; received ${v}.`);
    }
  }
}

function validateWeather(input: SolarSimulationInput): void {
  const hourly = input.site?.hourly;
  if (present(input.site, "hourly") && hourly != null) {
    if (present(hourly, "ghiWm2")) validateNumericArray(hourly.ghiWm2, "site.hourly.ghiWm2", "INVALID_WEATHER_GHI", { expectedLength: HOURS_PER_YEAR, min: 0 });
    if (present(hourly, "dniWm2")) validateNumericArray(hourly.dniWm2, "site.hourly.dniWm2", "INVALID_WEATHER_DNI", { expectedLength: HOURS_PER_YEAR, min: 0 });
    if (present(hourly, "dhiWm2")) validateNumericArray(hourly.dhiWm2, "site.hourly.dhiWm2", "INVALID_WEATHER_DHI", { expectedLength: HOURS_PER_YEAR, min: 0 });
    if (present(hourly, "ambientTempC")) validateNumericArray(hourly.ambientTempC, "site.hourly.ambientTempC", "INVALID_WEATHER_TEMP", { expectedLength: HOURS_PER_YEAR });
    if (present(hourly, "windSpeedMs")) validateNumericArray(hourly.windSpeedMs, "site.hourly.windSpeedMs", "INVALID_WEATHER_WIND", { expectedLength: HOURS_PER_YEAR, min: 0 });
  }

  const monthly = input.site?.monthly;
  if (present(input.site, "monthly") && monthly != null) {
    if (present(monthly, "dailyGhiKwhM2")) validateNumericArray(monthly.dailyGhiKwhM2, "site.monthly.dailyGhiKwhM2", "INVALID_WEATHER_GHI", { expectedLength: 12, min: 0 });
    if (present(monthly, "ambientTempCByMonth")) validateNumericArray(monthly.ambientTempCByMonth, "site.monthly.ambientTempCByMonth", "INVALID_WEATHER_TEMP", { expectedLength: 12 });
  }
}

/**
 * Validate every provided numeric field against safe engineering bounds and
 * return the (unmodified) input for typed downstream use. Throws
 * SolarSimulationValidationError on the first violation — no calculation should
 * run past a failure.
 */
export function validateAndNormalizeSimulationInput(input: SolarSimulationInput): SolarSimulationInput {
  if (input === null || typeof input !== "object") {
    throw new SolarSimulationValidationError("INVALID_INPUT", `Simulation input must be an object; received ${describe(input)}.`);
  }

  if (typeof input.systemSizeKw !== "number" || !Number.isFinite(input.systemSizeKw)) {
    throw new SolarSimulationValidationError("INVALID_SIZE", `systemSizeKw must be a finite number; received ${describe(input.systemSizeKw)}.`);
  }
  if (!(SUPPORTED_SIMULATION_SIZES_KW as readonly number[]).includes(input.systemSizeKw)) {
    throw new SolarSimulationValidationError("UNSUPPORTED_SIZE", `Unsupported system size kW: ${input.systemSizeKw}. Supported: ${SUPPORTED_SIMULATION_SIZES_KW.join(", ")}.`);
  }
  if (!(SIMULATION_SYSTEM_TYPES as readonly string[]).includes(input.systemType)) {
    throw new SolarSimulationValidationError("UNSUPPORTED_TYPE", `Unsupported system type: ${describe(input.systemType)}.`);
  }

  const site = input.site;
  validateOptionalNumber(site, "latitudeDeg", { min: -90, max: 90, code: "INVALID_LATITUDE", label: "site.latitudeDeg", unit: "deg" });
  validateOptionalNumber(site, "longitudeDeg", { min: -180, max: 180, code: "INVALID_LONGITUDE", label: "site.longitudeDeg", unit: "deg" });
  validateOptionalNumber(site, "timezoneOffsetHours", { min: -14, max: 14, code: "INVALID_TIMEZONE", label: "site.timezoneOffsetHours", unit: "h" });

  const array = input.array;
  validateOptionalNumber(array, "tiltDeg", { min: 0, max: 90, code: "INVALID_TILT", label: "array.tiltDeg", unit: "deg" });
  validateOptionalNumber(array, "azimuthDeg", { min: 0, max: 360, code: "INVALID_AZIMUTH", label: "array.azimuthDeg", unit: "deg" });
  validateOptionalNumber(array, "albedo", { min: 0, max: 1, code: "INVALID_ALBEDO", label: "array.albedo" });
  validateOptionalNumber(array, "shadingLossFraction", { min: 0, max: 1, code: "INVALID_SHADING", label: "array.shadingLossFraction" });

  const module = input.module;
  validateOptionalNumber(module, "wattageW", { min: 0, exclusiveMin: true, code: "INVALID_MODULE_WATTAGE", label: "module.wattageW", unit: "W" });
  validateOptionalNumber(module, "vocStcV", { min: 0, exclusiveMin: true, code: "INVALID_MODULE_VOC", label: "module.vocStcV", unit: "V" });
  validateOptionalNumber(module, "vmpStcV", { min: 0, exclusiveMin: true, code: "INVALID_MODULE_VMP", label: "module.vmpStcV", unit: "V" });
  validateOptionalNumber(module, "iscStcA", { min: 0, exclusiveMin: true, code: "INVALID_MODULE_ISC", label: "module.iscStcA", unit: "A" });
  validateOptionalNumber(module, "impStcA", { min: 0, exclusiveMin: true, code: "INVALID_MODULE_IMP", label: "module.impStcA", unit: "A" });
  validateOptionalNumber(module, "tempCoeffPmaxPctPerC", { min: -5, max: 5, code: "INVALID_MODULE_TEMPCO", label: "module.tempCoeffPmaxPctPerC", unit: "%/°C" });
  validateOptionalNumber(module, "tempCoeffVocPctPerC", { min: -5, max: 5, code: "INVALID_MODULE_TEMPCO", label: "module.tempCoeffVocPctPerC", unit: "%/°C" });

  const inverter = input.inverter;
  validateOptionalNumber(inverter, "acRatingKw", { min: 0, exclusiveMin: true, code: "INVALID_INVERTER_RATING", label: "inverter.acRatingKw", unit: "kW" });
  validateOptionalNumber(inverter, "maxDcVoltageV", { min: 0, exclusiveMin: true, code: "INVALID_INVERTER_MAXDC", label: "inverter.maxDcVoltageV", unit: "V" });
  validateOptionalNumber(inverter, "mpptMinV", { min: 0, exclusiveMin: true, code: "INVALID_INVERTER_MPPT", label: "inverter.mpptMinV", unit: "V" });
  validateOptionalNumber(inverter, "mpptMaxV", { min: 0, exclusiveMin: true, code: "INVALID_INVERTER_MPPT", label: "inverter.mpptMaxV", unit: "V" });
  validateOptionalNumber(inverter, "efficiencyPct", { min: 0, exclusiveMin: true, max: 100, code: "INVALID_INVERTER_EFFICIENCY", label: "inverter.efficiencyPct", unit: "%" });

  const cables = input.cables;
  validateOptionalNumber(cables, "dcCableLengthM", { min: 0, code: "INVALID_CABLE_LENGTH", label: "cables.dcCableLengthM", unit: "m" });
  validateOptionalNumber(cables, "acCableLengthM", { min: 0, code: "INVALID_CABLE_LENGTH", label: "cables.acCableLengthM", unit: "m" });
  validateOptionalNumber(cables, "dcCableMm2", { min: 0, exclusiveMin: true, code: "INVALID_CABLE_SECTION", label: "cables.dcCableMm2", unit: "mm²" });
  validateOptionalNumber(cables, "acCableMm2", { min: 0, exclusiveMin: true, code: "INVALID_CABLE_SECTION", label: "cables.acCableMm2", unit: "mm²" });

  const finance = input.finance;
  validateOptionalNumber(finance, "electricityTariffPkrPerKwh", { min: 0, code: "INVALID_TARIFF", label: "finance.electricityTariffPkrPerKwh", unit: "PKR/kWh" });
  validateOptionalNumber(finance, "systemCapexPkr", { min: 0, code: "INVALID_CAPEX", label: "finance.systemCapexPkr", unit: "PKR" });
  validateOptionalNumber(finance, "selfConsumptionFraction", { min: 0, max: 1, code: "INVALID_SELF_CONSUMPTION", label: "finance.selfConsumptionFraction" });

  validateWeather(input);

  return input;
}

/**
 * Recursively assert that every numeric field in a simulation result object is
 * finite. `null` (e.g. simplePaybackYears) is permitted. Throws
 * SolarSimulationInternalError with the offending path on failure.
 */
export function assertFiniteSimulationResult<T>(result: T): T {
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new SolarSimulationInternalError("NON_FINITE_OUTPUT", `Simulation result field "${path}" is non-finite (${describe(value)}).`, path);
      }
      return;
    }
    if (value instanceof Float64Array) {
      for (let i = 0; i < value.length; i += 1) {
        if (!Number.isFinite(value[i])) {
          throw new SolarSimulationInternalError("NON_FINITE_OUTPUT", `Simulation result field "${path}[${i}]" is non-finite (${describe(value[i])}).`, `${path}[${i}]`);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        walk((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      }
    }
  };
  walk(result, "");
  return result;
}
