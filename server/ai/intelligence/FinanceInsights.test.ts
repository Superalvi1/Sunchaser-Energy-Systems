import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  calculateFinanceMetrics,
  computeFinanceInsights,
  computeFinanceScore,
  FINANCE_THRESHOLDS,
} from "./FinanceInsights.ts";

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
  "calculateFinanceMetrics returns null when invoices data is absent",
  calculateFinanceMetrics(baseSummary()) === null
);

check(
  "computeFinanceScore returns neutral 100 when invoices data is absent",
  computeFinanceScore(baseSummary()) === 100
);

check(
  "overduePercent is overdueCount / totalCount as a percentage",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 20, totalAmount: 1000, overdueCount: 5 } });
    return calculateFinanceMetrics(summary)?.overduePercent === 25;
  })()
);

check(
  "overduePercent >= critical threshold triggers FINANCE_OVERDUE_CRITICAL",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 10, totalAmount: 5000, overdueCount: 6 } });
    const insights = computeFinanceInsights(summary);
    const found = insights.find((i) => i.code === "FINANCE_OVERDUE_CRITICAL");
    return found !== undefined && found.severity === "critical";
  })()
);

check(
  "overduePercent between warning and critical triggers FINANCE_OVERDUE_WARNING only",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 10, totalAmount: 5000, overdueCount: 3 } });
    const insights = computeFinanceInsights(summary);
    return (
      insights.some((i) => i.code === "FINANCE_OVERDUE_WARNING") &&
      !insights.some((i) => i.code === "FINANCE_OVERDUE_CRITICAL")
    );
  })()
);

check(
  "few invoices with a large amount trigger FINANCE_INVOICE_CONCENTRATION_RISK",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 2, totalAmount: 500000, overdueCount: 0 } });
    return computeFinanceInsights(summary).some((i) => i.code === "FINANCE_INVOICE_CONCENTRATION_RISK");
  })()
);

check(
  "zero invoices triggers FINANCE_REVENUE_WARNING and no other finance insights",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 0, totalAmount: 0, overdueCount: 0 } });
    const insights = computeFinanceInsights(summary);
    return (
      insights.length === 3 &&
      insights.some((i) => i.code === "FINANCE_REVENUE_WARNING")
    );
  })()
);

check(
  "low overdue percent triggers FINANCE_HEALTHY_CASHFLOW opportunity",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 20, totalAmount: 10000, overdueCount: 1 } });
    const insights = computeFinanceInsights(summary);
    const opportunity = insights.find((i) => i.code === "FINANCE_HEALTHY_CASHFLOW");
    return opportunity !== undefined && opportunity.kind === "opportunity";
  })()
);

check(
  "computeFinanceScore decreases as overduePercent increases",
  (() => {
    const healthy = baseSummary({ invoices: { totalCount: 20, totalAmount: 10000, overdueCount: 1 } });
    const risky = baseSummary({ invoices: { totalCount: 20, totalAmount: 10000, overdueCount: 15 } });
    return computeFinanceScore(healthy) > computeFinanceScore(risky);
  })()
);

check(
  "computeFinanceScore stays within 0-100 bounds at 100% overdue",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 5, totalAmount: 1000, overdueCount: 5 } });
    const score = computeFinanceScore(summary);
    return score >= 0 && score <= 100;
  })()
);

check(
  "computeFinanceInsights is deterministic across repeated calls",
  (() => {
    const summary = baseSummary({ invoices: { totalCount: 12, totalAmount: 4000, overdueCount: 3 } });
    return JSON.stringify(computeFinanceInsights(summary)) === JSON.stringify(computeFinanceInsights(summary));
  })()
);

check(
  "FINANCE_THRESHOLDS are exposed as configurable numeric constants",
  typeof FINANCE_THRESHOLDS.overduePercentWarning === "number" &&
    typeof FINANCE_THRESHOLDS.overduePercentCritical === "number"
);

console.log(`\nFinanceInsights tests: ${pass} passed`);
