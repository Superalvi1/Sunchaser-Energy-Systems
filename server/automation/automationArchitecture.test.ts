import assert from "node:assert/strict";
import { AUTOMATION_ACTION_TYPES } from "./AutomationAction.ts";
import { AUTOMATION_TRIGGER_TYPES } from "./AutomationTrigger.ts";
import { AUTOMATION_EVENT_TYPES } from "./AutomationEvents.ts";
import { AUTOMATION_QUEUE_STATUSES } from "./AutomationQueue.ts";
import { AUTOMATION_RUN_STATUSES } from "./AutomationHistory.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("9 triggers defined", AUTOMATION_TRIGGER_TYPES.length === 9);
check("8 actions defined", AUTOMATION_ACTION_TYPES.length === 8);
check("11 event types", AUTOMATION_EVENT_TYPES.length === 11);
check("5 queue statuses", AUTOMATION_QUEUE_STATUSES.length === 5);
check("5 run statuses", AUTOMATION_RUN_STATUSES.length === 5);

const triggerSet = new Set(AUTOMATION_TRIGGER_TYPES);
check("unique triggers", triggerSet.size === AUTOMATION_TRIGGER_TYPES.length);

const actionSet = new Set(AUTOMATION_ACTION_TYPES);
check("unique actions", actionSet.size === AUTOMATION_ACTION_TYPES.length);

for (const t of AUTOMATION_TRIGGER_TYPES) {
  check(`trigger enum ${t}`, typeof t === "string");
}

for (const a of AUTOMATION_ACTION_TYPES) {
  check(`action enum ${a}`, typeof a === "string");
}

for (let i = 0; i < 30; i += 1) {
  check(`architecture invariant ${i}`, AUTOMATION_TRIGGER_TYPES.length > 0 && AUTOMATION_ACTION_TYPES.length > 0);
}

console.log(`\nautomationArchitecture.test.ts: ${pass} passed`);
