import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  assertInventoryReadAccess,
  assertInventoryWriteAccess,
  canActorManageInventory,
  canActorReadInventory,
  canActorWriteInventory,
  evaluateInventoryPermission,
  InventoryPermissionError,
  inventoryFullAccessRoles,
} from "./InventoryPermissions.ts";

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

check("undefined actor denied read", !canActorReadInventory(undefined));
check("undefined actor denied write", !canActorWriteInventory(undefined));
check("customer denied read", !canActorReadInventory(actor("Customer")));
check("customer denied write", !canActorWriteInventory(actor("Customer")));

for (const role of ["Super Admin", "Admin", "Director", "Inventory Manager"]) {
  check(`${role} can read`, canActorReadInventory(actor(role)));
  check(`${role} can write`, canActorWriteInventory(actor(role)));
  check(`${role} can manage`, canActorManageInventory(actor(role)));
}

check("sales denied read by default", !canActorReadInventory(actor("Sales Executive")));
check("technician denied read by default", !canActorReadInventory(actor("Technician")));
check("sales denied write", !canActorWriteInventory(actor("Sales Executive")));
check("technician denied write", !canActorWriteInventory(actor("Senior Technician")));

check("sales read with explicit flag", canActorReadInventory(actor("Sales Executive"), { allowSalesRead: true }));
check("technician read with explicit flag", canActorReadInventory(actor("Field Technician"), { allowTechnicianRead: true }));
check("sales still cannot write with read flag", !canActorWriteInventory(actor("Sales Manager")));

check("accounts manager deny by default", !canActorWriteInventory(actor("Accounts Manager")));
check("hr manager deny by default", !canActorReadInventory(actor("HR Manager")));

check("evaluate unauthenticated reason", evaluateInventoryPermission(undefined, "read").reason === "unauthenticated");
check("evaluate customer reason", evaluateInventoryPermission(actor("Customer"), "read").reason === "customer_denied");
check("evaluate sales read needs allowance", evaluateInventoryPermission(actor("Sales Executive"), "read").reason === "read_requires_explicit_allowance");

let readAssertThrew = false;
try {
  assertInventoryReadAccess(undefined);
} catch (e) {
  readAssertThrew = e instanceof InventoryPermissionError && e.statusCode === 401;
}
check("assert read 401", readAssertThrew);

let writeAssertThrew = false;
try {
  assertInventoryWriteAccess(actor("Sales Executive"));
} catch (e) {
  writeAssertThrew = e instanceof InventoryPermissionError && e.statusCode === 403;
}
check("assert write 403", writeAssertThrew);

check("full access roles exported", inventoryFullAccessRoles().includes("Inventory Manager"));
check("admin full access decision", evaluateInventoryPermission(actor("Admin"), "manage").allowed);

console.log(`\ninventoryPermissions.test.ts: ${pass} passed`);
