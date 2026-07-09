import assert from "node:assert/strict";
import { DocumentPipelineError } from "./DocumentModels.ts";
import { assignPermissions, DEFAULT_KNOWLEDGE_VISIBILITY } from "./PermissionAssignment.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("DEFAULT_KNOWLEDGE_VISIBILITY is company", DEFAULT_KNOWLEDGE_VISIBILITY === "company");

check("no input at all defaults to company visibility", assignPermissions({}).visibility === "company");
check("no input reason explains the default", assignPermissions({}).reason === "default_company_visibility");

check(
  "linkedResource with customerId infers customer_scoped",
  assignPermissions({ linkedResource: { type: "customer", id: "c1", customerId: "cust-1" } }).visibility === "customer_scoped"
);
check(
  "linkedResource without customerId does not infer customer_scoped",
  assignPermissions({ linkedResource: { type: "project", id: "p1" } }).visibility === "company"
);

check("explicit requestedVisibility company is honored", assignPermissions({ requestedVisibility: "company" }).visibility === "company");
check("explicit requestedVisibility private is honored", assignPermissions({ requestedVisibility: "private" }).visibility === "private");
check("explicit requestedVisibility department is honored", assignPermissions({ requestedVisibility: "department" }).visibility === "department");
check(
  "explicit requestedVisibility overrides inferred customer_scoped when it says company",
  assignPermissions({ requestedVisibility: "company", linkedResource: { type: "customer", id: "c1", customerId: "cust-1" } })
    .visibility === "company"
);

check(
  "requestedVisibility role_restricted with allowedRoles succeeds",
  assignPermissions({ requestedVisibility: "role_restricted", allowedRoles: ["Admin"] }).visibility === "role_restricted"
);
check(
  "requestedVisibility role_restricted returns the allowedRoles list",
  assignPermissions({ requestedVisibility: "role_restricted", allowedRoles: ["Admin", "Director"] }).allowedRoles?.length === 2
);
check(
  "requestedVisibility role_restricted without allowedRoles throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "role_restricted" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "permission_assignment";
    }
  })()
);
check(
  "requestedVisibility role_restricted with empty allowedRoles array throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "role_restricted", allowedRoles: [] });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

check(
  "requestedVisibility customer_scoped with customerId succeeds",
  assignPermissions({ requestedVisibility: "customer_scoped", linkedResource: { type: "customer", id: "c1", customerId: "cust-1" } })
    .visibility === "customer_scoped"
);
check(
  "requestedVisibility customer_scoped without customerId throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "customer_scoped" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);
check(
  "requestedVisibility customer_scoped with linkedResource but no customerId throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "customer_scoped", linkedResource: { type: "project", id: "p1" } });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

check(
  "invalid requestedVisibility string throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "public" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "permission_assignment";
    }
  })()
);
check(
  "invalid requestedVisibility empty string throws",
  (() => {
    try {
      assignPermissions({ requestedVisibility: "" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

check("reason field set for requested visibility", assignPermissions({ requestedVisibility: "department" }).reason === "requested_visibility");
check(
  "reason field set for inferred customer visibility",
  assignPermissions({ linkedResource: { type: "customer", id: "c1", customerId: "cust-1" } }).reason === "inferred_from_linked_customer"
);
check(
  "reason field set for requested role_restricted",
  assignPermissions({ requestedVisibility: "role_restricted", allowedRoles: ["Admin"] }).reason === "requested_role_restricted"
);

check("non-role_restricted results do not carry allowedRoles", assignPermissions({}).allowedRoles === undefined);

console.log(`\nPermissionAssignment tests: ${pass} passed`);
