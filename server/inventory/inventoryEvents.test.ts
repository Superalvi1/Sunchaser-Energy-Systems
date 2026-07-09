import assert from "node:assert/strict";
import {
  assertUniqueEventId,
  createInventoryEvent,
  DuplicateInventoryEventError,
  isInventoryEventType,
  sortInventoryEventsDesc,
  INVENTORY_EVENT_TYPES,
} from "./InventoryEvents.ts";
import { createInventoryRepository } from "./InventoryRepository.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const ev = createInventoryEvent({
  id: "e1", type: "sku.created", companyId: "c1", actorId: "a1", entityType: "sku", entityId: "r1", payload: { name: "X" },
});
check("event created", ev.id === "e1");
check("default time", ev.occurredAt === "1970-01-01T00:00:00.000Z");

for (const t of INVENTORY_EVENT_TYPES) {
  check(`event type ${t}`, isInventoryEventType(t));
}

check("invalid event type", !isInventoryEventType("bad"));

const sorted = sortInventoryEventsDesc([
  createInventoryEvent({ id: "a", type: "sku.created", companyId: "c1", actorId: "a", entityType: "sku", entityId: "1", occurredAt: "1970-01-01T00:00:00.000Z", payload: {} }),
  createInventoryEvent({ id: "b", type: "sku.updated", companyId: "c1", actorId: "a", entityType: "sku", entityId: "2", occurredAt: "1970-01-02T00:00:00.000Z", payload: {} }),
]);
check("sorted desc", sorted[0].id === "b");

const seen = new Set<string>();
assertUniqueEventId(seen, "ev-1");
seen.add("ev-1");
check("assertUniqueEventId accepts first id", seen.has("ev-1"));

let dupThrew = false;
try {
  assertUniqueEventId(seen, "ev-1");
} catch (e) {
  dupThrew = e instanceof DuplicateInventoryEventError && e.eventId === "ev-1";
}
check("assertUniqueEventId rejects duplicate", dupThrew);

const repo = createInventoryRepository();
repo.pushEvent({ id: "repo-ev-1", type: "sku.created", companyId: "c1", actorId: "a", entityType: "sku", entityId: "s1", payload: {} });
repo.pushEvent({ id: "repo-ev-2", type: "sku.updated", companyId: "c1", actorId: "a", entityType: "sku", entityId: "s1", payload: {} });
check("unique ids accepted", repo.listEvents().length === 2);

let repoDup = false;
try {
  repo.pushEvent({ id: "repo-ev-1", type: "movement.posted", companyId: "c1", actorId: "a", entityType: "ledger", entityId: "l1", payload: {} });
} catch (e) {
  repoDup = e instanceof DuplicateInventoryEventError;
}
check("duplicate id rejected", repoDup);
check("event ordering unchanged after duplicate", repo.listEvents()[0].id === "repo-ev-1" && repo.listEvents()[1].id === "repo-ev-2");

console.log(`\ninventoryEvents.test.ts: ${pass} passed`);
