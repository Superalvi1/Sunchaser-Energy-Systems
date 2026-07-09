/**
 * Sales intelligence — deterministic, pure functions over SafeBusinessSummary.
 *
 * SafeBusinessSummary only exposes safe, aggregated counts (no dates, no
 * per-row PII). Metrics below are therefore proxies computed strictly from
 * those counts — documented per metric — never from raw CRM rows.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

export const SALES_THRESHOLDS = {
  /** % of leads still open (new/contacted/quoted/negotiation) vs total. */
  leadBacklogRatioHigh: 60,
  /** Absolute count of open quotations considered a backlog. */
  quoteBacklogCountHigh: 5,
  /** % of leads stuck at "new" (never progressed) — proxy for aging risk. */
  leadAgingRatioHigh: 50,
  /** % of leads stuck at "contacted" (no next step) — proxy for missed follow-up. */
  followUpRatioHigh: 50,
  /** Minimum won/total % to be considered a healthy, converting pipeline. */
  pipelineBalanceHealthyMin: 30,
  /** Any project stuck in an unrecognized/"other" stage counts as stalled. */
  stalledProjectsCountWarning: 1,
};

const OPEN_LEAD_BUCKETS = ["new", "contacted", "quoted", "negotiation"] as const;

function round(n: number): number {
  return Math.round(n);
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round((numerator / denominator) * 100);
}

export interface SalesMetrics {
  totalLeads: number;
  leadBacklog: number;
  leadBacklogRatio: number;
  quoteBacklog: number;
  wonCount: number;
  lostCount: number;
  pipelineBalance: number;
  leadAgingRiskRatio: number;
  followUpRiskRatio: number;
  stalledProjectsCount: number;
  healthyPipelineIndicator: boolean;
}

export function calculateSalesMetrics(summary: SafeBusinessSummary): SalesMetrics | null {
  if (!summary.leads) return null;

  const byStatus = summary.leads.byStatus || {};
  const totalLeads = summary.leads.total;

  const leadBacklog = OPEN_LEAD_BUCKETS.reduce((sum, key) => sum + (byStatus[key] ?? 0), 0);
  const wonCount = byStatus.won ?? 0;
  const lostCount = byStatus.lost ?? 0;
  const newCount = byStatus.new ?? 0;
  const contactedCount = byStatus.contacted ?? 0;

  const leadBacklogRatio = ratio(leadBacklog, totalLeads);
  const pipelineBalance = ratio(wonCount, totalLeads);
  const leadAgingRiskRatio = ratio(newCount, totalLeads);
  const followUpRiskRatio = ratio(contactedCount, totalLeads);
  const quoteBacklog = summary.quotations?.total ?? 0;

  const byStage = summary.projects?.byStage || {};
  const stalledProjectsCount = (byStage.other ?? 0) + (byStage.unknown ?? 0);

  const healthyPipelineIndicator =
    totalLeads > 0 &&
    pipelineBalance >= SALES_THRESHOLDS.pipelineBalanceHealthyMin &&
    followUpRiskRatio < SALES_THRESHOLDS.followUpRatioHigh &&
    leadAgingRiskRatio < SALES_THRESHOLDS.leadAgingRatioHigh;

  return {
    totalLeads,
    leadBacklog,
    leadBacklogRatio,
    quoteBacklog,
    wonCount,
    lostCount,
    pipelineBalance,
    leadAgingRiskRatio,
    followUpRiskRatio,
    stalledProjectsCount,
    healthyPipelineIndicator,
  };
}

/** 0-100 raw category score used by BusinessHealthScore. 100 = healthy, not applicable when no data. */
export function computeSalesScore(summary: SafeBusinessSummary): number {
  const metrics = calculateSalesMetrics(summary);
  if (!metrics) return 100;

  let score = 100;
  if (metrics.leadBacklogRatio >= SALES_THRESHOLDS.leadBacklogRatioHigh) score -= 20;
  if (metrics.quoteBacklog >= SALES_THRESHOLDS.quoteBacklogCountHigh) score -= 15;
  if (metrics.leadAgingRiskRatio >= SALES_THRESHOLDS.leadAgingRatioHigh) score -= 20;
  if (metrics.followUpRiskRatio >= SALES_THRESHOLDS.followUpRatioHigh) score -= 15;
  if (metrics.stalledProjectsCount >= SALES_THRESHOLDS.stalledProjectsCountWarning) score -= 10;
  if (metrics.totalLeads > 0 && !metrics.healthyPipelineIndicator) score -= 5;

  return Math.max(0, Math.min(100, score));
}

