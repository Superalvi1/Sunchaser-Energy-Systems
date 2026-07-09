import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  calculateSupportMetrics,
  computeSupportInsights,
  computeSupportScore,
  SUPPORT_THRESHOLDS,
} from "./SupportInsights.ts";

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
  "calculateSupportMetrics returns null with no tickets/serviceRequests data",
  calculateSupportMetrics(baseSummary()) === null
);

check(
  "computeSupportScore returns neutral 100 when no data is present",
  computeSupportScore(baseSummary()) === 100
);

check(
  "high open ticket ratio triggers SUPPORT_TICKET_LOAD_HIGH",
  (() => {
    const summary = baseSummary({ tickets: { total: 10, open: 7 } });
    return computeSupportInsights(summary).some((i) => i.code === "SUPPORT_TICKET_LOAD_HIGH");
  })()
);

check(
  "high open service request ratio triggers SUPPORT_SERVICE_REQUEST_PRESSURE_HIGH",
  (() => {
    const summary = baseSummary({ serviceRequests: { total: 10, open: 7 } });
    return computeSupportInsights(summary).some((i) => i.code === "SUPPORT_SERVICE_REQUEST_PRESSURE_HIGH");
  })()
);

check(
  "very high ticket load triggers the critical SUPPORT_REPEATED_PRESSURE_RISK insight",
  (() => {
    const summary = baseSummary({ tickets: { total: 10, open: 9 } });
    const found = computeSupportInsights(summary).find((i) => i.code === "SUPPORT_REPEATED_PRESSURE_RISK");
    return found !== undefined && found.severity === "critical";
  })()
);

check(
  "low support load triggers SUPPORT_LOAD_MANAGEABLE opportunity",
  (() => {
    const summary = baseSummary({ tickets: { total: 10, open: 2 }, serviceRequests: { total: 10, open: 1 } });
    return computeSupportInsights(summary).some((i) => i.code === "SUPPORT_LOAD_MANAGEABLE" && i.kind === "opportunity");
  })()
);

check(
  "computeSupportScore decreases as ticket/service request pressure increases",
  (() => {
    const healthy = baseSummary({ tickets: { total: 10, open: 1 } });
    const risky = baseSummary({ tickets: { total: 10, open: 9 }, serviceRequests: { total: 10, open: 8 } });
    return computeSupportScore(healthy) > computeSupportScore(risky);
  })()
);

check(
  "computeSupportInsights is deterministic across repeated calls",
  (() => {
    const summary = baseSummary({ tickets: { total: 6, open: 4 }, serviceRequests: { total: 3, open: 1 } });
    return (
      JSON.stringify(computeSupportInsights(summary)) === JSON.stringify(computeSupportInsights(summary))
    );
  })()
);

check(
  "SUPPORT_THRESHOLDS are exposed as configurable numeric constants",
  typeof SUPPORT_THRESHOLDS.ticketLoadRatioHigh === "number"
);

console.log(`\nSupportInsights tests: ${pass} passed`);
