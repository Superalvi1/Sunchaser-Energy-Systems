/**
 * Structured data models for the Business Intelligence Engine (V4).
 *
 * These types intentionally hold NO English sentences — every insight is a
 * structured record (code + numbers) that a later LLM layer explains. The
 * CRM (via SafeBusinessContext) computes every number; this layer only
 * classifies, thresholds, and scores it.
 */

export type InsightSeverity = "info" | "low" | "medium" | "high" | "critical";

/** "risk" = something needs attention. "opportunity" = a positive signal. "info" = neutral fact. */
export type InsightKind = "risk" | "opportunity" | "info";

export type InsightCategory =
  | "sales"
  | "finance"
  | "operations"
  | "support"
  | "procurement"
  | "executive";

export type PriorityLevel = "Low" | "Medium" | "High" | "Critical";

/** A single structured, machine-readable insight. No free text. */
export interface InsightItem {
  code: string;
  category: InsightCategory;
  kind: InsightKind;
  severity: InsightSeverity;
  metric: string;
  value: number;
  threshold: number | null;
}

export function makeInsight(
  input: Omit<InsightItem, "value" | "threshold"> & {
    value?: number;
    threshold?: number | null;
  }
): InsightItem {
  return {
    code: input.code,
    category: input.category,
    kind: input.kind,
    severity: input.severity,
    metric: input.metric,
    value: Number.isFinite(input.value) ? (input.value as number) : 0,
    threshold: input.threshold ?? null,
  };
}

/** Higher rank = more urgent. Used for deterministic sorting, never randomness. */
export const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export interface BusinessHealthWeights {
  sales: number;
  finance: number;
  operations: number;
  support: number;
  procurement: number;
  taskCompletion: number;
}

/** 100-point weighted scoring model. Weights are configurable — see BusinessHealthScore.ts. */
export const DEFAULT_BUSINESS_HEALTH_WEIGHTS: BusinessHealthWeights = {
  sales: 25,
  finance: 25,
  operations: 20,
  support: 10,
  procurement: 10,
  taskCompletion: 10,
};

export interface CategoryScoreBreakdown {
  category: keyof BusinessHealthWeights;
  rawScore: number;
  weight: number;
  weightedContribution: number;
}

export interface BusinessHealthScoreResult {
  overallScore: number;
  priority: PriorityLevel;
  breakdown: CategoryScoreBreakdown[];
}

/** The full deterministic output of the Business Intelligence Engine. */
export interface BusinessInsightReport {
  businessHealthScore: number;
  priority: PriorityLevel;
  executiveSummary: InsightItem[];
  sales: InsightItem[];
  finance: InsightItem[];
  operations: InsightItem[];
  support: InsightItem[];
  procurement: InsightItem[];
  warnings: InsightItem[];
  opportunities: InsightItem[];
  generatedAt: string;
}
