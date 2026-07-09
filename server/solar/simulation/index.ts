/**
 * Solar Simulation Engine — public API boundary.
 *
 * Only safe, validated entry points are exported. Lower-level calculators
 * (normalizeModule, hdkrPoaWm2, computeStringSizing, etc.) are internal to
 * SolarSimulationEngine and must be imported directly from their modules
 * within server/solar/simulation/ for tests — not from this barrel.
 */

export {
  runSolarSimulation,
  type RunSolarSimulationOptions,
} from "./SolarSimulationEngine.ts";

export {
  validateAndNormalizeSimulationInput,
  assertFiniteSimulationResult,
  SolarSimulationValidationError,
  SolarSimulationInternalError,
} from "./SolarSimulationValidation.ts";

export {
  HOURS_PER_YEAR,
  SIMULATION_ENGINE_TIMESTAMP,
  SUPPORTED_SIMULATION_SIZES_KW,
  SIMULATION_SYSTEM_TYPES,
  MONTH_LABELS,
  type SimulationSystemSizeKw,
  type SimulationSystemType,
  type MonthIndex,
  type SimulationAssumption,
  type HourlyWeatherInput,
  type MonthlyWeatherInput,
  type ModuleInput,
  type InverterInput,
  type ArrayInput,
  type SiteInput,
  type CableInput,
  type FinancialInput,
  type SolarSimulationInput,
  type LossBreakdown,
  type StringSizingResult,
  type CableLossResult,
  type MonthlyProductionRow,
  type FinancialSummary,
  type SolarSimulationResult,
} from "./SolarSimulationModels.ts";
