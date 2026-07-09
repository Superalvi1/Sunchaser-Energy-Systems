/**
 * Solar Quotation Engine — shared types and constants.
 *
 * Pure architecture: no persistence, no HTTP routes, no UI. Every function
 * in this module tree is a deterministic, pure computation over plain data.
 */

/** Fixed deterministic timestamp for pure constructors and tests. */
export const QUOTATION_DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const QUOTATION_ENGINE_STAGES = [
  "product_catalog",
  "price_rules",
  "margin_rules",
  "cable_pricing",
  "structure_pricing",
  "site_complexity",
  "boq_generation",
  "discount_approval",
  "proposal_template",
] as const;

export type QuotationEngineStage = (typeof QUOTATION_ENGINE_STAGES)[number];

const QUOTATION_ENGINE_STAGE_SET = new Set<string>(QUOTATION_ENGINE_STAGES);

export function isQuotationEngineStage(value: string): value is QuotationEngineStage {
  return QUOTATION_ENGINE_STAGE_SET.has(value);
}

/** Structured failure raised by any engine stage. Never leaks raw field values. */
export class QuotationEngineError extends Error {
  readonly stage: QuotationEngineStage;
  readonly reason: string;
  readonly details?: Record<string, unknown>;

  constructor(stage: QuotationEngineStage, reason: string, details?: Record<string, unknown>) {
    super(`[${stage}] ${reason}`);
    this.name = "QuotationEngineError";
    this.stage = stage;
    this.reason = reason;
    this.details = details;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** Safe numeric coercion — never throws, falls back on non-finite input. */
export function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 2 decimal places (currency-safe rounding). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
