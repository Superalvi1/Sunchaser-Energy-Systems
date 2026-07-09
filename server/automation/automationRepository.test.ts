import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createAutomationRepository } from "./AutomationRepository.ts";
import { AutomationPermissionError } from "./AutomationPermissions.ts";
import { createAutomationTriggerEvent } from "./AutomationTrigger.ts";
import { createAutomationRunRecord } from "./AutomationHistory.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const admin: RequestActor = {
  id: "admin", username: "admin", name: "Admin", email: "a@test.com", role: "Admin",
  accountStatus: "Active", emailVerified: true, onboardingCompleted: true, authMethod: "jwt",
};

const sales: RequestActor = { ...admin, id: "sales", role: "Sales Executive" };
const repo = createAutomationRepository();

const ruleInput = {
  id: "rule-1", companyId: "c1", name: "Auto", description: "", trigger: "lead_created" as const,
  conditions: [], actions: [{ id: "a1", type: "assign_user" as const, params: { userId: "u1" } }],
  active: true, priority: 1, maxRetries: 3, createdBy: "admin",
};

repo.saveRule(ruleInput, admin);
check("save rule", repo.getRule("rule-1", admin)?.name === "Auto");
check("list rules", repo.listRules("c1", admin).length === 1);
check("active by trigger", repo.listActiveRulesByTrigger("c1", "lead_created").length === 1);

let salesDenied = false;
try { repo.getRule("rule-1", sales); } catch (e) { salesDenied = e instanceof AutomationPermissionError; }
check("sales read denied", salesDenied);

const event = createAutomationTriggerEvent({
  id: "te-1", trigger: "lead_created", companyId: "c1", entityType: "lead", entityId: "l1", actorId: "admin", payload: {},
});
repo.saveTriggerEvent(event);
check("trigger event saved", repo.getTriggerEvent("te-1")?.id === "te-1");

const run = createAutomationRunRecord({
  id: "run-1", companyId: "c1", ruleId: "rule-1", ruleName: "Auto", triggerEventId: "te-1",
  trigger: "lead_created", status: "executed", conditionResults: [], actionResults: [], actorId: "admin",
});
repo.appendRun(run);
check("run appended", repo.listRuns("rule-1").length === 1);

repo.pushEvent({
  id: "ev-1", type: "rule.created", companyId: "c1", actorId: "admin", entityType: "rule", entityId: "rule-1", payload: {},
});
check("events listed", repo.listEvents().length === 1);

check("queue accessible", repo.getQueue().length === 0);
check("history accessible", repo.getHistory().length === 1);

console.log(`\nautomationRepository.test.ts: ${pass} passed`);
