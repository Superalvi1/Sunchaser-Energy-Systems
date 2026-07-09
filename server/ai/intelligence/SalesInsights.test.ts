import assert from "node:assert/strict";
import type { SafeBusinessSummary } from "../context/SafeBusinessContext.ts";
import {
  calculateSalesMetrics,
  computeSalesInsights,
  computeSalesScore,
  SALES_THRESHOLDS,
} from "./SalesInsights.ts";

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
  "calculateSalesMetrics returns null when leads data is absent (no sales visibility)",
  calculateSalesMetrics(baseSummary()) === null
);

check(
  "computeSalesScore returns neutral 100 when leads data is absent",
  computeSalesScore(baseSummary()) === 100
);

check(
  "computeSalesInsights returns empty array when leads data is absent",
  computeSalesInsights(baseSummary()).length === 0
);

check(
  "leadBacklog sums new+contacted+quoted+negotiation buckets",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { new: 3, contacted: 2, quoted: 1, negotiation: 1, won: 2, lost: 1 } },
    });
    const metrics = calculateSalesMetrics(summary);
    return metrics?.leadBacklog === 7;
  })()
);

check(
  "quoteBacklog reads quotations.total directly",
  (() => {
    const summary = baseSummary({
      leads: { total: 5, byStatus: { won: 5 } },
      quotations: { total: 8 },
    });
    return calculateSalesMetrics(summary)?.quoteBacklog === 8;
  })()
);

check(
  "pipelineBalance is won/total as a percentage",
  (() => {
    const summary = baseSummary({ leads: { total: 10, byStatus: { won: 4 } } });
    return calculateSalesMetrics(summary)?.pipelineBalance === 40;
  })()
);

check(
  "high leadBacklogRatio triggers SALES_LEAD_BACKLOG_HIGH risk insight",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { new: 7, won: 3 } },
    });
    const insights = computeSalesInsights(summary);
    const found = insights.find((i) => i.code === "SALES_LEAD_BACKLOG_HIGH");
    return found !== undefined && found.severity === "high" && found.kind === "risk";
  })()
);

check(
  "high leadAgingRiskRatio (many 'new' leads) triggers SALES_LEAD_AGING_RISK",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { new: 6, won: 4 } },
    });
    const insights = computeSalesInsights(summary);
    return insights.some((i) => i.code === "SALES_LEAD_AGING_RISK");
  })()
);

check(
  "high followUpRiskRatio (many 'contacted' leads) triggers SALES_MISSING_FOLLOWUP_RISK",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { contacted: 6, won: 4 } },
    });
    const insights = computeSalesInsights(summary);
    return insights.some((i) => i.code === "SALES_MISSING_FOLLOWUP_RISK");
  })()
);

check(
  "stalled projects (other/unknown stage) trigger SALES_STALLED_PROJECTS",
  (() => {
    const summary = baseSummary({
      leads: { total: 5, byStatus: { won: 5 } },
      projects: { total: 3, byStage: { other: 2, completed: 1 } },
    });
    const insights = computeSalesInsights(summary);
    return insights.some((i) => i.code === "SALES_STALLED_PROJECTS" && i.value === 2);
  })()
);

check(
  "healthy pipeline (good conversion, low risk ratios) triggers SALES_PIPELINE_HEALTHY opportunity",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { won: 6, lost: 1, new: 1, contacted: 1, quoted: 1 } },
    });
    const metrics = calculateSalesMetrics(summary);
    const insights = computeSalesInsights(summary);
    const opportunity = insights.find((i) => i.code === "SALES_PIPELINE_HEALTHY");
    return metrics?.healthyPipelineIndicator === true && opportunity?.kind === "opportunity";
  })()
);

check(
  "computeSalesScore decreases as more risk thresholds are crossed",
  (() => {
    const healthy = baseSummary({ leads: { total: 10, byStatus: { won: 6, lost: 1, contacted: 1 } } });
    const risky = baseSummary({
      leads: { total: 10, byStatus: { new: 7, contacted: 8, quoted: 0 } },
      quotations: { total: 9 },
      projects: { total: 2, byStage: { other: 1 } },
    });
    return computeSalesScore(healthy) > computeSalesScore(risky);
  })()
);

check(
  "computeSalesScore never drops below 0",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { new: 5, contacted: 5 } },
      quotations: { total: 20 },
      projects: { total: 5, byStage: { other: 5 } },
    });
    return computeSalesScore(summary) >= 0;
  })()
);

check(
  "computeSalesInsights is deterministic across repeated calls with identical input",
  (() => {
    const summary = baseSummary({
      leads: { total: 10, byStatus: { new: 4, contacted: 3, won: 3 } },
      quotations: { total: 6 },
    });
    const first = JSON.stringify(computeSalesInsights(summary));
    const second = JSON.stringify(computeSalesInsights(summary));
    return first === second;
  })()
);

check(
  "SALES_THRESHOLDS are exposed as configurable numeric constants",
  typeof SALES_THRESHOLDS.leadBacklogRatioHigh === "number" &&
    typeof SALES_THRESHOLDS.pipelineBalanceHealthyMin === "number"
);

console.log(`\nSalesInsights tests: ${pass} passed`);
