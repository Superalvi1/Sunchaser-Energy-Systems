/**
 * Business Intelligence Engine (AI Business Assistant V4).
 *
 * The Intelligence Layer sits between SafeBusinessContext (the CRM's
 * permission-filtered summary) and the LLM. It is 100% deterministic:
 *
 *   - Pure TypeScript, no randomness.
 *   - No AI / LLM calls.
 *   - No network or database access.
 *   - No mutation of any CRM data — it only reads a SafeBusinessSummary.
 *
 * The CRM (SafeBusinessContext) computes every raw number. This engine only
 * classifies those numbers against configurable thresholds and produces a
 * BusinessInsightReport made entirely of structured records (codes + numbers)
 * — never English paragraphs. A later LLM layer explains this structured
 * report to the user in natural language; it never invents or recomputes a
 * metric itself.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { computeBusinessHealthScore, type CategoryRawScores } from "./BusinessHealthScore.ts";
import {
  computeCriticalWarnings,
  computeExecutiveSummary,
  computeTopOpportunities,
} from "./ExecutiveInsights.ts";
import { computeFinanceInsights, computeFinanceScore } from "./FinanceInsights.ts";
import {
  DEFAULT_BUSINESS_HEALTH_WEIGHTS,
  type BusinessHealthWeights,
  type BusinessInsightReport,
  type InsightItem,
} from "./InsightModels.ts";
import { computeOperationsInsights, computeOperationsScore } from "./OperationsInsights.ts";
import { computeProcurementInsights, computeProcurementScore } from "./ProcurementInsights.ts";
import { computeSalesInsights, computeSalesScore } from "./SalesInsights.ts";
import { computeSupportInsights, computeSupportScore } from "./SupportInsights.ts";

export const TASK_COMPLETION_THRESHOLDS = {
  /** Score penalty per pending task (today + tomorrow combined). */
  penaltyPerTask: 8,
};

/** Fixed fallback when `options.now` is omitted — keeps output pure/deterministic (no clock reads). */
export const DETERMINISTIC_GENERATED_AT_FALLBACK = "1970-01-01T00:00:00.000Z";

/**
 * SafeBusinessSummary only carries today/tomorrow task *counts*, not
 * completed-vs-pending state, so this is a workload-pressure proxy for the
 * "task completion" weight: more pending near-term tasks -> lower score.
 * When no task data is present (role has none, or none due today/tomorrow),
 * the category is treated as fully healthy (100).
 */
export function computeTaskCompletionScore(summary: SafeBusinessSummary): number {
  if (!summary.tasks) return 100;
  const load = summary.tasks.today + summary.tasks.tomorrow;
  const penalty = Math.min(100, load * TASK_COMPLETION_THRESHOLDS.penaltyPerTask);
  return Math.max(0, 100 - penalty);
}

export interface BusinessIntelligenceOptions {
  /** Override the default 100-point weight table (must remain configurable). */
  weights?: BusinessHealthWeights;
  /** Caller-supplied timestamp for `generatedAt`; omit to use DETERMINISTIC_GENERATED_AT_FALLBACK. */
  now?: string;
}

/**
 * SafeBusinessSummary -> BusinessInsightReport.
 *
 * Deterministic: calling this twice with the same summary and options always
 * produces the same report. No clock reads inside the engine.
 */
export function generateBusinessInsightReport(
  summary: SafeBusinessSummary,
  options: BusinessIntelligenceOptions = {}
): BusinessInsightReport {
  const sales = computeSalesInsights(summary);
  const finance = computeFinanceInsights(summary);
  const operations = computeOperationsInsights(summary);
  const support = computeSupportInsights(summary);
  const procurement = computeProcurementInsights(summary);

  const rawScores: CategoryRawScores = {
    sales: computeSalesScore(summary),
    finance: computeFinanceScore(summary),
    operations: computeOperationsScore(summary),
    support: computeSupportScore(summary),
    procurement: computeProcurementScore(summary),
    taskCompletion: computeTaskCompletionScore(summary),
  };

  const health = computeBusinessHealthScore(rawScores, options.weights ?? DEFAULT_BUSINESS_HEALTH_WEIGHTS);

  const allInsights: InsightItem[] = [...sales, ...finance, ...operations, ...support, ...procurement];

  const warnings = computeCriticalWarnings(allInsights);
  const opportunities = computeTopOpportunities(allInsights);
  const executiveSummary = computeExecutiveSummary(allInsights);

  return {
    businessHealthScore: health.overallScore,
    priority: health.priority,
    executiveSummary,
    sales,
    finance,
    operations,
    support,
    procurement,
    warnings,
    opportunities,
    generatedAt: options.now ?? DETERMINISTIC_GENERATED_AT_FALLBACK,
  };
}
