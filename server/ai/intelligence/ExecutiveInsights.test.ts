import assert from "node:assert/strict";
import {
  computeCriticalWarnings,
  computeExecutiveBriefing,
  computeExecutiveSummary,
  computeTodaysPriorities,
  computeTopOpportunities,
  EXECUTIVE_THRESHOLDS,
} from "./ExecutiveInsights.ts";
import { makeInsight, type InsightItem } from "./InsightModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const sampleInsights: InsightItem[] = [
  makeInsight({
    code: "FINANCE_OVERDUE_CRITICAL",
    category: "finance",
    kind: "risk",
    severity: "critical",
    metric: "overduePercent",
    value: 80,
  }),
  makeInsight({
    code: "SALES_LEAD_BACKLOG_HIGH",
    category: "sales",
    kind: "risk",
    severity: "high",
    metric: "leadBacklogRatio",
    value: 70,
  }),
  makeInsight({
    code: "OPS_TOMORROW_WORKLOAD_HIGH",
    category: "operations",
    kind: "risk",
    severity: "low",
    metric: "tomorrowWorkload",
    value: 6,
  }),
  makeInsight({
    code: "SALES_PIPELINE_BALANCE",
    category: "sales",
    kind: "info",
    severity: "info",
    metric: "pipelineBalance",
    value: 40,
  }),
  makeInsight({
    code: "SALES_PIPELINE_HEALTHY",
    category: "sales",
    kind: "opportunity",
    severity: "info",
    metric: "pipelineBalance",
    value: 40,
  }),
  makeInsight({
    code: "PROCUREMENT_INVENTORY_HEALTHY",
    category: "procurement",
    kind: "opportunity",
    severity: "info",
    metric: "lowStockCount",
    value: 0,
  }),
];

check(
  "computeCriticalWarnings only includes risk-kind, high/critical severity insights",
  (() => {
    const warnings = computeCriticalWarnings(sampleInsights);
    return (
      warnings.length === 2 &&
      warnings.every((w) => w.kind === "risk" && (w.severity === "high" || w.severity === "critical"))
    );
  })()
);

check(
  "computeCriticalWarnings orders critical severity before high severity",
  computeCriticalWarnings(sampleInsights)[0].code === "FINANCE_OVERDUE_CRITICAL"
);

check(
  "computeTopOpportunities only includes opportunity-kind insights",
  (() => {
    const opportunities = computeTopOpportunities(sampleInsights);
    return opportunities.length === 2 && opportunities.every((o) => o.kind === "opportunity");
  })()
);

check(
  "computeTopOpportunities respects the maxItems cap",
  computeTopOpportunities(sampleInsights, 1).length === 1
);

check(
  "computeTodaysPriorities excludes info-severity risk insights",
  (() => {
    const priorities = computeTodaysPriorities(sampleInsights);
    return priorities.every((p) => p.kind === "risk" && p.severity !== "info") && priorities.length === 3;
  })()
);

check(
  "computeExecutiveSummary places all risks before opportunities and respects the cap",
  (() => {
    const summary = computeExecutiveSummary(sampleInsights, 4);
    const riskCount = summary.filter((i) => i.kind === "risk").length;
    return summary.length === 4 && riskCount === 3 && summary[3].kind === "opportunity";
  })()
);

check(
  "empty insight list yields empty warnings, opportunities, and executive summary",
  computeCriticalWarnings([]).length === 0 &&
    computeTopOpportunities([]).length === 0 &&
    computeExecutiveSummary([]).length === 0
);

check(
  "computeExecutiveBriefing packages score, priority, and ranked insight lists",
  (() => {
    const briefing = computeExecutiveBriefing(
      { overallScore: 72, priority: "Medium", breakdown: [] },
      sampleInsights
    );
    return (
      briefing.overallScore === 72 &&
      briefing.priority === "Medium" &&
      briefing.criticalWarnings.length === 2 &&
      briefing.topOpportunities.length === 2 &&
      briefing.todaysPriorities.length === 3
    );
  })()
);

check(
  "EXECUTIVE_THRESHOLDS exposes configurable cap constants",
  typeof EXECUTIVE_THRESHOLDS.maxExecutiveSummaryItems === "number"
);

console.log(`\nExecutiveInsights tests: ${pass} passed`);
