/**
 * Support intelligence — deterministic, pure functions over SafeBusinessSummary.
 */

import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

export const SUPPORT_THRESHOLDS = {
  ticketLoadRatioHigh: 60,
  serviceRequestRatioHigh: 60,
  /** Sustained very-high open-ticket ratio is a proxy for repeated/unresolved pressure. */
  repeatedPressureRatioHigh: 80,
};

function round(n: number): number {
  return Math.round(n);
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round((numerator / denominator) * 100);
}

export interface SupportMetrics {
  ticketsTotal: number;
  ticketsOpen: number;
  ticketLoadRatio: number;
  serviceRequestsTotal: number;
  serviceRequestsOpen: number;
  serviceRequestRatio: number;
  repeatedSupportPressureRisk: boolean;
  supportManageable: boolean;
}

export function calculateSupportMetrics(summary: SafeBusinessSummary): SupportMetrics | null {
  if (!summary.tickets && !summary.serviceRequests) return null;

  const ticketsTotal = summary.tickets?.total ?? 0;
  const ticketsOpen = summary.tickets?.open ?? 0;
  const ticketLoadRatio = ratio(ticketsOpen, ticketsTotal);

  const serviceRequestsTotal = summary.serviceRequests?.total ?? 0;
  const serviceRequestsOpen = summary.serviceRequests?.open ?? 0;
  const serviceRequestRatio = ratio(serviceRequestsOpen, serviceRequestsTotal);

  const repeatedSupportPressureRisk = ticketLoadRatio >= SUPPORT_THRESHOLDS.repeatedPressureRatioHigh;
  const supportManageable =
    ticketLoadRatio < SUPPORT_THRESHOLDS.ticketLoadRatioHigh &&
    serviceRequestRatio < SUPPORT_THRESHOLDS.serviceRequestRatioHigh;

  return {
    ticketsTotal,
    ticketsOpen,
    ticketLoadRatio,
    serviceRequestsTotal,
    serviceRequestsOpen,
    serviceRequestRatio,
    repeatedSupportPressureRisk,
    supportManageable,
  };
}

export function computeSupportScore(summary: SafeBusinessSummary): number {
  const metrics = calculateSupportMetrics(summary);
  if (!metrics) return 100;

  let score = 100;
  if (metrics.ticketLoadRatio >= SUPPORT_THRESHOLDS.ticketLoadRatioHigh) score -= 25;
  if (metrics.serviceRequestRatio >= SUPPORT_THRESHOLDS.serviceRequestRatioHigh) score -= 25;
  if (metrics.repeatedSupportPressureRisk) score -= 20;

  return Math.max(0, Math.min(100, score));
}

export function computeSupportInsights(summary: SafeBusinessSummary): InsightItem[] {
  const metrics = calculateSupportMetrics(summary);
  if (!metrics) return [];

  const insights: InsightItem[] = [
    makeInsight({
      code: "SUPPORT_OPEN_TICKET_LOAD",
      category: "support",
      kind: "info",
      severity: "info",
      metric: "ticketsOpen",
      value: metrics.ticketsOpen,
    }),
    makeInsight({
      code: "SUPPORT_SERVICE_REQUEST_LOAD",
      category: "support",
      kind: "info",
      severity: "info",
      metric: "serviceRequestsOpen",
      value: metrics.serviceRequestsOpen,
    }),
  ];

  if (metrics.ticketLoadRatio >= SUPPORT_THRESHOLDS.ticketLoadRatioHigh) {
    insights.push(
      makeInsight({
        code: "SUPPORT_TICKET_LOAD_HIGH",
        category: "support",
        kind: "risk",
        severity: "high",
        metric: "ticketLoadRatio",
        value: metrics.ticketLoadRatio,
        threshold: SUPPORT_THRESHOLDS.ticketLoadRatioHigh,
      })
    );
  }

  if (metrics.serviceRequestRatio >= SUPPORT_THRESHOLDS.serviceRequestRatioHigh) {
    insights.push(
      makeInsight({
        code: "SUPPORT_SERVICE_REQUEST_PRESSURE_HIGH",
        category: "support",
        kind: "risk",
        severity: "high",
        metric: "serviceRequestRatio",
        value: metrics.serviceRequestRatio,
        threshold: SUPPORT_THRESHOLDS.serviceRequestRatioHigh,
      })
    );
  }

  if (metrics.repeatedSupportPressureRisk) {
    insights.push(
      makeInsight({
        code: "SUPPORT_REPEATED_PRESSURE_RISK",
        category: "support",
        kind: "risk",
        severity: "critical",
        metric: "ticketLoadRatio",
        value: metrics.ticketLoadRatio,
        threshold: SUPPORT_THRESHOLDS.repeatedPressureRatioHigh,
      })
    );
  }

  if (metrics.supportManageable) {
    insights.push(
      makeInsight({
        code: "SUPPORT_LOAD_MANAGEABLE",
        category: "support",
        kind: "opportunity",
        severity: "info",
        metric: "ticketLoadRatio",
        value: metrics.ticketLoadRatio,
      })
    );
  }

  return insights;
}
