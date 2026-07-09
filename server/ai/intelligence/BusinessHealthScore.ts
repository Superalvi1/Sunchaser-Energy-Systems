/**
 * Deterministic weighted business health scoring.
 *
 * Pure function: given per-category raw scores (0-100, produced by the
 * *Insights modules) and a weight table, compute one overall 0-100 score and
 * a priority label. No randomness, no I/O, no AI.
 */

import {
  DEFAULT_BUSINESS_HEALTH_WEIGHTS,
  type BusinessHealthScoreResult,
  type BusinessHealthWeights,
  type CategoryScoreBreakdown,
  type PriorityLevel,
} from "./InsightModels.ts";

export interface CategoryRawScores {
  sales: number;
  finance: number;
  operations: number;
  support: number;
  procurement: number;
  taskCompletion: number;
}

const CATEGORY_KEYS: (keyof CategoryRawScores)[] = [
  "sales",
  "finance",
  "operations",
  "support",
  "procurement",
  "taskCompletion",
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Priority thresholds (configurable via re-implementation if needed):
 *   score >= 85 -> Low priority attention (healthy)
 *   score >= 65 -> Medium priority attention
 *   score >= 40 -> High priority attention
 *   score <  40 -> Critical priority attention
 */
export const PRIORITY_THRESHOLDS = {
  low: 85,
  medium: 65,
  high: 40,
};

export function priorityFromScore(score: number): PriorityLevel {
  if (score >= PRIORITY_THRESHOLDS.low) return "Low";
  if (score >= PRIORITY_THRESHOLDS.medium) return "Medium";
  if (score >= PRIORITY_THRESHOLDS.high) return "High";
  return "Critical";
}

/**
 * Weighted sum formula:
 *   overallScore = round( sum(rawScore_i * weight_i) / sum(weight_i) )
 *
 * Weights are normalized against their own total, so a caller supplying a
 * partial or non-100-summing weight table still yields a 0-100 score.
 */
export function computeBusinessHealthScore(
  rawScores: CategoryRawScores,
  weights: BusinessHealthWeights = DEFAULT_BUSINESS_HEALTH_WEIGHTS
): BusinessHealthScoreResult {
  const totalWeight = CATEGORY_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);

  const breakdown: CategoryScoreBreakdown[] = CATEGORY_KEYS.map((key) => {
    const rawScore = clampScore(rawScores[key]);
    const weight = weights[key] ?? 0;
    const weightedContribution = totalWeight > 0 ? (rawScore * weight) / totalWeight : 0;
    return { category: key, rawScore, weight, weightedContribution };
  });

  const overallScore = clampScore(
    Math.round(breakdown.reduce((sum, entry) => sum + entry.weightedContribution, 0))
  );

  return {
    overallScore,
    priority: priorityFromScore(overallScore),
    breakdown,
  };
}
