import assert from "node:assert/strict";
import {
  AUTOMATION_DEFAULT_TIMESTAMP,
  AUTOMATION_TRIGGER_TYPES,
  createAutomationTriggerEvent,
  isAutomationEntityType,
  isAutomationTriggerType,
  isNonEmptyString,
  triggerEntityTypeFor,
  validateAutomationTriggerEvent,
} from "./AutomationTrigger.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("default timestamp deterministic", AUTOMATION_DEFAULT_TIMESTAMP === "1970-01-01T00:00:00.000Z");
check("isNonEmptyString", isNonEmptyString("x") && !isNonEmptyString("  "));

for (const t of AUTOMATION_TRIGGER_TYPES) {
  check(`trigger ${t} recognized`, isAutomationTriggerType(t));
  check(`entity for ${t}`, isAutomationEntityType(triggerEntityTypeFor(t)));
}

check("invalid trigger", !isAutomationTriggerType("invalid"));

const event = createAutomationTriggerEvent({
  id: "te-1", trigger: "lead_created", companyId: "c1", entityType: "lead", entityId: "lead-1", actorId: "a1",
  payload: { stage: "new" },
});
check("event created", event.id === "te-1");
check("event default time", event.occurredAt === AUTOMATION_DEFAULT_TIMESTAMP);

check("validate ok", validateAutomationTriggerEvent({
  id: "e1", trigger: "quote_accepted", companyId: "c1", entityType: "quote", entityId: "q1", actorId: "a1", payload: {},
}).ok);

check("validate missing id", !validateAutomationTriggerEvent({
  id: "", trigger: "lead_created", companyId: "c1", entityType: "lead", entityId: "l1", actorId: "a1", payload: {},
}).ok);

check("validate bad trigger", !validateAutomationTriggerEvent({
  id: "e1", trigger: "bad" as "lead_created", companyId: "c1", entityType: "lead", entityId: "l1", actorId: "a1", payload: {},
}).ok);

for (const trigger of AUTOMATION_TRIGGER_TYPES) {
  const entity = triggerEntityTypeFor(trigger);
  const r = validateAutomationTriggerEvent({
    id: `ev-${trigger}`, trigger, companyId: "co", entityType: entity, entityId: "ent-1", actorId: "actor", payload: { k: 1 },
  });
  check(`validate ${trigger}`, r.ok === true);
}

console.log(`\nautomationTrigger.test.ts: ${pass} passed`);
