/**
 * Phase 1B.3A critical finance route lockdown tests — run: npm run test:phase-1b3a
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  FinanceRouteLockdownError,
  assertDbUpdateAllowed,
  assertDeliveryChallanExportAccess,
  assertExportTableAccess,
  assertLeadOwnershipMutationAllowed,
  assertPaymentMilestoneAccess,
  assertSuperAdminOnly,
  filterExportStateForSales,
  isFinanceSensitiveDbTable,
  resolveExportAccess,
  touchesLeadOwnershipFields,
} from "../middleware/financeRouteLockdown.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;

const superAdminActor: RequestActor = {
  id: "u-superadmin-1",
  username: "allauddin",
  name: "Allauddin",
  email: "allauddin@sunchaser.com",
  role: "Super Admin",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const directorActor: RequestActor = {
  ...superAdminActor,
  id: "u-director-1",
  role: "Director",
  username: "director",
  name: "Dana Director",
};

const adminActor: RequestActor = {
  ...superAdminActor,
  id: "u-admin-1",
  role: "Admin",
  username: "admin",
  name: "Alice Admin",
};

const accountsManagerActor: RequestActor = {
  ...superAdminActor,
  id: "u-accounts-1",
  role: "Accounts Manager",
  username: "amir",
  name: "Amir Accounts",
};

const salesActorA: RequestActor = {
  ...superAdminActor,
  id: "u-sales-1",
  role: "Sales Executive",
  username: "sarah",
  name: "Sarah Connor",
};

const salesActorB: RequestActor = {
  ...salesActorA,
  id: "u-sales-2",
  username: "michael",
  name: "Michael Scott",
};

const technicianActor: RequestActor = {
  ...superAdminActor,
  id: "u-tech-1",
  role: "Technician",
  username: "tariq",
  name: "Tariq Technician",
};

const supportAgentActor: RequestActor = {
  ...superAdminActor,
  id: "u-support-1",
  role: "Support Agent",
  username: "support",
  name: "Support Agent",
};

const customerActor: RequestActor = {
  ...superAdminActor,
  id: "u-customer-1",
  role: "Customer",
  username: "cust1",
  name: "Cust Omer",
};

const mockExportDb = {
  leads: [
    { id: "lead-1", name: "Alpha", assigned_sales_user_id: "u-sales-1", email: "a@test.com", phone: "1", status: "Open", createdAt: "2026-01-01" },
    { id: "lead-2", name: "Beta", assigned_sales_user_id: "u-sales-2", email: "b@test.com", phone: "2", status: "Open", createdAt: "2026-01-02" },
  ],
  projects: [
    { id: "proj-1", leadId: "lead-1", customerName: "Alpha", address: "A St", systemSizekW: 5, stage: "Survey", updatedAt: "2026-01-01" },
    { id: "proj-2", leadId: "lead-2", customerName: "Beta", address: "B St", systemSizekW: 6, stage: "Survey", updatedAt: "2026-01-02" },
  ],
  paymentTracks: {
    "lead-1": { totalValue: 100, advanceReceived: 50, pendingAmount: 50, invoiceStatus: "Pending" },
    "lead-2": { totalValue: 200, advanceReceived: 0, pendingAmount: 200, invoiceStatus: "Pending" },
  },
} as any;

const mockOwnershipDb = {
  leads: [
    { id: "lead-1", assigned_sales_user_id: "u-sales-1", assigned_salesperson: "Sarah Connor" },
    { id: "lead-2", assigned_sales_user_id: "u-sales-2", assigned_salesperson: "Michael Scott" },
  ],
  deliveryChallans: [
    { id: "challan-1", lead_id: "lead-1", invoice_id: "inv-1" },
    { id: "challan-2", lead_id: "lead-2", invoice_id: "inv-2" },
    { id: "challan-via-invoice", invoice_id: "inv-1" },
  ],
  invoices: [
    { id: "inv-1", lead_id: "lead-1", leadId: "lead-1" },
    { id: "inv-2", lead_id: "lead-2", leadId: "lead-2" },
  ],
  projectDeliveries: [
    { id: "del-1", lead_id: "lead-1", assigned_technician_user_id: "u-tech-1" },
    { id: "del-2", lead_id: "lead-2", assigned_technician_user_id: "u-tech-2" },
  ],
  paymentTracks: {
    "lead-1": { totalValue: 100, milestones: [] },
    "lead-2": { totalValue: 200, milestones: [] },
  },
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

await test("backup export allows Super Admin only", () => {
  assert.doesNotThrow(() => assertSuperAdminOnly(superAdminActor));
  assert.throws(
    () => assertSuperAdminOnly(directorActor),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  assert.throws(
    () => assertSuperAdminOnly(undefined),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 401
  );
});

await test("db/update deny-by-default: Sales, Technician, Accounts Manager, Customer blocked for any table", () => {
  for (const table of ["leads", "products", "invoices", "paymentTracks", "settings", "users"]) {
    for (const actor of [salesActorA, technicianActor, accountsManagerActor, customerActor, directorActor, adminActor]) {
      assert.throws(
        () => assertDbUpdateAllowed(actor, "edit", table, { id: "x" }),
        (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
      );
    }
    assert.doesNotThrow(() => assertDbUpdateAllowed(superAdminActor, "edit", table, { id: "x" }));
  }
  assert.throws(
    () => assertDbUpdateAllowed(undefined, "edit", "leads", { id: "x" }),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 401
  );
});

await test("db/update finance tables denied for Sales, Technician, and Customer", () => {
  for (const table of ["invoices", "paymentTracks", "projectFinanceRecords", "deliveryChallans", "investors"]) {
    assert.equal(isFinanceSensitiveDbTable(table), true);
    assert.throws(
      () => assertDbUpdateAllowed(salesActorA, "edit", table, { id: "x" }),
      (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
    );
    assert.throws(
      () => assertDbUpdateAllowed(technicianActor, "edit", table, { id: "x" }),
      (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
    );
    assert.throws(
      () => assertDbUpdateAllowed(customerActor, "edit", table, { id: "x" }),
      (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
    );
    assert.doesNotThrow(() => assertDbUpdateAllowed(superAdminActor, "edit", table, { id: "x" }));
  }
  // Ordinary staff must not mutate leads via generic db/update either.
  assert.throws(
    () => assertDbUpdateAllowed(salesActorA, "edit", "leads", { id: "lead-1", status: "Open" }),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
});

await test("lead ownership mutation blocked for non-Super Admin via db/update", () => {
  assert.equal(touchesLeadOwnershipFields({ assigned_sales_user_id: "u-sales-2" }), true);
  assert.equal(touchesLeadOwnershipFields({ assignedSalesperson: "Other" }), true);
  assert.equal(touchesLeadOwnershipFields({ status: "Open" }), false);

  assert.throws(
    () =>
      assertLeadOwnershipMutationAllowed(salesActorA, "edit", "leads", {
        id: "lead-1",
        assigned_sales_user_id: "u-sales-2",
      }),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  assert.throws(
    () =>
      assertDbUpdateAllowed(salesActorA, "edit", "leads", {
        id: "lead-1",
        assignedSalesperson: "Michael Scott",
      }),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  assert.doesNotThrow(() =>
    assertDbUpdateAllowed(superAdminActor, "edit", "leads", {
      id: "lead-1",
      assigned_sales_user_id: "u-sales-2",
    })
  );
});

await test("investors table blocked for non-Super Admin via db/update", () => {
  assert.equal(isFinanceSensitiveDbTable("investors"), true);
  assert.throws(
    () => assertDbUpdateAllowed(accountsManagerActor, "add", "investors", { id: "inv-1", name: "Fund A" }),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
});

await test("payment milestone cross-lead denied via authoritative lead resolver", async () => {
  await assert.doesNotReject(() => assertPaymentMilestoneAccess(superAdminActor, "lead-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertPaymentMilestoneAccess(directorActor, "lead-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertPaymentMilestoneAccess(adminActor, "lead-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertPaymentMilestoneAccess(salesActorA, "lead-1", mockOwnershipDb));
  await assert.rejects(
    () => assertPaymentMilestoneAccess(salesActorA, "lead-2", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertPaymentMilestoneAccess(technicianActor, "lead-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertPaymentMilestoneAccess(accountsManagerActor, "lead-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
});

await test("Supabase/local ownership parity for payment milestone and delivery export", async () => {
  delete process.env.SUPABASE_URL;
  await assert.doesNotReject(() => assertPaymentMilestoneAccess(salesActorA, "lead-1", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(salesActorA, "challan-1", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(salesActorA, "challan-via-invoice", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(technicianActor, "challan-1", mockOwnershipDb));
});

await test("export payments scoped for sales and denied for Technician/Customer", () => {
  assert.equal(resolveExportAccess(superAdminActor, "payments"), "full");
  assert.equal(resolveExportAccess(directorActor, "payments"), "full");
  assert.equal(resolveExportAccess(adminActor, "payments"), "full");
  assert.equal(resolveExportAccess(accountsManagerActor, "payments"), "full");
  assert.equal(resolveExportAccess(salesActorA, "payments"), "sales_scoped");
  assert.equal(resolveExportAccess(technicianActor, "payments"), "deny");
  assert.equal(resolveExportAccess(customerActor, "payments"), "deny");

  assert.throws(
    () => assertExportTableAccess(technicianActor, "payments"),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );

  const scoped = filterExportStateForSales(salesActorA, mockExportDb);
  assert.equal(scoped.leads.length, 1);
  assert.equal(scoped.leads[0].id, "lead-1");
  assert.equal(Object.keys(scoped.paymentTracks).length, 1);
  assert.ok(scoped.paymentTracks["lead-1"]);
  assert.equal(scoped.paymentTracks["lead-2"], undefined);
  assert.equal(scoped.projects.length, 1);
  assert.equal(scoped.projects[0].id, "proj-1");
});

await test("unknown export table denied", () => {
  assert.equal(resolveExportAccess(superAdminActor, "tickets"), "deny");
  assert.throws(
    () => assertExportTableAccess(superAdminActor, "tickets"),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
});

await test("delivery export ownership enforced for sales, technician, and denied roles", async () => {
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(superAdminActor, "challan-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(directorActor, "challan-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(adminActor, "challan-2", mockOwnershipDb));
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(salesActorA, "challan-1", mockOwnershipDb));
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(salesActorA, "challan-2", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.doesNotReject(() => assertDeliveryChallanExportAccess(technicianActor, "challan-1", mockOwnershipDb));
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(technicianActor, "challan-2", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(accountsManagerActor, "challan-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(supportAgentActor, "challan-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(customerActor, "challan-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 403
  );
  await assert.rejects(
    () => assertDeliveryChallanExportAccess(undefined, "challan-1", mockOwnershipDb),
    (err: unknown) => err instanceof FinanceRouteLockdownError && err.statusCode === 401
  );
});

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;

console.log(`\nPhase 1B.3A finance route lockdown tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
