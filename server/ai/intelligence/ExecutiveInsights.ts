/**
 * Executive (CEO) intelligence — pure aggregation/ranking over already
 * computed InsightItem lists. Never recomputes raw metrics, never touches
 * SafeBusinessSummary directly — it only classifies and ranks what the
 * domain engines already produced.
 */

import {
  SEVERITY_RANK,
  type BusinessHealthScoreResult,
  type InsightItem,
} from "./InsightModels.ts";

export const EXECUTIVE_THRESHOLDS = {
  maxExecutiveSummaryItems: 5,
  maxTodaysPriorities: 5,
  maxTopOpportunities: 5,
};

function severityWeight(item: InsightItem): number {
  return SEVERITY_RANK[item.severity];
}

/** Deterministic ordering: highest severity first, then category, then code (alphabetical). */
function sortInsights(items: InsightItem[]): InsightItem[] {
  return [...items].sort((a, b) => {
    const severityDiff = severityWeight(b) - severityWeight(a);
    if (severityDiff !== 0) return severityDiff;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.code.localeCompare(b.code);
  });
}

/** Critical warnings: risk-kind insights at high/critical severity, most urgent first. */
export function computeCriticalWarnings(allInsights: InsightItem[]): InsightItem[] {
  return sortInsights(
    allInsights.filter(
      (item) => item.kind === "risk" && (item.severity === "high" || item.severity === "critical")
    )
  );
}

/** Top opportunities: positive-kind insights, most notable first. */
export function computeTopOpportunities(
  allInsights: InsightItem[],
  maxItems: number = EXECUTIVE_THRESHOLDS.maxTopOpportunities
): InsightItem[] {
  return sortInsights(allInsights.filter((item) => item.kind === "opportunity")).slice(0, maxItems);
}

/** Today's priorities: actionable (non-info-severity) risks, most urgent first. */
export function computeTodaysPriorities(
  allInsights: InsightItem[],
  maxItems: number = EXECUTIVE_THRESHOLDS.maxTodaysPriorities
): InsightItem[] {
  return sortInsights(
    allInsights.filter((item) => item.kind === "risk" && item.severity !== "info")
  ).slice(0, maxItems);
}

/** Executive summary: risks first (most urgent), then opportunities, capped. */
export function computeExecutiveSummary(
  allInsights: InsightItem[],
  maxItems: number = EXECUTIVE_THRESHOLDS.maxExecutiveSummaryItems
): InsightItem[] {
  const risks = sortInsights(allInsights.filter((item) => item.kind === "risk"));
  const opportunities = sortInsights(allInsights.filter((item) => item.kind === "opportunity"));
  return [...risks, ...opportunities].slice(0, maxItems);
}

export interface ExecutiveBriefing {
  overallScore: number;
  priority: BusinessHealthScoreResult["priority"];
  todaysPriorities: InsightItem[];
  criticalWarnings: InsightItem[];
  topOpportunities: InsightItem[];
}

/** Short, structured executive briefing (no English paragraphs). */
export function computeExecutiveBriefing(
  health: BusinessHealthScoreResult,
  allInsights: InsightItem[]
): ExecutiveBriefing {
  return {
    overallScore: health.overallScore,
    priority: health.priority,
    todaysPriorities: computeTodaysPriorities(allInsights),
    criticalWarnings: computeCriticalWarnings(allInsights),
    topOpportunities: computeTopOpportunities(allInsights),
  };
}
