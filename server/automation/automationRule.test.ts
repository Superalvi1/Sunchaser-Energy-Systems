import assert from "node:assert/strict";
import { createAutomationRule, sortRulesByPriority, validateAutomationRule } from "./AutomationRule.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function baseRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    companyId: "c1",
    name: "Lead auto-assign",
    description: "Assign new leads",
    trigger: "lead_created" as const,
    conditions: [{ op: "eq" as const, field: "stage", value: "new" }],
    actions: [{ id: "act-1", type: "assign_user" as const, params: { userId: "sales-1" } }],
    active: true,
    priority: 10,
    maxRetries: 3,
    createdBy: "admin",
    ...overrides,
  };
}

check("valid rule", validateAutomationRule(baseRule()).ok);
check("missing name", !validateAutomationRule(baseRule({ name: "" })).ok);
check("missing actions", !validateAutomationRule(baseRule({ actions: [] })).ok);
check("bad trigger", !validateAutomationRule(baseRule({ trigger: "invalid" })).ok);
check("negative priority", !validateAutomationRule(baseRule({ priority: -1 })).ok);

const rule = createAutomationRule(baseRule());
check("rule name trimmed", rule.name === "Lead auto-assign");
check("rule active default", rule.active === true);
check("rule maxRetries", rule.maxRetries === 3);

const sorted = sortRulesByPriority([
  createAutomationRule(baseRule({ id: "low", priority: 1 })),
  createAutomationRule(baseRule({ id: "high", priority: 100 })),
  createAutomationRule(baseRule({ id: "mid", priority: 50 })),
]);
check("sort priority desc", sorted[0].id === "high");
check("sort priority mid", sorted[1].id === "mid");

for (let i = 0; i < 10; i += 1) {
  const r = createAutomationRule(baseRule({ id: `rule-${i}`, name: `Rule ${i}`, priority: i }));
  check(`rule create ${i}`, r.priority === i);
}

console.log(`\nautomationRule.test.ts: ${pass} passed`);
