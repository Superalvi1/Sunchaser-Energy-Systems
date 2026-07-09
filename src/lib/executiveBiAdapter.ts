/**
 * Client-side Executive BI adapter — wires app state → BusinessIntelligenceEngine.
 * Deterministic, no LLM, no API calls, no CRM mutation.
 */

import { generateBusinessInsightReport } from "../../server/ai/intelligence/BusinessIntelligenceEngine.ts";
import { computeBusinessHealthScore } from "../../server/ai/intelligence/BusinessHealthScore.ts";
import { computeTodaysPriorities } from "../../server/ai/intelligence/ExecutiveInsights.ts";
import { computeFinanceScore } from "../../server/ai/intelligence/FinanceInsights.ts";
import { computeOperationsScore } from "../../server/ai/intelligence/OperationsInsights.ts";
import { computeProcurementScore } from "../../server/ai/intelligence/ProcurementInsights.ts";
import { computeSalesScore } from "../../server/ai/intelligence/SalesInsights.ts";
import { computeSupportScore } from "../../server/ai/intelligence/SupportInsights.ts";
import { computeTaskCompletionScore } from "../../server/ai/intelligence/BusinessIntelligenceEngine.ts";
import type { InsightItem, PriorityLevel } from "../../server/ai/intelligence/InsightModels.ts";
import type { DashboardPriority } from "./enterpriseDashboard.ts";
import { formatInsights, type InsightDisplayItem } from "./insightLabels.ts";
import {
  buildSafeBusinessSummaryFromAppState,
  type SafeSummaryInput,
} from "./safeBusinessSummaryFromAppState.ts";

export interface DepartmentBiSection {
  id: "sales" | "finance" | "operations" | "support" | "procurement";
  label: string;
  score: number;
  insights: InsightDisplayItem[];
}

export interface ExecutiveBiViewModel {
  healthScore: number;
  healthPriority: DashboardPriority;
  healthBreakdown: { label: string; score: number }[];
  executiveSummary: InsightDisplayItem[];
  criticalWarnings: InsightDisplayItem[];
  opportunities: InsightDisplayItem[];
  todaysPriorities: InsightDisplayItem[];
  departments: DepartmentBiSection[];
  generatedAt: string;
  deterministic: true;
}

const CATEGORY_LABELS: Record<DepartmentBiSection["id"], string> = {
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
  support: "Support",
  procurement: "Procurement",
};

function toDashboardPriority(priority: PriorityLevel): DashboardPriority {
  return priority;
}

function allInsightsFromReport(report: ReturnType<typeof generateBusinessInsightReport>): InsightItem[] {
  return [
    ...report.sales,
    ...report.finance,
    ...report.operations,
    ...report.support,
    ...report.procurement,
  ];
}

export function buildExecutiveBiViewModel(input: SafeSummaryInput = {}): ExecutiveBiViewModel {
  const summary = buildSafeBusinessSummaryFromAppState(input);
  const report = generateBusinessInsightReport(summary);

  const rawScores = {
    sales: computeSalesScore(summary),
    finance: computeFinanceScore(summary),
    operations: computeOperationsScore(summary),
    support: computeSupportScore(summary),
    procurement: computeProcurementScore(summary),
    taskCompletion: computeTaskCompletionScore(summary),
  };

  const health = computeBusinessHealthScore(rawScores);
  const allInsights = allInsightsFromReport(report);
  const todaysPriorities = computeTodaysPriorities(allInsights);

  const healthBreakdown = health.breakdown
    .filter((row) => row.category !== "taskCompletion")
    .map((row) => ({
      label: CATEGORY_LABELS[row.category as DepartmentBiSection["id"]] ?? row.category,
      score: Math.round(row.rawScore),
    }));

  const departments: DepartmentBiSection[] = (
    ["sales", "finance", "operations", "support", "procurement"] as const
  ).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    score: Math.round(rawScores[id]),
    insights: formatInsights(report[id]),
  }));

  return {
    healthScore: report.businessHealthScore,
    healthPriority: toDashboardPriority(report.priority),
    healthBreakdown,
    executiveSummary: formatInsights(report.executiveSummary),
    criticalWarnings: formatInsights(report.warnings),
    opportunities: formatInsights(report.opportunities),
    todaysPriorities: formatInsights(todaysPriorities),
    departments,
    generatedAt: report.generatedAt,
    deterministic: true,
  };
}
