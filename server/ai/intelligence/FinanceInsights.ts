/**
 * Finance intelligence — deterministic, pure functions over SafeBusinessSummary.
 *
 * SafeBusinessSummary exposes only aggregated invoice counts/amounts for the
 * current snapshot (no per-invoice rows, no customer identity, no history).
 * "Trend" and "concentration" below are therefore snapshot proxies — clearly
 * documented — never computed from raw invoice rows or historical data.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

export const FINANCE_THRESHOLDS = {
  /** % overdue considered a warning. */
  overduePercentWarning: 20,
  /** % overdue considered critical. */
  overduePercentCritical: 50,
  /** Revenue is "concentrated" when very few invoices carry all the amount. */
  concentrationMaxInvoiceCount: 3,
  concentrationMinAmount: 1,
  /** Minimum "collected" % (non-overdue share) to call cashflow healthy. */
  healthyCollectionMin: 80,
};

function round(n: number): number {
  return Math.round(n);
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round((numerator / denominator) * 100);
}

export interface FinanceMetrics {
  totalCount: number;
  totalAmount: number;
  overdueCount: number;
  overduePercent: number;
  averageInvoiceAmount: number;
  invoiceConcentrationRisk: boolean;
  /** Proxy for "cash collection trend": share of invoices not overdue, this snapshot. */
  cashCollectionHealth: number;
  healthyCashflowIndicator: boolean;
}

export function calculateFinanceMetrics(summary: SafeBusinessSummary): FinanceMetrics | null {
  if (!summary.invoices) return null;

  const { totalCount, totalAmount, overdueCount } = summary.invoices;
  const overduePercent = ratio(overdueCount, totalCount);
  const averageInvoiceAmount = totalCount > 0 ? round(totalAmount / totalCount) : 0;
  const invoiceConcentrationRisk =
    totalCount > 0 &&
    totalCount <= FINANCE_THRESHOLDS.concentrationMaxInvoiceCount &&
    totalAmount >= FINANCE_THRESHOLDS.concentrationMinAmount;
  const cashCollectionHealth = ratio(Math.max(0, totalCount - overdueCount), totalCount);
  const healthyCashflowIndicator =
    totalCount > 0 && overduePercent <= FINANCE_THRESHOLDS.overduePercentWarning;

  return {
    totalCount,
    totalAmount,
    overdueCount,
    overduePercent,
    averageInvoiceAmount,
    invoiceConcentrationRisk,
    cashCollectionHealth,
    healthyCashflowIndicator,
  };
}

export function computeFinanceScore(summary: SafeBusinessSummary): number {
  const metrics = calculateFinanceMetrics(summary);
  if (!metrics) return 100;
  if (metrics.totalCount === 0) return 100;

  let score = 100 - metrics.overduePercent;
  if (metrics.invoiceConcentrationRisk) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeFinanceInsights(summary: SafeBusinessSummary): InsightItem[] {
  const metrics = calculateFinanceMetrics(summary);
  if (!metrics) return [];

  const insights: InsightItem[] = [
    makeInsight({
      code: "FINANCE_INVOICE_TOTALS",
      category: "finance",
      kind: "info",
      severity: "info",
      metric: "totalAmount",
      value: metrics.totalAmount,
    }),
    makeInsight({
      code: "FINANCE_PAYMENT_RISK",
      category: "finance",
      kind: "info",
      severity: "info",
      metric: "overduePercent",
      value: metrics.overduePercent,
    }),
  ];

  if (metrics.totalCount === 0) {
    insights.push(
      makeInsight({
        code: "FINANCE_REVENUE_WARNING",
        category: "finance",
        kind: "risk",
        severity: "low",
        metric: "totalCount",
        value: 0,
      })
    );
    return insights;
  }

  if (metrics.overduePercent >= FINANCE_THRESHOLDS.overduePercentCritical) {
    insights.push(
      makeInsight({
        code: "FINANCE_OVERDUE_CRITICAL",
        category: "finance",
        kind: "risk",
        severity: "critical",
        metric: "overduePercent",
        value: metrics.overduePercent,
        threshold: FINANCE_THRESHOLDS.overduePercentCritical,
      })
    );
  } else if (metrics.overduePercent >= FINANCE_THRESHOLDS.overduePercentWarning) {
    insights.push(
      makeInsight({
        code: "FINANCE_OVERDUE_WARNING",
        category: "finance",
        kind: "risk",
        severity: "medium",
        metric: "overduePercent",
        value: metrics.overduePercent,
        threshold: FINANCE_THRESHOLDS.overduePercentWarning,
      })
    );
  }

  if (metrics.invoiceConcentrationRisk) {
    insights.push(
      makeInsight({
        code: "FINANCE_INVOICE_CONCENTRATION_RISK",
        category: "finance",
        kind: "risk",
        severity: "medium",
        metric: "totalCount",
        value: metrics.totalCount,
        threshold: FINANCE_THRESHOLDS.concentrationMaxInvoiceCount,
      })
    );
  }

  if (metrics.healthyCashflowIndicator) {
    insights.push(
      makeInsight({
        code: "FINANCE_HEALTHY_CASHFLOW",
        category: "finance",
        kind: "opportunity",
        severity: "info",
        metric: "cashCollectionHealth",
        value: metrics.cashCollectionHealth,
        threshold: FINANCE_THRESHOLDS.healthyCollectionMin,
      })
    );
  }

  return insights;
}