export function computeSalesInsights(summary: SafeBusinessSummary): InsightItem[] {
  const metrics = calculateSalesMetrics(summary);
  if (!metrics) return [];

  const insights: InsightItem[] = [
    makeInsight({
      code: "SALES_LEAD_BACKLOG",
      category: "sales",
      kind: "info",
      severity: "info",
      metric: "leadBacklog",
      value: metrics.leadBacklog,
    }),
    makeInsight({
      code: "SALES_QUOTE_BACKLOG",
      category: "sales",
      kind: "info",
      severity: "info",
      metric: "quoteBacklog",
      value: metrics.quoteBacklog,
    }),
    makeInsight({
      code: "SALES_PIPELINE_BALANCE",
      category: "sales",
      kind: "info",
      severity: "info",
      metric: "pipelineBalance",
      value: metrics.pipelineBalance,
    }),
  ];

  if (metrics.leadBacklogRatio >= SALES_THRESHOLDS.leadBacklogRatioHigh) {
    insights.push(
      makeInsight({
        code: "SALES_LEAD_BACKLOG_HIGH",
        category: "sales",
        kind: "risk",
        severity: "high",
        metric: "leadBacklogRatio",
        value: metrics.leadBacklogRatio,
        threshold: SALES_THRESHOLDS.leadBacklogRatioHigh,
      })
    );
  }

  if (metrics.quoteBacklog >= SALES_THRESHOLDS.quoteBacklogCountHigh) {
    insights.push(
      makeInsight({
        code: "SALES_QUOTE_BACKLOG_HIGH",
        category: "sales",
        kind: "risk",
        severity: "medium",
        metric: "quoteBacklog",
        value: metrics.quoteBacklog,
        threshold: SALES_THRESHOLDS.quoteBacklogCountHigh,
      })
    );
  }

  if (metrics.leadAgingRiskRatio >= SALES_THRESHOLDS.leadAgingRatioHigh) {
    insights.push(
      makeInsight({
        code: "SALES_LEAD_AGING_RISK",
        category: "sales",
        kind: "risk",
        severity: "high",
        metric: "leadAgingRiskRatio",
        value: metrics.leadAgingRiskRatio,
        threshold: SALES_THRESHOLDS.leadAgingRatioHigh,
      })
    );
  }

  if (metrics.followUpRiskRatio >= SALES_THRESHOLDS.followUpRatioHigh) {
    insights.push(
      makeInsight({
        code: "SALES_MISSING_FOLLOWUP_RISK",
        category: "sales",
        kind: "risk",
        severity: "medium",
        metric: "followUpRiskRatio",
        value: metrics.followUpRiskRatio,
        threshold: SALES_THRESHOLDS.followUpRatioHigh,
      })
    );
  }

  if (metrics.stalledProjectsCount >= SALES_THRESHOLDS.stalledProjectsCountWarning) {
    insights.push(
      makeInsight({
        code: "SALES_STALLED_PROJECTS",
        category: "sales",
        kind: "risk",
        severity: "medium",
        metric: "stalledProjectsCount",
        value: metrics.stalledProjectsCount,
        threshold: SALES_THRESHOLDS.stalledProjectsCountWarning,
      })
    );
  }

  if (metrics.healthyPipelineIndicator) {
    insights.push(
      makeInsight({
        code: "SALES_PIPELINE_HEALTHY",
        category: "sales",
        kind: "opportunity",
        severity: "info",
        metric: "pipelineBalance",
        value: metrics.pipelineBalance,
        threshold: SALES_THRESHOLDS.pipelineBalanceHealthyMin,
      })
    );
  }

  return insights;
}
