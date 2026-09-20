import assert from "node:assert/strict";
import {
  buildPendingCustomerPortalPayload,
  customerMustSkipMandatoryWizard,
  isClientProfilePending,
  readInteractiveProposalTokenFromLocation,
  staffLeadCustomerId,
} from "./clientPortalRouting.ts";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("customers skip the mandatory Solar Wizard and land on the dashboard", () => {
  assert.equal(customerMustSkipMandatoryWizard("Customer"), true);
  assert.equal(customerMustSkipMandatoryWizard("Sales Advisor"), false);
});

test("missing customer id is treated as profile setup pending", () => {
  assert.equal(isClientProfilePending({ profilePending: true }), true);
  assert.equal(isClientProfilePending({ customer: { id: null } }), true);
  assert.equal(isClientProfilePending({ customer: { id: "cust-hassan" } }), false);
});

test("interactive proposal tokens work on web paths, hash routes, and query strings", () => {
  const token = "A".repeat(48);
  assert.equal(
    readInteractiveProposalTokenFromLocation({ pathname: `/proposal/${token}` }),
    token
  );
  assert.equal(
    readInteractiveProposalTokenFromLocation({ pathname: "/", hash: `#/proposal/${token}` }),
    token
  );
  assert.equal(
    readInteractiveProposalTokenFromLocation({ pathname: "/", search: `?proposal=${token}` }),
    token
  );
  assert.equal(readInteractiveProposalTokenFromLocation({ pathname: "/proposal/short" }), null);
});

test("pending portal payload never impersonates another customer", () => {
  const payload = buildPendingCustomerPortalPayload({ name: "Hassan", email: "hassan@example.com" });
  assert.equal(payload.profilePending, true);
  assert.equal(payload.customer.id, null);
  assert.equal(payload.lead, null);
  assert.equal(payload.dashboard.projectStatus, "Profile setup pending");
});

test("staff Open Client Portal action binds the selected lead only", () => {
  assert.equal(staffLeadCustomerId({ customerId: "cust-hassan" }), "cust-hassan");
  assert.equal(staffLeadCustomerId({ customer_id: "cust-2" }), "cust-2");
  assert.equal(staffLeadCustomerId({}), "");
  assert.equal(staffLeadCustomerId(null), "");
});

console.log("clientPortalRouting tests passed");
