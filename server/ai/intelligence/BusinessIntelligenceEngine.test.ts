import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  computeTaskCompletionScore,
  DETERMINISTIC_GENERATED_AT_FALLBACK,
  generateBusinessInsightReport,
} from "./BusinessIntelligenceEngine.ts";

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
  "computeTaskCompletionScore returns 100 (neutral) when no task data is present",
  computeTaskCompletionScore(baseSummary()) === 100
);

check(
  "computeTaskCompletionScore decreases as today+tomorrow task load increases",
  computeTaskCompletionScore(baseSummary({ tasks: { today: 5, tomorrow: 5 } })) <
    computeTaskCompletionScore(baseSummary({ tasks: { today: 1, tomorrow: 0 } }))
);

const HEALTHY_SUMMARY = baseSummary({
  leads: { total: 20, byStatus: { won: 12, lost: 2, new: 2, contacted: 2, quoted: 2 } },
  quotations: { total: 4 },
  projects: { total: 10, byStage: { completed: 10 } },
  invoices: { totalCount: 30, totalAmount: 500000, overdueCount: 1 },
  deliveries: { total: 10, pending: 1 },
  tickets: { total: 10, open: 1 },
  serviceRequests: { total: 10, open: 1 },
  inventory: { lowStockCount: 0 },
  tasks: { today: 1, tomorrow: 1 },
});

const CRITICAL_SUMMARY = baseSummary({
  leads: { total: 20, byStatus: { new: 14, contacted: 15 } },
  quotations: { total: 12 },
  projects: { total: 10, byStage: { other: 4, installation: 8 } },
  invoices: { totalCount: 10, totalAmount: 900000, overdueCount: 8 },
  deliveries: { total: 10, pending: 9 },
  tickets: { total: 10, open: 9 },
  serviceRequests: { total: 10, open: 9 },
  inventory: { lowStockCount: 9 },
  tasks: { today: 10, tomorrow: 10 },
});

check(
  "report has every field described in the V4 spec (health score, priority, and per-category arrays)",
  (() => {
    const report = generateBusinessInsightReport(HEALTHY_SUMMARY, { now: "2026-01-01T00:00:00.000Z" });
    return (
      typeof report.businessHealthScore === "number" &&
      typeof report.priority === "string" &&
      Array.isArray(report.executiveSummary) &&
      Array.isArray(report.sales) &&
      Array.isArray(report.finance) &&
      Array.isArray(report.operations) &&
      Array.isArray(report.support) &&
      Array.isArray(report.procurement) &&
      Array.isArray(report.warnings) &&
      Array.isArray(report.opportunities) &&
      report.generatedAt === "2026-01-01T00:00:00.000Z"
    );
  })()
);

check(
  "a healthy business summary yields a high businessHealthScore and Low/Medium priority",
  (() => {
    const report = generateBusinessInsightReport(HEALTHY_SUMMARY);
    return report.businessHealthScore >= 80 && (report.priority === "Low" || report.priority === "Medium");
  })()
);

check(
  "a stressed business summary yields a low businessHealthScore and High/Critical priority",
  (() => {
    const report = generateBusinessInsightReport(CRITICAL_SUMMARY);
    return report.businessHealthScore <= 60 && (report.priority === "High" || report.priority === "Critical");
  })()
);

check(
  "a stressed business summary produces at least one warning and the healthy one does not",
  (() => {
    const risky = generateBusinessInsightReport(CRITICAL_SUMMARY);
    const healthy = generateBusinessInsightReport(HEALTHY_SUMMARY);
    return risky.warnings.length > 0 && healthy.warnings.length === 0;
  })()
);

check(
  "a healthy business summary produces at least one opportunity",
  generateBusinessInsightReport(HEALTHY_SUMMARY).opportunities.length > 0
);

check(
  "executiveSummary is drawn only from the union of per-category insight arrays",
  (() => {
    const report = generateBusinessInsightReport(CRITICAL_SUMMARY);
    const allCodes = new Set(
      [...report.sales, ...report.finance, ...report.operations, ...report.support, ...report.procurement].map(
        (i) => i.code
      )
    );
    return report.executiveSummary.every((i) => allCodes.has(i.code));
  })()
);

check(
  "a role with only technician-scoped data (no leads/finance/inventory) still produces a valid, neutral-leaning report",
  (() => {
    const technicianSummary = baseSummary({
      scope: "technician",
      assignedJobs: { serviceRequests: 2, supportTickets: 1, deliveries: 3 },
      serviceRequests: { total: 2, open: 1 },
      tickets: { total: 1, open: 0 },
      deliveries: { total: 3, pending: 1 },
    });
    const report = generateBusinessInsightReport(technicianSummary);
    return (
      report.sales.length === 0 &&
      report.finance.length === 0 &&
      report.procurement.length === 0 &&
      report.businessHealthScore >= 0 &&
      report.businessHealthScore <= 100
    );
  })()
);

check(
  "same summary with no options produces deepEqual output across two calls",
  (() => {
    const a = generateBusinessInsightReport(CRITICAL_SUMMARY);
    const b = generateBusinessInsightReport(CRITICAL_SUMMARY);
    assert.deepStrictEqual(a, b);
    return true;
  })()
);

check(
  "no options uses deterministic generatedAt fallback (no clock reads)",
  generateBusinessInsightReport(CRITICAL_SUMMARY).generatedAt === DETERMINISTIC_GENERATED_AT_FALLBACK
);

check(
  "explicit options.now is reflected exactly in generatedAt",
  (() => {
    const explicitNow = "2026-06-15T12:30:00.000Z";
    const report = generateBusinessInsightReport(CRITICAL_SUMMARY, { now: explicitNow });
    return report.generatedAt === explicitNow;
  })()
);

check(
  "generateBusinessInsightReport is deterministic when given an explicit clock",
  (() => {
    const a = generateBusinessInsightReport(CRITICAL_SUMMARY, { now: "2026-01-01T00:00:00.000Z" });
    const b = generateBusinessInsightReport(CRITICAL_SUMMARY, { now: "2026-01-01T00:00:00.000Z" });
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  "custom weight table changes the overall score deterministically",
  (() => {
    const defaultWeighted = generateBusinessInsightReport(CRITICAL_SUMMARY);
    const procurementHeavy = generateBusinessInsightReport(CRITICAL_SUMMARY, {
      weights: { sales: 0, finance: 0, operations: 0, support: 0, procurement: 100, taskCompletion: 0 },
    });
    return defaultWeighted.businessHealthScore !== procurementHeavy.businessHealthScore;
  })()
);

check(
  "report survives a JSON round-trip with no NaN values in any insight",
  (() => {
    const report = generateBusinessInsightReport(CRITICAL_SUMMARY);
    const roundTripped = JSON.parse(JSON.stringify(report));
    const allInsights = [
      ...report.sales,
      ...report.finance,
      ...report.operations,
      ...report.support,
      ...report.procurement,
    ];
    return (
      JSON.stringify(roundTripped) === JSON.stringify(report) &&
      allInsights.every((i) => Number.isFinite(i.value))
    );
  })()
);

console.log(`\nBusinessIntelligenceEngine tests: ${pass} passed`);
