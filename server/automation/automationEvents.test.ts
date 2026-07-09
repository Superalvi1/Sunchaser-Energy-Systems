import assert from "node:assert/strict";
import {
  AUTOMATION_EVENT_TYPES,
  createAutomationEvent,
  isAutomationEventType,
  sortAutomationEventsDesc,
} from "./AutomationEvents.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const ev = createAutomationEvent({
  id: "e1", type: "rule.created", companyId: "c1", actorId: "a1", entityType: "rule", entityId: "r1", payload: { name: "X" },
});
check("event created", ev.id === "e1");
check("default time", ev.occurredAt === "1970-01-01T00:00:00.000Z");

for (const t of AUTOMATION_EVENT_TYPES) {
  check(`event type ${t}`, isAutomationEventType(t));
}

check("invalid event type", !isAutomationEventType("bad"));

const sorted = sortAutomationEventsDesc([
  createAutomationEvent({ id: "a", type: "trigger.received", companyId: "c1", actorId: "a", entityType: "x", entityId: "1", occurredAt: "1970-01-01T00:00:00.000Z", payload: {} }),
  createAutomationEvent({ id: "b", type: "run.completed", companyId: "c1", actorId: "a", entityType: "x", entityId: "2", occurredAt: "1970-01-02T00:00:00.000Z", payload: {} }),
]);
check("sorted desc", sorted[0].id === "b");

console.log(`\nautomationEvents.test.ts: ${pass} passed`);
