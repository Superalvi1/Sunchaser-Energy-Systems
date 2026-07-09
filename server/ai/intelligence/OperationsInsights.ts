/**
 * Operations intelligence — deterministic, pure functions over SafeBusinessSummary.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

export const OPERATIONS_THRESHOLDS = {
  /** % of projects currently in an installation-related stage. */
  installationPressureHigh: 60,
  /** % of deliveries still pending vs total. */
  deliveryBacklogRatioHigh: 50,
  todayWorkloadHigh: 5,
  tomorrowWorkloadHigh: 5,
};

/** Project stage buckets that represent active installation work-in-progress. */
const INSTALL_STAGE_BUCKETS = [
  "installation",
  "installation_scheduled",
  "installation_completed",
  "structure_installation",
  "panel_installation",
  "inverter_installation",
  "testing_commissioning",
] as const;

function round(n: number): number {
  return Math.round(n);
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round((numerator / denominator) * 100);
}

export interface OperationsMetrics {
  totalProjects: number;
  pendingInstalls: number;
  installationPressure: number;
  deliveryTotal: number;
  deliveryBacklog: number;
  deliveryBacklogRatio: number;
  todayWorkload: number;
  tomorrowWorkload: number;
  operationsOnTrack: boolean;
}

export function calculateOperationsMetrics(summary: SafeBusinessSummary): OperationsMetrics | null {
  if (!summary.projects && !summary.deliveries && !summary.tasks) return null;

  const byStage = summary.projects?.byStage || {};
  const totalProjects = summary.projects?.total ?? 0;
  const pendingInstalls = INSTALL_STAGE_BUCKETS.reduce((sum, key) => sum + (byStage[key] ?? 0), 0);
  const installationPressure = ratio(pendingInstalls, totalProjects);

  const deliveryTotal = summary.deliveries?.total ?? 0;
  const deliveryBacklog = summary.deliveries?.pending ?? 0;
  const deliveryBacklogRatio = ratio(deliveryBacklog, deliveryTotal);

  const todayWorkload = summary.tasks?.today ?? 0;
  const tomorrowWorkload = summary.tasks?.tomorrow ?? 0;

  const operationsOnTrack =
    installationPressure < OPERATIONS_THRESHOLDS.installationPressureHigh &&
    deliveryBacklogRatio < OPERATIONS_THRESHOLDS.deliveryBacklogRatioHigh &&
    todayWorkload < OPERATIONS_THRESHOLDS.todayWorkloadHigh;

  return {
    totalProjects,
    pendingInstalls,
    installationPressure,
    deliveryTotal,
    deliveryBacklog,
    deliveryBacklogRatio,
    todayWorkload,
    tomorrowWorkload,
    operationsOnTrack,
  };
}

export function computeOperationsScore(summary: SafeBusinessSummary): number {
  const metrics = calculateOperationsMetrics(summary);
  if (!metrics) return 100;

  let score = 100;
  if (metrics.installationPressure >= OPERATIONS_THRESHOLDS.installationPressureHigh) score -= 25;
  if (metrics.deliveryBacklogRatio >= OPERATIONS_THRESHOLDS.deliveryBacklogRatioHigh) score -= 25;
  if (metrics.todayWorkload >= OPERATIONS_THRESHOLDS.todayWorkloadHigh) score -= 15;
  if (metrics.tomorrowWorkload >= OPERATIONS_THRESHOLDS.tomorrowWorkloadHigh) score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function computeOperationsInsights(summary: SafeBusinessSummary): InsightItem[] {
  const metrics = calculateOperationsMetrics(summary);
  if (!metrics) return [];

  const insights: InsightItem[] = [
    makeInsight({
      code: "OPS_PENDING_INSTALLS",
      category: "operations",
      kind: "info",
      severity: "info",
      metric: "pendingInstalls",
      value: metrics.pendingInstalls,
    }),
    makeInsight({
      code: "OPS_TODAY_WORKLOAD",
      category: "operations",
      kind: "info",
      severity: "info",
      metric: "todayWorkload",
      value: metrics.todayWorkload,
    }),
    makeInsight({
      code: "OPS_TOMORROW_WORKLOAD",
      category: "operations",
      kind: "info",
      severity: "info",
      metric: "tomorrowWorkload",
      value: metrics.tomorrowWorkload,
    }),
  ];

  if (metrics.installationPressure >= OPERATIONS_THRESHOLDS.installationPressureHigh) {
    insights.push(
      makeInsight({
        code: "OPS_INSTALLATION_PRESSURE_HIGH",
        category: "operations",
        kind: "risk",
        severity: "high",
        metric: "installationPressure",
        value: metrics.installationPressure,
        threshold: OPERATIONS_THRESHOLDS.installationPressureHigh,
      })
    );
  }

  if (metrics.deliveryBacklogRatio >= OPERATIONS_THRESHOLDS.deliveryBacklogRatioHigh) {
    insights.push(
      makeInsight({
        code: "OPS_DELIVERY_BACKLOG_HIGH",
        category: "operations",
        kind: "risk",
        severity: "high",
        metric: "deliveryBacklogRatio",
        value: metrics.deliveryBacklogRatio,
        threshold: OPERATIONS_THRESHOLDS.deliveryBacklogRatioHigh,
      })
    );
  }

  if (metrics.todayWorkload >= OPERATIONS_THRESHOLDS.todayWorkloadHigh) {
    insights.push(
      makeInsight({
        code: "OPS_TODAY_WORKLOAD_HIGH",
        category: "operations",
        kind: "risk",
        severity: "medium",
        metric: "todayWorkload",
        value: metrics.todayWorkload,
        threshold: OPERATIONS_THRESHOLDS.todayWorkloadHigh,
      })
    );
  }

  if (metrics.tomorrowWorkload >= OPERATIONS_THRESHOLDS.tomorrowWorkloadHigh) {
    insights.push(
      makeInsight({
        code: "OPS_TOMORROW_WORKLOAD_HIGH",
        category: "operations",
        kind: "risk",
        severity: "low",
        metric: "tomorrowWorkload",
        value: metrics.tomorrowWorkload,
        threshold: OPERATIONS_THRESHOLDS.tomorrowWorkloadHigh,
      })
    );
  }

  if (metrics.operationsOnTrack) {
    insights.push(
      makeInsight({
        code: "OPS_ON_TRACK",
        category: "operations",
        kind: "opportunity",
        severity: "info",
        metric: "installationPressure",
        value: metrics.installationPressure,
      })
    );
  }

  return insights;
}
