/**
 * Phase 1B.2A ownership tests — run: npm run test:phase-1b2a
 */
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { RequestActor } from "../middleware/actor.ts";
import { resolveStaffActor } from "../middleware/staffActor.ts";
import { findPortalPrimaryLeadLocal } from "../../dbManager.ts";
import { OwnershipError, OwnershipResolver } from "./OwnershipResolver.ts";

const customerActor: RequestActor = {
  id: "u-customer",
  username: "portaluser",
  name: "Portal User",
  email: "portal@test.com",
  role: "Customer",
  accountStatus: "Approved",
  customerId: "cust-1",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const mockDb = {
  invoices: [{ id: "inv-1", customer_id: "cust-1" }],
  invoiceItems: [{ id: "item-1", invoice_id: "inv-1" }],
  invoicePayments: [{ id: "pay-1", invoice_id: "inv-1" }],
  quotations: [{ id: "q-1", customer_id: "cust-1" }],
  customerDocuments: [{ id: "doc-1", customer_id: "cust-1" }],
  customerWarranties: [{ id: "war-1", customer_id: "cust-1" }],
  tickets: [{ id: "ticket-1", customer_id: "cust-1" }],
  serviceRequests: [{ id: "sr-1", customer_id: "cust-1" }],
} as any;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

await test("assertCustomerActor returns actor customerId", () => {
  assert.equal(OwnershipResolver.assertCustomerActor(customerActor), "cust-1");
});

await test("assertCustomerActor rejects missing actor", () => {
  assert.throws(() => OwnershipResolver.assertCustomerActor(undefined), OwnershipError);
});

await test("assertCustomerActor rejects non-customer role", () => {
  assert.throws(
    () =>
      OwnershipResolver.assertCustomerActor({
        ...customerActor,
        role: "Sales Executive",
      }),
    /Not authorized/
  );
});

await test("assertCustomerActor rejects missing customerId", () => {
  assert.throws(
    () =>
      OwnershipResolver.assertCustomerActor({
        ...customerActor,
        customerId: undefined,
      }),
    /not linked/
  );
});

await test("assertDirectOwnership passes on customer_id match", () => {
  OwnershipResolver.assertDirectOwnership("cust-1", { customer_id: "cust-1" });
});

await test("assertDirectOwnership returns 403 on mismatch", () => {
  try {
    OwnershipResolver.assertDirectOwnership("cust-1", { customer_id: "cust-2" });
    assert.fail("expected OwnershipError");
  } catch (err) {
    assert.ok(err instanceof OwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("resolveResourceCustomerId for invoice parent resources", async () => {
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("invoice", "inv-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("invoice_item", "item-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("invoice_payment", "pay-1", mockDb), "cust-1");
});

await test("resolveResourceCustomerId for direct customer resources", async () => {
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("quotation", "q-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("customer_document", "doc-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("warranty", "war-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("support_ticket", "ticket-1", mockDb), "cust-1");
  assert.equal(await OwnershipResolver.resolveResourceCustomerId("service_request", "sr-1", mockDb), "cust-1");
});

await test("assertResourceOwnedByActor enforces actor.customerId only", async () => {
  await OwnershipResolver.assertResourceOwnedByActor(customerActor, "support_ticket", "ticket-1", mockDb);
});

await test("assertResourceOwnedByActor rejects cross-customer access", async () => {
  try {
    await OwnershipResolver.assertResourceOwnedByActor(
      { ...customerActor, customerId: "cust-2" },
      "support_ticket",
      "ticket-1",
      mockDb
    );
    assert.fail("expected OwnershipError");
  } catch (err) {
    assert.ok(err instanceof OwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertRouteCustomerId rejects route customer mismatch", () => {
  try {
    OwnershipResolver.assertRouteCustomerId(customerActor, "cust-2");
    assert.fail("expected OwnershipError");
  } catch (err) {
    assert.ok(err instanceof OwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("portal lead lookup scoped by customerId only", () => {
  const localDb = {
    leads: [
      { id: "lead-a", customer_id: "cust-1", email: "shared@test.com", deleted_at: null },
      { id: "lead-b", customer_id: "cust-2", email: "shared@test.com", deleted_at: null },
    ],
  } as any;
  assert.equal(findPortalPrimaryLeadLocal(localDb, { customerId: "cust-1" })?.id, "lead-a");
  assert.equal(findPortalPrimaryLeadLocal(localDb, { customerId: "cust-2" })?.id, "lead-b");
  assert.equal(findPortalPrimaryLeadLocal(localDb, { customerId: null }), null);
  assert.equal(findPortalPrimaryLeadLocal(localDb, { customerId: "cust-missing" }), null);
});

await test("resolveStaffActor rejects customer actors", () => {
  const req = { actor: customerActor } as Request;
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };
  assert.equal(resolveStaffActor(req, res), null);
  assert.equal(res.statusCode, 403);
});

await test("resolveStaffActor returns staff actor from req.actor", () => {
  const staffActor: RequestActor = {
    ...customerActor,
    id: "u-staff",
    username: "staffuser",
    role: "Sales Executive",
    customerId: undefined,
  };
  const req = { actor: staffActor } as Request;
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };
  assert.equal(resolveStaffActor(req, res)?.id, "u-staff");
});

console.log(`\nPhase 1B.2A tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
