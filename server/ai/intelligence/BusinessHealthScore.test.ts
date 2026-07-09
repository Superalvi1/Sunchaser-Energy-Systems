import assert from "node:assert/strict";
import {
  computeBusinessHealthScore,
  priorityFromScore,
  type CategoryRawScores,
} from "./BusinessHealthScore.ts";
import { DEFAULT_BUSINESS_HEALTH_WEIGHTS } from "./InsightModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const ALL_100: CategoryRawScores = {
  sales: 100,
  finance: 100,
  operations: 100,
  support: 100,
  procurement: 100,
  taskCompletion: 100,
};

const ALL_0: CategoryRawScores = {
  sales: 0,
  finance: 0,
  operations: 0,
  support: 0,
  procurement: 0,
  taskCompletion: 0,
};

check("priorityFromScore(95) is Low", priorityFromScore(95) === "Low");
check("priorityFromScore(83) is Medium (matches spec example)", priorityFromScore(83) === "Medium");
check("priorityFromScore(50) is High", priorityFromScore(50) === "High");
check("priorityFromScore(10) is Critical", priorityFromScore(10) === "Critical");

check(
  "all-100 raw scores yields overallScore 100 and priority Low",
  (() => {
    const result = computeBusinessHealthScore(ALL_100);
    return result.overallScore === 100 && result.priority === "Low";
  })()
);

check(
  "all-0 raw scores yields overallScore 0 and priority Critical",
  (() => {
    const result = computeBusinessHealthScore(ALL_0);
    return result.overallScore === 0 && result.priority === "Critical";
  })()
);

check(
  "weighted sum matches manual calculation for mixed scores",
  (() => {
    const raw: CategoryRawScores = {
      sales: 80,
      finance: 90,
      operations: 70,
      support: 100,
      procurement: 100,
      taskCompletion: 100,
    };
    const expected = Math.round(
      (80 * 25 + 90 * 25 + 70 * 20 + 100 * 10 + 100 * 10 + 100 * 10) / 100
    );
    const result = computeBusinessHealthScore(raw, DEFAULT_BUSINESS_HEALTH_WEIGHTS);
    return result.overallScore === expected;
  })()
);

check(
  "breakdown includes one entry per category with correct weight",
  (() => {
    const result = computeBusinessHealthScore(ALL_100);
    return (
      result.breakdown.length === 6 &&
      result.breakdown.find((b) => b.category === "sales")?.weight === 25 &&
      result.breakdown.find((b) => b.category === "taskCompletion")?.weight === 10
    );
  })()
);

check(
  "non-100-summing custom weights are normalized against their own total",
  (() => {
    const customWeights = {
      sales: 50,
      finance: 50,
      operations: 0,
      support: 0,
      procurement: 0,
      taskCompletion: 0,
    };
    const raw: CategoryRawScores = { ...ALL_0, sales: 100, finance: 0 };
    const result = computeBusinessHealthScore(raw, customWeights);
    return result.overallScore === 50;
  })()
);

check(
  "out-of-range raw scores are clamped into 0-100 before weighting",
  (() => {
    const raw: CategoryRawScores = { ...ALL_0, sales: 500, finance: -50 };
    const result = computeBusinessHealthScore(raw);
    const salesEntry = result.breakdown.find((b) => b.category === "sales");
    const financeEntry = result.breakdown.find((b) => b.category === "finance");
    return salesEntry?.rawScore === 100 && financeEntry?.rawScore === 0;
  })()
);

console.log(`\nBusinessHealthScore tests: ${pass} passed`);
