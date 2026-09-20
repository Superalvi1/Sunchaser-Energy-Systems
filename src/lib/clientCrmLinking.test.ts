import assert from "node:assert/strict";
import {
  allocateCustomerId,
  buildRegistrationLeadRow,
  decideCustomerProvision,
  findLeadForCustomer,
  findReusableCustomer,
} from "./clientCrmLinking.ts";

const user = {
  id: "u-hassan",
  name: "Hassan",
  email: "hassan@example.com",
  phone: "03001234567",
  role: "Customer",
};

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("new client registration creates a dedicated customer id", () => {
  const decision = decideCustomerProvision({ user, customers: [] });
  assert.equal(decision.action, "create");
  assert.equal(decision.customerId, "cust-hassan");
});

test("invitation code wins over email matching", () => {
  const decision = decideCustomerProvision({
    user,
    invitedCustomerId: "cust-invited",
    customers: [{ id: "cust-other", email: "hassan@example.com" }],
  });
  assert.equal(decision.action, "use-invitation");
  assert.equal(decision.customerId, "cust-invited");
});

test("invitation to a customer already linked to another user is not stolen", () => {
  const decision = decideCustomerProvision({
    user,
    invitedCustomerId: "cust-taken",
    customers: [{ id: "cust-taken", email: "hassan@example.com", user_id: "u-other" }],
  });
  assert.equal(decision.action, "create");
  assert.equal(decision.customerId, "cust-hassan");
});

test("existing user-linked customer is reused", () => {
  const decision = decideCustomerProvision({
    user,
    customers: [{ id: "cust-existing", user_id: "u-hassan", email: "other@example.com" }],
  });
  assert.equal(decision.action, "reuse-linked");
  assert.equal(decision.customerId, "cust-existing");
});

test("unlinked customer with the same email is reused instead of duplicated", () => {
  const found = findReusableCustomer({
    customers: [
      { id: "cust-email", email: "Hassan@example.com", user_id: null },
      { id: "cust-taken", email: "hassan@example.com", user_id: "u-someone-else" },
    ],
    userId: "u-hassan",
    email: "hassan@example.com",
  });
  assert.equal(found?.customer.id, "cust-email");
  assert.equal(found?.reason, "email");
});

test("customer already linked to another user is not stolen", () => {
  const found = findReusableCustomer({
    customers: [{ id: "cust-taken", email: "hassan@example.com", user_id: "u-other" }],
    userId: "u-hassan",
    email: "hassan@example.com",
  });
  assert.equal(found, null);
});

test("stale customer_id pointing at another user's customer allocates a new id", () => {
  const decision = decideCustomerProvision({
    user: { ...user, customer_id: "cust-taken" },
    customers: [{ id: "cust-taken", email: "other@example.com", user_id: "u-other" }],
  });
  assert.equal(decision.action, "create");
  assert.notEqual(decision.customerId, "cust-taken");
  assert.match(decision.customerId, /^cust-hassan-/);
});

test("allocateCustomerId never reuses an id owned by someone else", () => {
  const id = allocateCustomerId(
    { ...user, customer_id: "cust-taken" },
    [{ id: "cust-taken", user_id: "u-other" }]
  );
  assert.notEqual(id, "cust-taken");
});

test("lead lookup prefers customer_id then email and ignores deleted leads", () => {
  const leads = [
    { id: "lead-old", customer_id: "cust-hassan", email: "hassan@example.com", deleted_at: "2026-01-01" },
    { id: "lead-live", customer_id: "cust-hassan", email: "hassan@example.com" },
  ];
  const found = findLeadForCustomer(leads, "cust-hassan", "hassan@example.com");
  assert.equal(found?.id, "lead-live");
});

test("lead with the same email owned by another customer is not reused", () => {
  const found = findLeadForCustomer(
    [{ id: "lead-other", customer_id: "cust-other", email: "hassan@example.com" }],
    "cust-hassan",
    "hassan@example.com"
  );
  assert.equal(found, null);
});

test("unlinked lead with the same email can be reused", () => {
  const found = findLeadForCustomer(
    [{ id: "lead-orphan", customer_id: null, email: "hassan@example.com" }],
    "cust-hassan",
    "hassan@example.com"
  );
  assert.equal(found?.id, "lead-orphan");
});

test("registration lead uses pending placeholders so NOT NULL phone/address succeed", () => {
  const row = buildRegistrationLeadRow({
    customerId: "cust-hassan",
    name: "Hassan",
    email: "hassan@example.com",
  });
  assert.equal(row.phone, "Pending");
  assert.equal(row.address, "Pending");
  assert.equal(row.customer_id, "cust-hassan");
  assert.equal(row.lead_source, "Client Registration");
  assert.equal(row.id, "lead-hassan");
});

console.log("clientCrmLinking tests passed");
