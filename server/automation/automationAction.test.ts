import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION_TYPES,
  executeAutomationAction,
  isAutomationActionType,
  isQueueActionType,
  validateAutomationActionDefinition,
} from "./AutomationAction.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const ctx = {
  companyId: "c1", entityType: "lead", entityId: "lead-1", triggerEventId: "te-1", ruleId: "r1", payload: {},
};

for (const type of AUTOMATION_ACTION_TYPES) {
  check(`action type ${type}`, isAutomationActionType(type));
  check(`queue check ${type}`, isQueueActionType(type) === type.startsWith("queue_"));
}

check("assign_user ok", executeAutomationAction({ id: "a1", type: "assign_user", params: { userId: "u1" } }, ctx).status === "completed");
check("assign_user fail", executeAutomationAction({ id: "a2", type: "assign_user", params: {} }, ctx).status === "failed");
check("change_stage ok", executeAutomationAction({ id: "a3", type: "change_stage", params: { stage: "won" } }, ctx).status === "completed");
check("change_stage fail", executeAutomationAction({ id: "a4", type: "change_stage", params: {} }, ctx).status === "failed");
check("create_task ok", executeAutomationAction({ id: "a5", type: "create_task", params: { title: "Follow up", assigneeId: "u1" } }, ctx).status === "completed");
check("create_task fail", executeAutomationAction({ id: "a6", type: "create_task", params: {} }, ctx).status === "failed");
check("schedule_reminder ok", executeAutomationAction({ id: "a7", type: "schedule_reminder", params: { remindAt: "1970-01-02T00:00:00.000Z" } }, ctx).status === "completed");
check("schedule_reminder fail", executeAutomationAction({ id: "a8", type: "schedule_reminder", params: {} }, ctx).status === "failed");

for (const type of ["queue_email", "queue_whatsapp", "queue_notification", "queue_webhook"] as const) {
  const r = executeAutomationAction({ id: type, type, params: { template: "welcome" } }, ctx);
  check(`${type} queued`, r.status === "queued");
  check(`${type} stub message`, r.message.includes("stub"));
}

check("validate action ok", validateAutomationActionDefinition({ id: "x", type: "assign_user", params: { userId: "u" } }).ok);
check("validate action bad type", !validateAutomationActionDefinition({ id: "x", type: "bad" as "assign_user", params: {} }).ok);
check("validate action missing id", !validateAutomationActionDefinition({ id: "", type: "assign_user", params: {} }).ok);

for (let i = 0; i < 15; i += 1) {
  const r = executeAutomationAction({ id: `loop-${i}`, type: "assign_user", params: { userId: `user-${i}` } }, ctx);
  check(`assign loop ${i}`, r.output.userId === `user-${i}`);
}

console.log(`\nautomationAction.test.ts: ${pass} passed`);
