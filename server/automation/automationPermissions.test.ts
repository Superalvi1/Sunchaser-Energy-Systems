import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  assertAutomationExecuteAccess,
  assertAutomationReadAccess,
  assertAutomationWriteAccess,
  AutomationPermissionError,
  canActorExecuteAutomation,
  canActorReadAutomation,
  canActorWriteAutomation,
  evaluateAutomationPermission,
} from "./AutomationPermissions.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function actor(role: string): RequestActor {
  return {
    id: "u1", username: "u", name: "U", email: "u@test.com", role,
    accountStatus: "Active", emailVerified: true, onboardingCompleted: true, authMethod: "jwt",
  };
}

check("undefined denied read", !canActorReadAutomation(undefined));
check("customer denied", !canActorReadAutomation(actor("Customer")));
check("customer denied write", !canActorWriteAutomation(actor("Customer")));

for (const role of ["Super Admin", "Admin", "Director", "Sales Manager"]) {
  check(`${role} read`, canActorReadAutomation(actor(role)));
  check(`${role} write`, canActorWriteAutomation(actor(role)));
  check(`${role} execute`, canActorExecuteAutomation(actor(role)));
}

check("sales exec denied read default", !canActorReadAutomation(actor("Sales Executive")));
check("sales exec read explicit", canActorReadAutomation(actor("Sales Executive"), { allowSalesRead: true }));
check("sales exec denied write", !canActorWriteAutomation(actor("Sales Executive")));
check("technician denied", !canActorExecuteAutomation(actor("Technician")));
check("accounts denied", !canActorWriteAutomation(actor("Accounts Manager")));

check("unauthenticated reason", evaluateAutomationPermission(undefined, "read").reason === "unauthenticated");
check("customer reason", evaluateAutomationPermission(actor("Customer"), "read").reason === "customer_denied");
check("deny default", evaluateAutomationPermission(actor("HR Manager"), "write").reason === "deny_by_default");

let read401 = false;
try { assertAutomationReadAccess(undefined); } catch (e) { read401 = e instanceof AutomationPermissionError && e.statusCode === 401; }
check("read assert 401", read401);

let write403 = false;
try { assertAutomationWriteAccess(actor("Sales Executive")); } catch (e) { write403 = e instanceof AutomationPermissionError && e.statusCode === 403; }
check("write assert 403", write403);

let exec403 = false;
try { assertAutomationExecuteAccess(actor("Sales Coordinator")); } catch (e) { exec403 = e instanceof AutomationPermissionError; }
check("execute assert denied", exec403);

console.log(`\nautomationPermissions.test.ts: ${pass} passed`);
