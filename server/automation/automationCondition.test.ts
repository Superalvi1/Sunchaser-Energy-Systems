import assert from "node:assert/strict";
import {
  evaluateAutomationCondition,
  evaluateAutomationConditions,
  allAutomationConditionsPass,
  type AutomationConditionExpression,
} from "./AutomationCondition.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const scope = { stage: "qualified", value: 100, tags: ["vip", "solar"], nested: { owner: "alice" } };

check("eq pass", evaluateAutomationCondition({ op: "eq", field: "stage", value: "qualified" }, scope));
check("eq fail", !evaluateAutomationCondition({ op: "eq", field: "stage", value: "lost" }, scope));
check("neq", evaluateAutomationCondition({ op: "neq", field: "stage", value: "lost" }, scope));
check("gt", evaluateAutomationCondition({ op: "gt", field: "value", value: 50 }, scope));
check("gte", evaluateAutomationCondition({ op: "gte", field: "value", value: 100 }, scope));
check("lt", evaluateAutomationCondition({ op: "lt", field: "value", value: 200 }, scope));
check("lte", evaluateAutomationCondition({ op: "lte", field: "value", value: 100 }, scope));
check("in", evaluateAutomationCondition({ op: "in", field: "stage", values: ["qualified", "new"] }, scope));
check("notIn", evaluateAutomationCondition({ op: "notIn", field: "stage", values: ["lost"] }, scope));
check("exists", evaluateAutomationCondition({ op: "exists", field: "stage" }, scope));
check("notExists", evaluateAutomationCondition({ op: "notExists", field: "missing" }, scope));
check("contains array", evaluateAutomationCondition({ op: "contains", field: "tags", value: "vip" }, scope));
check("contains string", evaluateAutomationCondition({ op: "contains", field: "stage", value: "ali" }, scope));
check("nested path", evaluateAutomationCondition({ op: "eq", field: "nested.owner", value: "alice" }, scope));

check("and", evaluateAutomationCondition({
  op: "and",
  expressions: [
    { op: "eq", field: "stage", value: "qualified" },
    { op: "gt", field: "value", value: 0 },
  ],
}, scope));

check("or", evaluateAutomationCondition({
  op: "or",
  expressions: [
    { op: "eq", field: "stage", value: "lost" },
    { op: "gt", field: "value", value: 50 },
  ],
}, scope));

check("not", evaluateAutomationCondition({ op: "not", expression: { op: "eq", field: "stage", value: "lost" } }, scope));

check("all pass empty", allAutomationConditionsPass([], scope));
check("all pass multi", allAutomationConditionsPass([
  { op: "eq", field: "stage", value: "qualified" },
  { op: "gte", field: "value", value: 100 },
], scope));

check("evaluateAutomationConditions length", evaluateAutomationConditions([
  { op: "eq", field: "stage", value: "qualified" },
  { op: "eq", field: "stage", value: "lost" },
], scope).length === 2);

const ops = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
for (let i = 0; i < 20; i += 1) {
  check(`numeric loop ${i}`, evaluateAutomationCondition({ op: "gte", field: "value", value: i }, scope));
}

for (const stage of ["new", "qualified", "proposal", "won", "lost"]) {
  check(`stage in check ${stage}`, evaluateAutomationCondition({ op: "in", field: "stage", values: [stage, "other"] }, { stage }));
}

let malformedNoThrow = true;
try {
  check("malformed null is false", !evaluateAutomationCondition(null as unknown as AutomationConditionExpression, scope));
  check("malformed missing op is false", !evaluateAutomationCondition({ field: "stage" } as unknown as AutomationConditionExpression, scope));
  check("invalid operator is false", !evaluateAutomationCondition({ op: "bogus", field: "stage" } as unknown as AutomationConditionExpression, scope));
  check("malformed and missing expressions is false", !evaluateAutomationCondition({ op: "and" } as unknown as AutomationConditionExpression, scope));
  check("malformed or non-array expressions is false", !evaluateAutomationCondition({ op: "or", expressions: "bad" } as unknown as AutomationConditionExpression, scope));
  check("malformed not missing expression is false", !evaluateAutomationCondition({ op: "not" } as unknown as AutomationConditionExpression, scope));
  check("malformed nested and child is false", !evaluateAutomationCondition({
    op: "and",
    expressions: [{ op: "eq", field: "stage", value: "qualified" }, { op: "gt" }],
  } as unknown as AutomationConditionExpression, scope));
  check("malformed nested or child is false", !evaluateAutomationCondition({
    op: "or",
    expressions: [{ op: "not", expression: { op: "eq" } }],
  } as unknown as AutomationConditionExpression, scope));
  check("malformed nested not child is false", !evaluateAutomationCondition({
    op: "not",
    expression: { op: "in", field: "stage" },
  } as unknown as AutomationConditionExpression, scope));
} catch {
  malformedNoThrow = false;
}
check("malformed condition object does not throw", malformedNoThrow);

const malformedResults = evaluateAutomationConditions([
  { op: "badop", field: "x" } as unknown as AutomationConditionExpression,
  { op: "and", expressions: [{ op: "eq" }] } as unknown as AutomationConditionExpression,
], scope);
check("malformed conditions evaluate to failed results", malformedResults.every((r) => r.passed === false));

console.log(`\nautomationCondition.test.ts: ${pass} passed`);
