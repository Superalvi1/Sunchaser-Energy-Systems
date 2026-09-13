import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const routeStart = serverSource.indexOf('app.get("/api/admin/invoices/contracted-ready"');
const routeEnd = serverSource.indexOf("\n});", routeStart);

assert.ok(routeStart >= 0 && routeEnd > routeStart, "contracted-ready route must exist");
const route = serverSource.slice(routeStart, routeEnd);

assert.match(
  route,
  /listContractedLeadsReadyForInvoice\(staff,\s*leads,\s*db\)/,
  "route must pass the authenticated RequestActor to the actor-based service"
);
assert.doesNotMatch(
  route,
  /listContractedLeadsReadyForInvoice\(staff\.id,\s*staff\.username/,
  "obsolete positional staff signature must not return"
);

console.log("Invoice ready-route wiring test passed.");
