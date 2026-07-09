import assert from "node:assert/strict";
import {
  DEFAULT_BUSINESS_HEALTH_WEIGHTS,
  makeInsight,
  SEVERITY_RANK,
} from "./InsightModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check(
  "makeInsight defaults value to 0 and threshold to null when omitted",
  (() => {
    const item = makeInsight({
      code: "TEST_CODE",
      category: "sales",
      kind: "info",
      severity: "info",
      metric: "test",
    });
    return item.value === 0 && item.threshold === null;
  })()
);

check(
  "makeInsight preserves provided value and threshold",
  (() => {
    const item = makeInsight({
      code: "TEST_CODE",
      category: "finance",
      kind: "risk",
      severity: "high",
      metric: "test",
      value: 42,
      threshold: 10,
    });
    return item.value === 42 && item.threshold === 10;
  })()
);

check(
  "makeInsight coerces non-finite values to 0",
  makeInsight({
    code: "TEST_CODE",
    category: "operations",
    kind: "info",
    severity: "info",
    metric: "test",
    value: Number.NaN,
  }).value === 0
);

check(
  "SEVERITY_RANK strictly increases from info to critical",
  SEVERITY_RANK.info < SEVERITY_RANK.low &&
    SEVERITY_RANK.low < SEVERITY_RANK.medium &&
    SEVERITY_RANK.medium < SEVERITY_RANK.high &&
    SEVERITY_RANK.high < SEVERITY_RANK.critical
);

check(
  "DEFAULT_BUSINESS_HEALTH_WEIGHTS sums to 100",
  Object.values(DEFAULT_BUSINESS_HEALTH_WEIGHTS).reduce((sum, w) => sum + w, 0) === 100
);

console.log(`\nInsightModels tests: ${pass} passed`);
