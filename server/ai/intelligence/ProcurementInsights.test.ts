import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  calculateProcurementMetrics,
  computeProcurementInsights,
  computeProcurementScore,
  PROCUREMENT_THRESHOLDS,
} from "./ProcurementInsights.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function baseSummary(overrides: Partial<SafeBusinessSummary> = {}): SafeBusinessSummary {
  return {
    scope: "admin",
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

check(
  "calculateProcurementMetrics returns null when inventory data is absent",
  calculateProcurementMetrics(baseSummary()) === null
);

check(
  "computeProcurementScore returns neutral 100 when inventory data is absent",
  computeProcurementScore(baseSummary()) === 100
);

check(
  "zero low-stock items yields PROCUREMENT_INVENTORY_HEALTHY opportunity and full score",
  (() => {
    const summary = baseSummary({ inventory: { lowStockCount: 0 } });
    const insights = computeProcurementInsights(summary);
    return (
      insights.length === 1 &&
      insights[0].code === "PROCUREMENT_INVENTORY_HEALTHY" &&
      computeProcurementScore(summary) === 100
    );
  })()
);

check(
  "1-4 low-stock items trigger PROCUREMENT_LOW_STOCK_WARNING (medium) and reorder recommendation",
  (() => {
    const summary = baseSummary({ inventory: { lowStockCount: 3 } });
    const insights = computeProcurementInsights(summary);
    return (
      insights.some((i) => i.code === "PROCUREMENT_LOW_STOCK_WARNING" && i.severity === "medium") &&
      insights.some((i) => i.code === "PROCUREMENT_REORDER_RECOMMENDED")
    );
  })()
);

check(
  "5+ low-stock items trigger PROCUREMENT_LOW_STOCK_CRITICAL instead of the warning",
  (() => {
    const summary = baseSummary({ inventory: { lowStockCount: 6 } });
    const insights = computeProcurementInsights(summary);
    return (
      insights.some((i) => i.code === "PROCUREMENT_LOW_STOCK_CRITICAL" && i.severity === "critical") &&
      !insights.some((i) => i.code === "PROCUREMENT_LOW_STOCK_WARNING")
    );
  })()
);

check(
  "computeProcurementScore applies a linear penalty per low-stock item, floored at 0",
  (() => {
    const summary = baseSummary({ inventory: { lowStockCount: 4 } });
    return computeProcurementScore(summary) === 60;
  })()
);

check(
  "computeProcurementScore never drops below 0 regardless of lowStockCount",
  computeProcurementScore(baseSummary({ inventory: { lowStockCount: 50 } })) === 0
);

check(
  "computeProcurementInsights is deterministic across repeated calls",
  (() => {
    const summary = baseSummary({ inventory: { lowStockCount: 2 } });
    return (
      JSON.stringify(computeProcurementInsights(summary)) ===
      JSON.stringify(computeProcurementInsights(summary))
    );
  })()
);

check(
  "PROCUREMENT_THRESHOLDS are exposed as configurable numeric constants",
  typeof PROCUREMENT_THRESHOLDS.lowStockCriticalMin === "number"
);

console.log(`\nProcurementInsights tests: ${pass} passed`);
