import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  calculateOperationsMetrics,
  computeOperationsInsights,
  computeOperationsScore,
  OPERATIONS_THRESHOLDS,
} from "./OperationsInsights.ts";

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
  "calculateOperationsMetrics returns null with no projects/deliveries/tasks data",
  calculateOperationsMetrics(baseSummary()) === null
);

check(
  "computeOperationsScore returns neutral 100 when no data is present",
  computeOperationsScore(baseSummary()) === 100
);

check(
  "pendingInstalls sums all installation-related project stage buckets",
  (() => {
    const summary = baseSummary({
      projects: {
        total: 10,
        byStage: { installation: 2, panel_installation: 1, testing_commissioning: 1, completed: 6 },
      },
    });
    return calculateOperationsMetrics(summary)?.pendingInstalls === 4;
  })()
);

check(
  "high installationPressure triggers OPS_INSTALLATION_PRESSURE_HIGH",
  (() => {
    const summary = baseSummary({
      projects: { total: 10, byStage: { installation: 7, completed: 3 } },
    });
    const insights = computeOperationsInsights(summary);
    return insights.some((i) => i.code === "OPS_INSTALLATION_PRESSURE_HIGH" && i.severity === "high");
  })()
);

check(
  "high deliveryBacklogRatio triggers OPS_DELIVERY_BACKLOG_HIGH",
  (() => {
    const summary = baseSummary({ deliveries: { total: 10, pending: 6 } });
    return computeOperationsInsights(summary).some((i) => i.code === "OPS_DELIVERY_BACKLOG_HIGH");
  })()
);

check(
  "today/tomorrow workload above threshold trigger the respective workload-high insights",
  (() => {
    const summary = baseSummary({ tasks: { today: 6, tomorrow: 7 } });
    const insights = computeOperationsInsights(summary);
    return (
      insights.some((i) => i.code === "OPS_TODAY_WORKLOAD_HIGH") &&
      insights.some((i) => i.code === "OPS_TOMORROW_WORKLOAD_HIGH")
    );
  })()
);

check(
  "low pressure across the board triggers OPS_ON_TRACK opportunity",
  (() => {
    const summary = baseSummary({
      projects: { total: 10, byStage: { completed: 10 } },
      deliveries: { total: 10, pending: 1 },
      tasks: { today: 1, tomorrow: 1 },
    });
    const insights = computeOperationsInsights(summary);
    return insights.some((i) => i.code === "OPS_ON_TRACK" && i.kind === "opportunity");
  })()
);

check(
  "computeOperationsScore decreases as installation pressure and backlog rise",
  (() => {
    const healthy = baseSummary({
      projects: { total: 10, byStage: { completed: 10 } },
      deliveries: { total: 10, pending: 1 },
    });
    const risky = baseSummary({
      projects: { total: 10, byStage: { installation: 8 } },
      deliveries: { total: 10, pending: 8 },
      tasks: { today: 8, tomorrow: 8 },
    });
    return computeOperationsScore(healthy) > computeOperationsScore(risky);
  })()
);

check(
  "computeOperationsScore never drops below 0",
  (() => {
    const summary = baseSummary({
      projects: { total: 10, byStage: { installation: 10 } },
      deliveries: { total: 10, pending: 10 },
      tasks: { today: 20, tomorrow: 20 },
    });
    return computeOperationsScore(summary) >= 0;
  })()
);

check(
  "computeOperationsInsights is deterministic across repeated calls",
  (() => {
    const summary = baseSummary({
      projects: { total: 5, byStage: { installation: 2, completed: 3 } },
      deliveries: { total: 4, pending: 1 },
      tasks: { today: 2, tomorrow: 1 },
    });
    return (
      JSON.stringify(computeOperationsInsights(summary)) ===
      JSON.stringify(computeOperationsInsights(summary))
    );
  })()
);

check(
  "OPERATIONS_THRESHOLDS are exposed as configurable numeric constants",
  typeof OPERATIONS_THRESHOLDS.installationPressureHigh === "number"
);

console.log(`\nOperationsInsights tests: ${pass} passed`);
