/**
 * Procurement / inventory intelligence — deterministic, pure functions over
 * SafeBusinessSummary.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

export const PROCUREMENT_THRESHOLDS = {
  lowStockWarningMin: 1,
  lowStockCriticalMin: 5,
  scorePenaltyPerItem: 10,
};

export interface ProcurementMetrics {
  lowStockCount: number;
  reorderRecommended: boolean;
  inventoryHealthy: boolean;
}

export function calculateProcurementMetrics(summary: SafeBusinessSummary): ProcurementMetrics | null {
  if (!summary.inventory) return null;

  const lowStockCount = summary.inventory.lowStockCount;
  return {
    lowStockCount,
    reorderRecommended: lowStockCount >= PROCUREMENT_THRESHOLDS.lowStockWarningMin,
    inventoryHealthy: lowStockCount === 0,
  };
}

export function computeProcurementScore(summary: SafeBusinessSummary): number {
  const metrics = calculateProcurementMetrics(summary);
  if (!metrics) return 100;

  const penalty = Math.min(100, metrics.lowStockCount * PROCUREMENT_THRESHOLDS.scorePenaltyPerItem);
  return Math.max(0, 100 - penalty);
}

export function computeProcurementInsights(summary: SafeBusinessSummary): InsightItem[] {
  const metrics = calculateProcurementMetrics(summary);
  if (!metrics) return [];

  const insights: InsightItem[] = [];

  if (metrics.lowStockCount >= PROCUREMENT_THRESHOLDS.lowStockCriticalMin) {
    insights.push(
      makeInsight({
        code: "PROCUREMENT_LOW_STOCK_CRITICAL",
        category: "procurement",
        kind: "risk",
        severity: "critical",
        metric: "lowStockCount",
        value: metrics.lowStockCount,
        threshold: PROCUREMENT_THRESHOLDS.lowStockCriticalMin,
      })
    );
  } else if (metrics.lowStockCount >= PROCUREMENT_THRESHOLDS.lowStockWarningMin) {
    insights.push(
      makeInsight({
        code: "PROCUREMENT_LOW_STOCK_WARNING",
        category: "procurement",
        kind: "risk",
        severity: "medium",
        metric: "lowStockCount",
        value: metrics.lowStockCount,
        threshold: PROCUREMENT_THRESHOLDS.lowStockWarningMin,
      })
    );
  }

  if (metrics.reorderRecommended) {
    insights.push(
      makeInsight({
        code: "PROCUREMENT_REORDER_RECOMMENDED",
        category: "procurement",
        kind: "risk",
        severity: "low",
        metric: "lowStockCount",
        value: metrics.lowStockCount,
      })
    );
  }

  if (metrics.inventoryHealthy) {
    insights.push(
      makeInsight({
        code: "PROCUREMENT_INVENTORY_HEALTHY",
        category: "procurement",
        kind: "opportunity",
        severity: "info",
        metric: "lowStockCount",
        value: metrics.lowStockCount,
      })
    );
  }

  return insights;
}
