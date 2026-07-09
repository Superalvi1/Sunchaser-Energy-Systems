/**
 * Phase 1B.3B finance ownership tests — run: npm run test:phase-1b3b
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  FinanceOwnershipError,
  FinanceOwnershipResolver,
  assertRowFinanceOwnedByActor,
  assertRowFinanceResourceOwnedByActor,
  assertFinanceResourceRouteAccess,
  filterFinanceResourceRowsForActor,
  filterInvoiceRowsForActor,
  isFinanceOwnershipBypassRole,
  isFinanceStaffRole,
  isRowFinanceOwnedByActor,
  legacyFinanceCreatedByMatches,
  partyKeyFromInvoiceRow,
  readFinanceOwnerUserId,
  readLegacyFinanceCreatedBy,
} from "./FinanceOwnershipResolver.ts";
import { SalesOwnershipResolver } from "./SalesOwnershipResolver.ts";
import { createAdminInvoice } from "../../invoiceDb.ts";
import {
  archivePartyLedger,
  getPartyLedgerDetail,
  hardDeletePartyLedger,
  listPartyLedgers,
  restorePartyLedger,
} from "../../partyLedgerDb.ts";
import { fetchFinanceDashboard } from "../../financeDashboardDb.ts";
import { isExcludedFromLedgerTotals } from "../../src/lib/invoices.ts";
import {
  createAdminDeliveryChallan,
  getAdminDeliveryVerificationInfo,
  getInvoiceDeliverySummaryAdmin,
  getPublicDeliveryVerificationPage,
  fetchCustomerPortalDeliveriesMe,
} from "../../deliveryManagementDb.ts";
import {
  createAdminFinanceProject,
  getAdminFinanceProjectById,
  listAdminFinanceProjects,
} from "../../projectFinanceDb.ts";
import {
  createAdminCostingSheet,
  createAdminInventoryPurchase,
  getAdminCostingSheet,
  listAdminCostingSheets,
  listAdminInventoryPurchases,
} from "../../internalCostingDb.ts";
import { StaffPortalAuthError } from "../../dbManager.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;

const accountsActorA: RequestActor = {
  id: "u-accounts-1",
  username: "amir",
  name: "Amir Accounts",
  email: "amir@sunchaser.com",
  role: "Accounts Manager",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const accountsActorB: RequestActor = {
  ...accountsActorA,
  id: "u-accounts-2",
  username: "fatima",
  name: "Fatima Accounts",
};

const superAdminActor: RequestActor = {
  ...accountsActorA,
  id: "u-superadmin-1",
  role: "Super Admin",
  username: "allauddin",
  name: "Allauddin",
};

const directorActor: RequestActor = {
  ...accountsActorA,
  id: "u-director-1",
  role: "Director",
  username: "director",
  name: "Dana Director",
};

const adminActor: RequestActor = {
  ...accountsActorA,
  id: "u-admin-1",
  role: "Admin",
  username: "admin",
  name: "Alice Admin",
};

const salesActor: RequestActor = {
  ...accountsActorA,
  id: "u-sales-1",
  role: "Sales Executive",
  username: "sarah",
  name: "Sarah Connor",
};

const technicianActor: RequestActor = {
  ...accountsActorA,
  id: "u-tech-1",
  role: "Technician",
  username: "tariq",
  name: "Tariq Technician",
};

const customerActor: RequestActor = {
  ...accountsActorA,
  id: "u-customer-1",
  role: "Customer",
  username: "cust1",
  name: "Cust Omer",
};

const mockDb = {
  invoices: [
    {
      id: "inv-1",
      customer_id: "cust-1",
      customer_name: "Alpha Corp",
      customer_phone: "0300-111",
      created_by_user_id: "u-accounts-1",
      created_by: "legacy-wrong",
    },
    {
      id: "inv-2",
      customer_id: "cust-2",
      customer_name: "Beta Ltd",
      customer_phone: "0300-222",
      created_by: "fatima",
    },
    {
      id: "inv-legacy",
      customer_name: "Gamma",
      customer_phone: "0300-333",
      created_by: "amir",
    },
    {
      id: "inv-admin",
      customer_name: "Admin Co",
      customer_phone: "0300-444",
      created_by_user_id: "u-admin-1",
      created_by: "admin",
    },
    {
      id: "inv-sales",
      customer_name: "Sales Co",
      customer_phone: "0300-555",
      created_by_user_id: "u-sales-1",
      created_by: "sarah",
    },
  ],
  invoiceItems: [{ id: "item-1", invoice_id: "inv-1", item_name: "Panel" }],
  invoicePayments: [{ id: "pay-1", invoice_id: "inv-2" }, { id: "pay-sales", invoice_id: "inv-sales" }],
  deliveryChallans: [{ id: "challan-1", invoice_id: "inv-1" }],
  deliveryChallanPhotos: [{ id: "photo-1", challan_id: "challan-1" }],
  projectFinanceRecords: [{ id: "pfr-1", created_by: "u-accounts-1" }],
  internalCostingSheets: [{ id: "ics-1", created_by: "u-accounts-1" }],
  inventoryPurchases: [{ id: "pur-1", created_by: "u-accounts-2" }],
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

await test("readFinanceOwnerUserId prefers created_by_user_id", () => {
  assert.equal(readFinanceOwnerUserId({ created_by_user_id: "u-accounts-1", created_by: "other" }), "u-accounts-1");
  assert.equal(readFinanceOwnerUserId({ createdByUserId: "u-accounts-2" }), "u-accounts-2");
  assert.equal(readFinanceOwnerUserId({ created_by: "amir" }), "");
});

await test("legacy created_by fallback matches username or display name exactly", () => {
  assert.equal(readLegacyFinanceCreatedBy({ created_by: "amir" }), "amir");
  assert.ok(legacyFinanceCreatedByMatches(accountsActorA, "amir"));
  assert.ok(legacyFinanceCreatedByMatches(accountsActorA, "Amir Accounts"));
  assert.equal(legacyFinanceCreatedByMatches(accountsActorA, "ami"), false);
  assert.equal(legacyFinanceCreatedByMatches(accountsActorA, "amir accounts extra"), false);
});

await test("created_by_user_id ownership enforced on parent row", () => {
  assertRowFinanceOwnedByActor(accountsActorA, { created_by_user_id: "u-accounts-1" });
  assert.throws(
    () => assertRowFinanceOwnedByActor(accountsActorB, { created_by_user_id: "u-accounts-1" }),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("stale legacy ignored when created_by_user_id exists", () => {
  assert.throws(
    () =>
      assertRowFinanceOwnedByActor(accountsActorB, {
        created_by_user_id: "u-accounts-1",
        created_by: "fatima",
      }),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
  assert.equal(
    isRowFinanceOwnedByActor(accountsActorB, {
      created_by_user_id: "u-accounts-1",
      created_by: "amir",
    }),
    false
  );
});

await test("invoice item resolves parent invoice ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice_item", "item-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorB, "invoice_item", "item-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("invoice payment resolves parent invoice ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorB, "invoice_payment", "pay-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice_payment", "pay-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("delivery challan resolves parent invoice ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "delivery_challan", "challan-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorB, "delivery_challan", "challan-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("delivery challan photo resolves challan then invoice ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "delivery_challan_photo", "photo-1", mockDb)
  );
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorB, "delivery_challan_photo", "photo-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("project finance record uses created_by user id", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(
      accountsActorA,
      "project_finance_record",
      "pfr-1",
      mockDb
    )
  );
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertResourceOwnedByActor(
        accountsActorB,
        "project_finance_record",
        "pfr-1",
        mockDb
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("internal costing sheet uses created_by user id", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(
      accountsActorA,
      "internal_costing_sheet",
      "ics-1",
      mockDb
    )
  );
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertResourceOwnedByActor(
        accountsActorB,
        "internal_costing_sheet",
        "ics-1",
        mockDb
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("inventory purchase uses created_by user id", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(
      accountsActorB,
      "inventory_purchase",
      "pur-1",
      mockDb
    )
  );
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertResourceOwnedByActor(
        accountsActorA,
        "inventory_purchase",
        "pur-1",
        mockDb
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("party ledger allows access when actor owns visible party invoices", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "party_ledger", "cid:cust-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "party_ledger", "cid:cust-2", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 404
  );
});

await test("invoice_pdf and delivery_challan_pdf alias parent ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice_pdf", "inv-1", mockDb)
  );
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "delivery_challan_pdf", "challan-1", mockDb)
  );
});

await test("Admin Director Super Admin bypass ownership enforcement", async () => {
  for (const actor of [superAdminActor, directorActor, adminActor]) {
    await assert.doesNotReject(() =>
      FinanceOwnershipResolver.assertResourceOwnedByActor(actor, "invoice", "inv-2", mockDb)
    );
  }
  assert.ok(isFinanceOwnershipBypassRole("Super Admin"));
  assert.ok(isFinanceOwnershipBypassRole("Director"));
  assert.ok(isFinanceOwnershipBypassRole("Admin"));
});

await test("Accounts Manager own-only enforcement", async () => {
  assert.ok(isFinanceStaffRole("Accounts Manager"));
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice", "inv-1", mockDb)
  );
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice", "inv-legacy", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice", "inv-2", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Sales Technician Customer denied with 403", async () => {
  for (const actor of [salesActor, technicianActor, customerActor]) {
    await assert.rejects(
      () => FinanceOwnershipResolver.assertResourceOwnedByActor(actor, "invoice", "inv-1", mockDb),
      (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
    );
  }
});

await test("missing actor returns 401", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(undefined, "invoice", "inv-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 401
  );
});

await test("missing resource returns 404", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice", "inv-missing", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 404
  );
});

await test("Accounts Manager own invoice list", () => {
  const rows = filterInvoiceRowsForActor(accountsActorA, mockDb.invoices);
  const ids = rows.map((r) => String(r.id));
  assert.ok(ids.includes("inv-1"));
  assert.ok(ids.includes("inv-legacy"));
  assert.equal(ids.includes("inv-2"), false);
  assert.equal(ids.includes("inv-admin"), false);
  assert.equal(ids.includes("inv-sales"), false);
});

await test("Accounts Manager foreign invoice denied", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(accountsActorA, "inv-2", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Sales own invoice", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(salesActor, "inv-sales", mockDb)
  );
});

await test("Sales foreign invoice denied", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(salesActor, "inv-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Admin own only on invoice module", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(adminActor, "inv-admin", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(adminActor, "inv-2", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Director bypass on invoice module", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(directorActor, "inv-2", mockDb)
  );
  assert.equal(filterInvoiceRowsForActor(directorActor, mockDb.invoices).length, mockDb.invoices.length);
});

await test("Super Admin bypass on invoice module", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(superAdminActor, "inv-2", mockDb)
  );
});

await test("payment inherits invoice ownership not recorded_by", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(salesActor, "inv-sales", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(accountsActorA, "inv-sales", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorB, "invoice_payment", "pay-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertResourceOwnedByActor(accountsActorA, "invoice_payment", "pay-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("invoice PDF ownership uses invoice module resolver", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoicePdfOwnedByActor(accountsActorA, "inv-1", mockDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoicePdfOwnedByActor(accountsActorA, "inv-2", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("invoice create persists created_by_user_id", async () => {
  const createDb = {
    users: [{ id: "u-admin-1", username: "admin", role: "Admin", name: "Alice Admin" }],
    invoices: [],
    invoiceItems: [],
    invoicePayments: [],
    customers: [],
  } as any;
  await createAdminInvoice(
    adminActor,
    {
      customerName: "Test Co",
      items: [{ description: "Panel", qty: 1, rate: 1000 }],
    },
    createDb
  );
  assert.equal(createDb.invoices[0].created_by_user_id, "u-admin-1");
  assert.equal(createDb.invoices[0].created_by, "admin");
});

await test("legacy username fallback still works on invoice module", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(accountsActorA, "inv-legacy", mockDb)
  );
});

await test("durable id overrides stale username on invoice module", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(accountsActorB, "inv-1", mockDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
  assert.equal(
    isRowFinanceOwnedByActor(accountsActorA, mockDb.invoices.find((r: any) => r.id === "inv-1")),
    true
  );
});

const wave3Db = {
  users: [
    { id: "u-accounts-1", username: "amir", role: "Accounts Manager", name: "Amir Accounts" },
    { id: "u-accounts-2", username: "fatima", role: "Accounts Manager", name: "Fatima Accounts" },
    { id: "u-admin-1", username: "admin", role: "Admin", name: "Alice Admin" },
    { id: "u-director-1", username: "director", role: "Director", name: "Dana Director" },
    { id: "u-sales-1", username: "sarah", role: "Sales Executive", name: "Sarah Connor" },
  ],
  invoices: [
    {
      id: "w3-inv-a1",
      invoice_number: "INV-A1",
      invoice_date: "2026-06-01",
      customer_id: "cust-a",
      customer_name: "Alpha",
      customer_phone: "0300-111",
      created_by_user_id: "u-accounts-1",
      grand_total: 1000,
      paid_amount: 200,
      balance_due: 800,
      invoice_status: "active",
      payment_status: "Partial",
    },
    {
      id: "w3-inv-a2",
      invoice_number: "INV-A2",
      invoice_date: "2026-06-02",
      customer_id: "cust-b",
      customer_name: "Beta",
      customer_phone: "0300-222",
      created_by_user_id: "u-accounts-2",
      grand_total: 500,
      paid_amount: 100,
      balance_due: 400,
      invoice_status: "active",
      payment_status: "Partial",
    },
    {
      id: "w3-inv-s1",
      invoice_number: "INV-S1",
      invoice_date: "2026-06-03",
      customer_id: "cust-c",
      customer_name: "Gamma",
      customer_phone: "0300-333",
      created_by_user_id: "u-sales-1",
      grand_total: 300,
      paid_amount: 50,
      balance_due: 250,
      invoice_status: "active",
      payment_status: "Partial",
    },
    {
      id: "w3-inv-void",
      invoice_number: "INV-V",
      invoice_date: "2026-06-04",
      customer_id: "cust-a",
      customer_name: "Alpha",
      customer_phone: "0300-111",
      created_by_user_id: "u-accounts-1",
      grand_total: 9999,
      paid_amount: 0,
      balance_due: 9999,
      invoice_status: "void",
      payment_status: "Unpaid",
    },
    {
      id: "w3-inv-arch",
      invoice_number: "INV-AR",
      invoice_date: "2026-05-01",
      customer_id: "cust-d",
      customer_name: "Delta",
      customer_phone: "0300-444",
      created_by_user_id: "u-accounts-1",
      grand_total: 100,
      paid_amount: 0,
      balance_due: 100,
      invoice_status: "active",
      payment_status: "Unpaid",
      archived_at: "2026-05-15T00:00:00.000Z",
    },
    {
      id: "w3-inv-m1",
      invoice_number: "INV-M1",
      invoice_date: "2026-06-05",
      customer_id: "cust-mixed",
      customer_name: "Mixed",
      customer_phone: "0300-555",
      created_by_user_id: "u-accounts-1",
      grand_total: 100,
      paid_amount: 0,
      balance_due: 100,
      invoice_status: "active",
      payment_status: "Unpaid",
    },
    {
      id: "w3-inv-m2",
      invoice_number: "INV-M2",
      invoice_date: "2026-06-06",
      customer_id: "cust-mixed",
      customer_name: "Mixed",
      customer_phone: "0300-555",
      created_by_user_id: "u-accounts-2",
      grand_total: 100,
      paid_amount: 0,
      balance_due: 100,
      invoice_status: "active",
      payment_status: "Unpaid",
    },
  ],
  invoiceItems: [],
  invoicePayments: [],
  partyLedgerArchives: [],
} as any;

function expectedLedgerTotals(visibleRows: Record<string, unknown>[]) {
  let totalSales = 0;
  let receivedAmount = 0;
  let balanceDue = 0;
  let activeCount = 0;
  for (const row of visibleRows) {
    if (isExcludedFromLedgerTotals(String(row.invoice_status || ""), row.archived_at as string | null)) {
      continue;
    }
    totalSales += Number(row.grand_total || 0);
    receivedAmount += Number(row.paid_amount || 0);
    balanceDue += Number(row.balance_due || 0);
    activeCount += 1;
  }
  return {
    totalSales: Math.round(totalSales * 100) / 100,
    receivedAmount: Math.round(receivedAmount * 100) / 100,
    balanceDue: Math.round(balanceDue * 100) / 100,
    activeCount,
  };
}

await test("Accounts Manager dashboard only own invoices", async () => {
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(accountsActorA, wave3Db);
  const expected = expectedLedgerTotals(visible);
  assert.equal(visible.length, 4);
  assert.equal(expected.activeCount, 2);
  assert.equal(expected.totalSales, 1100);
  assert.equal(expected.balanceDue, 900);
  assert.equal(visible.every((r) => readFinanceOwnerUserId(r) === "u-accounts-1"), true);
});

await test("Admin dashboard own invoices", async () => {
  const adminOwnedDb = {
    ...wave3Db,
    invoices: [
      {
        id: "w3-admin-1",
        invoice_number: "INV-ADM",
        invoice_date: "2026-06-01",
        customer_id: "cust-admin",
        customer_name: "Admin Co",
        created_by_user_id: "u-admin-1",
        grand_total: 700,
        paid_amount: 100,
        balance_due: 600,
        invoice_status: "active",
      },
      ...wave3Db.invoices,
    ],
  };
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(adminActor, adminOwnedDb);
  const dashboard = await fetchFinanceDashboard("u-admin-1", "admin", "Admin", adminOwnedDb);
  const expected = expectedLedgerTotals(visible);
  assert.equal(visible.length, 1);
  assert.equal(dashboard.summary.totalSales, expected.totalSales);
  assert.equal(dashboard.summary.outstandingReceivables, expected.balanceDue);
});

await test("Director dashboard all invoices", async () => {
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(directorActor, wave3Db);
  const expected = expectedLedgerTotals(visible);
  assert.equal(visible.length, wave3Db.invoices.length);
  assert.equal(expected.activeCount, 5);
  assert.equal(expected.totalSales, 2000);
});

await test("Sales dashboard own invoices", async () => {
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(salesActor, wave3Db);
  const parties = await listPartyLedgers("u-sales-1", "sarah", "Sales Executive", wave3Db);
  const expected = expectedLedgerTotals(visible);
  assert.equal(visible.length, 1);
  assert.equal(parties.length, 1);
  assert.equal(parties[0].partyKey, "cid:cust-c");
  assert.equal(parties[0].totalSales, expected.totalSales);
});

await test("party ledger own invoices only", async () => {
  const adminOnlyDb = {
    ...wave3Db,
    invoices: [
      {
        id: "w3-admin-only",
        invoice_number: "INV-OWN",
        invoice_date: "2026-06-01",
        customer_id: "cust-own",
        customer_name: "Own Co",
        created_by_user_id: "u-admin-1",
        grand_total: 400,
        paid_amount: 0,
        balance_due: 400,
        invoice_status: "active",
      },
      ...wave3Db.invoices,
    ],
  };
  const parties = await listPartyLedgers("u-admin-1", "admin", "Admin", adminOnlyDb);
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(adminActor, adminOnlyDb);
  const partyKeys = new Set(visible.map((r) => partyKeyFromInvoiceRow(r)));
  assert.equal(parties.every((p) => partyKeys.has(p.partyKey)), true);
  assert.equal(parties.length, 1);
});

await test("party detail foreign party returns 404", async () => {
  await assert.rejects(
    () => getPartyLedgerDetail("u-admin-1", "admin", "Admin", "cid:cust-b", wave3Db),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 404
  );
});

await test("archive own party succeeds", async () => {
  const archiveDb = JSON.parse(JSON.stringify(wave3Db));
  archiveDb.invoices = [
    {
      id: "w3-admin-archive",
      invoice_number: "INV-ARCH",
      invoice_date: "2026-06-01",
      customer_id: "cust-archive",
      customer_name: "Archive Co",
      created_by_user_id: "u-admin-1",
      grand_total: 150,
      paid_amount: 0,
      balance_due: 150,
      invoice_status: "active",
    },
  ];
  const archived = await archivePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-archive", archiveDb);
  assert.equal(archived.partyKey, "cid:cust-archive");
  assert.ok(archiveDb.partyLedgerArchives.length >= 1);
});

await test("archive partially-owned party fails", async () => {
  await assert.rejects(
    () => archivePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-mixed", wave3Db),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 403
  );
});

await test("restore follows same ownership", async () => {
  const restoreDb = JSON.parse(JSON.stringify(wave3Db));
  restoreDb.invoices = [
    ...wave3Db.invoices.filter((r: any) => r.customer_id === "cust-mixed"),
    {
      id: "w3-admin-restore",
      invoice_number: "INV-REST",
      invoice_date: "2026-06-01",
      customer_id: "cust-restore",
      customer_name: "Restore Co",
      created_by_user_id: "u-admin-1",
      grand_total: 150,
      paid_amount: 0,
      balance_due: 150,
      invoice_status: "active",
    },
  ];
  restoreDb.partyLedgerArchives = [
    {
      party_key: "cid:cust-mixed",
      customer_id: "cust-mixed",
      party_name: "Mixed",
      party_phone: "0300-555",
      archived_at: new Date().toISOString(),
      archived_by: "admin",
    },
  ];
  await assert.rejects(
    () => restorePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-mixed", restoreDb),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 403
  );
  await archivePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-restore", restoreDb);
  const restored = await restorePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-restore", restoreDb);
  assert.equal(restored.partyKey, "cid:cust-restore");
});

await test("delete follows same ownership", async () => {
  await assert.rejects(
    () => hardDeletePartyLedger("u-admin-1", "admin", "Admin", "cid:cust-mixed", wave3Db),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 403
  );
});

await test("ledger totals equal filtered invoice set", async () => {
  const adminLedgerDb = {
    ...wave3Db,
    invoices: [
      {
        id: "w3-admin-ledger",
        invoice_number: "INV-L",
        invoice_date: "2026-06-01",
        customer_id: "cust-own2",
        customer_name: "Own2",
        created_by_user_id: "u-admin-1",
        grand_total: 250,
        paid_amount: 50,
        balance_due: 200,
        invoice_status: "active",
      },
    ],
  };
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(adminActor, adminLedgerDb);
  const expected = expectedLedgerTotals(visible);
  const parties = await listPartyLedgers("u-admin-1", "admin", "Admin", adminLedgerDb);
  const totals = parties.reduce(
    (acc, p) => ({
      totalSales: acc.totalSales + Number(p.totalSales || 0),
      receivedAmount: acc.receivedAmount + Number(p.receivedAmount || 0),
      balanceDue: acc.balanceDue + Number(p.balanceDue || 0),
      invoiceCount: acc.invoiceCount + Number(p.invoiceCount || 0),
    }),
    { totalSales: 0, receivedAmount: 0, balanceDue: 0, invoiceCount: 0 }
  );
  assert.equal(totals.invoiceCount, expected.activeCount);
  assert.equal(Math.round(totals.totalSales * 100) / 100, expected.totalSales);
  assert.equal(Math.round(totals.balanceDue * 100) / 100, expected.balanceDue);
});

await test("dashboard totals equal filtered invoice set", async () => {
  const adminOnlyDb = {
    ...wave3Db,
    invoices: [
      {
        id: "w3-admin-dash",
        invoice_number: "INV-DASH",
        invoice_date: "2026-06-01",
        customer_id: "cust-dash",
        customer_name: "Dash Co",
        created_by_user_id: "u-admin-1",
        grand_total: 1200,
        paid_amount: 200,
        balance_due: 1000,
        invoice_status: "active",
      },
    ],
  };
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(adminActor, adminOnlyDb);
  const expected = expectedLedgerTotals(visible);
  const dashboard = await fetchFinanceDashboard("u-admin-1", "admin", "Admin", adminOnlyDb);
  assert.equal(dashboard.summary.totalSales, expected.totalSales);
  assert.equal(dashboard.summary.totalReceived, expected.receivedAmount);
  assert.equal(dashboard.summary.outstandingReceivables, expected.balanceDue);
  assert.equal(dashboard.summary.totalInvoices, expected.activeCount);
});

await test("archived invoices excluded from active totals", async () => {
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(accountsActorA, wave3Db);
  const expected = expectedLedgerTotals(visible);
  assert.equal(expected.activeCount, 2);
  assert.equal(
    visible.some((r) => String(r.id) === "w3-inv-arch" && isExcludedFromLedgerTotals("active", r.archived_at as string)),
    true
  );
});

await test("void invoices excluded", async () => {
  const visible = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(accountsActorA, wave3Db);
  const expected = expectedLedgerTotals(visible);
  assert.equal(visible.some((r) => r.id === "w3-inv-void"), true);
  assert.equal(expected.totalSales, 1100);
});

const deliveryWaveDb = {
  users: [
    { id: "u-accounts-1", username: "amir", role: "Accounts Manager", name: "Amir Accounts" },
    { id: "u-admin-1", username: "admin", role: "Admin", name: "Alice Admin" },
    { id: "u-sales-1", username: "sarah", role: "Sales Executive", name: "Sarah Connor" },
    { id: "u-tech-1", username: "tariq", role: "Technician", name: "Tariq Technician" },
    { id: "u-customer-1", username: "cust1", role: "Customer", name: "Cust Omer", customerId: "c-portal" },
  ],
  invoices: [
    {
      id: "dinv-am",
      invoice_number: "INV-AM",
      created_by_user_id: "u-accounts-1",
      customer_id: "c-am",
      customer_name: "AM Co",
      grand_total: 1000,
      subtotal: 1000,
    },
    {
      id: "dinv-sales",
      invoice_number: "INV-S",
      created_by_user_id: "u-sales-1",
      customer_id: "c-sales",
      customer_name: "Sales Co",
      grand_total: 500,
      subtotal: 500,
    },
    {
      id: "dinv-admin",
      invoice_number: "INV-A",
      created_by_user_id: "u-admin-1",
      customer_id: "c-admin",
      customer_name: "Admin Co",
      grand_total: 300,
      subtotal: 300,
    },
    {
      id: "dinv-foreign",
      invoice_number: "INV-F",
      created_by_user_id: "u-accounts-1",
      customer_id: "c-f",
      customer_name: "Foreign",
      grand_total: 200,
      subtotal: 200,
    },
  ],
  invoiceItems: [
    {
      id: "ditem-am",
      invoice_id: "dinv-am",
      item_name: "Panel",
      description: "Panel",
      qty: 10,
      rate: 100,
      line_total: 1000,
    },
    {
      id: "ditem-admin",
      invoice_id: "dinv-admin",
      item_name: "Panel",
      description: "Panel",
      qty: 3,
      rate: 100,
      line_total: 300,
    },
  ],
  deliveryChallans: [
    { id: "dch-am", invoice_id: "dinv-am", lead_id: "lead-am", challan_number: "DC-1", status: "draft" },
    { id: "dch-sales", invoice_id: "dinv-sales", lead_id: "lead-sales", challan_number: "DC-2", status: "draft" },
    { id: "dch-admin", invoice_id: "dinv-admin", challan_number: "DC-3", status: "draft" },
    { id: "dch-tech", invoice_id: "dinv-am", lead_id: "lead-am", challan_number: "DC-4", status: "draft" },
    { id: "dch-foreign", invoice_id: "dinv-foreign", challan_number: "DC-5", status: "draft" },
    {
      id: "dch-public",
      invoice_id: "dinv-am",
      customer_id: "c-portal",
      challan_number: "DC-P",
      status: "delivered_pending_verification",
      verification_token: "public-token-1",
      token_expires_at: "2099-01-01T00:00:00.000Z",
    },
  ],
  deliveryChallanPhotos: [{ id: "dphoto-am", challan_id: "dch-am", photo_url: "http://x", photo_type: "material" }],
  deliveryChallanItems: [],
  projectDeliveries: [{ id: "pd-1", lead_id: "lead-am", assigned_technician_user_id: "u-tech-1" }],
} as any;

await test("Accounts Manager own challan", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(accountsActorA, "dch-am", deliveryWaveDb)
  );
});

await test("Accounts Manager foreign challan denied", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(accountsActorA, "dch-sales", deliveryWaveDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Sales own challan", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(salesActor, "dch-sales", deliveryWaveDb)
  );
});

await test("Sales foreign challan denied", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(salesActor, "dch-am", deliveryWaveDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Admin own challan", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(adminActor, "dch-admin", deliveryWaveDb)
  );
});

await test("Director bypass", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(directorActor, "dch-foreign", deliveryWaveDb)
  );
});

await test("Super Admin bypass", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(superAdminActor, "dch-foreign", deliveryWaveDb)
  );
});

await test("Technician delegated assigned delivery", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(technicianActor, "dch-tech", deliveryWaveDb)
  );
});

await test("Technician foreign delivery denied", async () => {
  await assert.rejects(
    () => FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(technicianActor, "dch-sales", deliveryWaveDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Delivery photo inherits challan ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanPhotoOwnedByActor(accountsActorA, "dphoto-am", deliveryWaveDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertDeliveryChallanPhotoOwnedByActor(accountsActorB, "dphoto-am", deliveryWaveDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Delivery summary ownership", async () => {
  const summary = await getInvoiceDeliverySummaryAdmin(
    "u-admin-1",
    "admin",
    "Admin",
    "dinv-admin",
    deliveryWaveDb
  );
  assert.equal(summary.summary.invoiceId, "dinv-admin");
  await assert.rejects(
    () => getInvoiceDeliverySummaryAdmin("u-admin-1", "admin", "Admin", "dinv-am", deliveryWaveDb),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 403
  );
});

await test("Certificate ownership", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(adminActor, "dch-admin", deliveryWaveDb)
  );
  await assert.rejects(
    () => FinanceOwnershipResolver.assertDeliveryChallanOwnedByActor(adminActor, "dch-am", deliveryWaveDb),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("Verification info ownership", async () => {
  const info = await getAdminDeliveryVerificationInfo(
    "u-admin-1",
    "admin",
    "Admin",
    "dch-admin",
    deliveryWaveDb
  );
  assert.equal(info.challan.id, "dch-admin");
  await assert.rejects(
    () => getAdminDeliveryVerificationInfo("u-admin-1", "admin", "Admin", "dch-am", deliveryWaveDb),
    (err: unknown) => err instanceof Error && (err as any).statusCode === 403
  );
});

await test("Delivery create persists created_by_user_id", async () => {
  const createDb = JSON.parse(JSON.stringify(deliveryWaveDb));
  createDb.deliveryChallans = [];
  createDb.deliveryChallanItems = [];
  const result = await createAdminDeliveryChallan(
    "u-admin-1",
    "admin",
    "Admin",
    {
      invoiceId: "dinv-admin",
      items: [{ invoiceItemId: "ditem-admin", deliverNowQty: 1 }],
    },
    createDb
  );
  assert.equal(createDb.deliveryChallans[0].created_by_user_id, "u-admin-1");
  assert.equal(createDb.deliveryChallans[0].created_by, "admin");
  assert.ok(result.challan.id);
});

await test("Customer routes unchanged", async () => {
  const portalDb = JSON.parse(JSON.stringify(deliveryWaveDb));
  const data = await fetchCustomerPortalDeliveriesMe("u-customer-1", "cust1", portalDb);
  assert.equal(data.deliveries.length, 1);
  assert.equal(data.deliveries[0].id, "dch-public");
});

await test("Public token routes unchanged", async () => {
  const page = await getPublicDeliveryVerificationPage("public-token-1", deliveryWaveDb);
  assert.equal(page.challan.id, "dch-public");
});

const wave5Db = {
  users: [
    { id: "u-accounts-1", username: "amir", role: "Accounts Manager", name: "Amir Accounts" },
    { id: "u-accounts-2", username: "fatima", role: "Accounts Manager", name: "Fatima Accounts" },
    { id: "u-admin-1", username: "admin", role: "Admin", name: "Alice Admin" },
    { id: "u-director-1", username: "director", role: "Director", name: "Dana Director" },
    { id: "u-superadmin-1", username: "allauddin", role: "Super Admin", name: "Allauddin" },
    { id: "u-superadmin-2", username: "otheradmin", role: "Super Admin", name: "Other Admin" },
    { id: "u-sales-1", username: "sarah", role: "Sales Executive", name: "Sarah Connor" },
    { id: "u-tech-1", username: "tariq", role: "Technician", name: "Tariq Technician" },
    { id: "u-customer-1", username: "cust1", role: "Customer", name: "Cust Omer" },
  ],
  projectFinanceRecords: [
    {
      id: "w5-pfr-own",
      customer_id: "cust-1",
      sale_value: 100000,
      advance_received: 50000,
      balance_remaining: 50000,
      supplier_cost: 40000,
      installation_cost: 5000,
      transport_cost: 1000,
      misc_expense: 500,
      total_expense: 46500,
      gross_profit: 53500,
      profit_margin_percent: 53.5,
      payment_status: "Partially Paid",
      created_by_user_id: "u-accounts-1",
      created_by: "u-accounts-2",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "w5-pfr-foreign",
      customer_id: "cust-2",
      sale_value: 50000,
      advance_received: 0,
      balance_remaining: 50000,
      supplier_cost: 20000,
      installation_cost: 0,
      transport_cost: 0,
      misc_expense: 0,
      total_expense: 20000,
      gross_profit: 30000,
      profit_margin_percent: 60,
      payment_status: "Unpaid",
      created_by: "u-accounts-2",
      created_at: "2026-06-02T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    },
    {
      id: "w5-pfr-legacy",
      customer_id: "cust-3",
      sale_value: 25000,
      advance_received: 0,
      balance_remaining: 25000,
      supplier_cost: 10000,
      installation_cost: 0,
      transport_cost: 0,
      misc_expense: 0,
      total_expense: 10000,
      gross_profit: 15000,
      profit_margin_percent: 60,
      payment_status: "Unpaid",
      created_by: "u-accounts-1",
      created_at: "2026-06-03T00:00:00.000Z",
      updated_at: "2026-06-03T00:00:00.000Z",
    },
    {
      id: "w5-pfr-admin",
      customer_id: "cust-4",
      sale_value: 80000,
      advance_received: 20000,
      balance_remaining: 60000,
      supplier_cost: 30000,
      installation_cost: 0,
      transport_cost: 0,
      misc_expense: 0,
      total_expense: 30000,
      gross_profit: 50000,
      profit_margin_percent: 62.5,
      payment_status: "Partially Paid",
      created_by_user_id: "u-admin-1",
      created_by: "u-admin-1",
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
    },
  ],
  internalCostingSheets: [
    {
      id: "w5-ics-own",
      client_name: "Alpha",
      title: "Alpha Costing",
      items: [],
      created_by_user_id: "u-superadmin-1",
      created_by: "u-superadmin-2",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "w5-ics-foreign",
      client_name: "Beta",
      title: "Beta Costing",
      items: [],
      created_by: "u-superadmin-2",
      created_at: "2026-06-02T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    },
  ],
  inventoryPurchases: [
    {
      id: "w5-pur-own",
      supplier_name: "Supplier A",
      product_name: "Panel",
      quantity: 10,
      purchase_rate: 100,
      total_cost: 1000,
      payment_status: "Unpaid",
      created_by_user_id: "u-superadmin-1",
      created_by: "u-superadmin-2",
      created_at: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "w5-pur-foreign",
      supplier_name: "Supplier B",
      product_name: "Inverter",
      quantity: 2,
      purchase_rate: 500,
      total_cost: 1000,
      payment_status: "Unpaid",
      created_by: "u-superadmin-2",
      created_at: "2026-06-02T00:00:00.000Z",
    },
  ],
} as any;

const superAdminActorB: RequestActor = {
  ...superAdminActor,
  id: "u-superadmin-2",
  username: "otheradmin",
  name: "Other Admin",
};

await test("project finance own record", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertProjectFinanceRecordOwnedByActor(
      accountsActorA,
      "w5-pfr-own",
      wave5Db
    )
  );
  const adminRow = await getAdminFinanceProjectById("u-admin-1", "admin", "w5-pfr-admin", wave5Db);
  assert.equal(adminRow.id, "w5-pfr-admin");
});

await test("project finance foreign denied", async () => {
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertProjectFinanceRecordOwnedByActor(
        accountsActorB,
        "w5-pfr-own",
        wave5Db
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("profit fields still hidden unless existing profit gate allows", async () => {
  const adminList = await listAdminFinanceProjects("u-admin-1", "admin", wave5Db);
  const adminRow = adminList.find((r) => r.id === "w5-pfr-admin");
  assert.ok(adminRow);
  assert.equal("grossProfit" in adminRow!, false);
  assert.equal("supplierCost" in adminRow!, false);
  const allauddinList = await listAdminFinanceProjects("u-superadmin-1", "allauddin", wave5Db);
  const profitRow = allauddinList.find((r) => r.id === "w5-pfr-own");
  assert.ok(profitRow);
  assert.equal(typeof profitRow!.grossProfit, "number");
});

await test("internal costing own record", async () => {
  const { sheet } = await getAdminCostingSheet("u-superadmin-1", "allauddin", "w5-ics-own", wave5Db);
  assert.equal(sheet.id, "w5-ics-own");
});

await test("internal costing foreign denied", async () => {
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertInternalCostingSheetOwnedByActor(
        accountsActorA,
        "w5-ics-foreign",
        wave5Db
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("internal costing Super Admin behavior unchanged", async () => {
  await assert.rejects(
    () => listAdminCostingSheets("u-accounts-1", "amir", wave5Db),
    (err: unknown) => err instanceof StaffPortalAuthError && err.statusCode === 403
  );
  const { sheets } = await listAdminCostingSheets("u-superadmin-1", "allauddin", wave5Db);
  assert.ok(sheets.length >= 2);
});

await test("inventory purchase own record", async () => {
  const { purchases } = await listAdminInventoryPurchases("u-superadmin-1", "allauddin", wave5Db);
  assert.ok(purchases.some((p) => p.id === "w5-pur-own"));
});

await test("inventory purchase foreign denied", async () => {
  await assert.rejects(
    () =>
      FinanceOwnershipResolver.assertInventoryPurchaseOwnedByActor(
        accountsActorA,
        "w5-pur-own",
        wave5Db
      ),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("inventory purchase Super Admin behavior unchanged", async () => {
  await assert.rejects(
    () => listAdminInventoryPurchases("u-accounts-1", "amir", wave5Db),
    (err: unknown) => err instanceof StaffPortalAuthError && err.statusCode === 403
  );
  const { purchases } = await listAdminInventoryPurchases("u-superadmin-1", "allauddin", wave5Db);
  assert.equal(purchases.length, 2);
});

await test("create paths persist created_by_user_id", async () => {
  const createDb = JSON.parse(JSON.stringify(wave5Db));
  const finance = await createAdminFinanceProject(
    "u-admin-1",
    "admin",
    { id: "w5-pfr-new", customerId: "cust-new", saleValue: 1000 },
    createDb
  );
  assert.equal(finance.id, "w5-pfr-new");
  const savedFinance = createDb.projectFinanceRecords.find((r: any) => r.id === "w5-pfr-new");
  assert.equal(savedFinance.created_by_user_id, "u-admin-1");
  assert.equal(savedFinance.created_by, "u-admin-1");

  const { sheet } = await createAdminCostingSheet(
    "u-superadmin-1",
    "allauddin",
    { id: "w5-ics-new", clientName: "New Client", items: [] },
    createDb
  );
  assert.equal(sheet.id, "w5-ics-new");
  const savedSheet = createDb.internalCostingSheets.find((r: any) => r.id === "w5-ics-new");
  assert.equal(savedSheet.created_by_user_id, "u-superadmin-1");

  const { purchase } = await createAdminInventoryPurchase(
    "u-superadmin-1",
    "allauddin",
    {
      id: "w5-pur-new",
      supplierName: "S",
      productName: "P",
      quantity: 1,
      purchaseRate: 100,
    },
    createDb
  );
  assert.equal(purchase.id, "w5-pur-new");
  const savedPurchase = createDb.inventoryPurchases.find((r: any) => r.id === "w5-pur-new");
  assert.equal(savedPurchase.created_by_user_id, "u-superadmin-1");
});

await test("legacy created_by user id fallback", async () => {
  await assert.doesNotReject(() =>
    FinanceOwnershipResolver.assertProjectFinanceRecordOwnedByActor(
      accountsActorA,
      "w5-pfr-legacy",
      wave5Db
    )
  );
  const visible = filterFinanceResourceRowsForActor(accountsActorA, wave5Db.projectFinanceRecords);
  assert.ok(visible.some((r) => String(r.id) === "w5-pfr-legacy"));
});

await test("durable id overrides legacy", () => {
  const row = wave5Db.projectFinanceRecords.find((r: any) => r.id === "w5-pfr-own");
  assert.throws(
    () => assertRowFinanceResourceOwnedByActor(accountsActorB, row),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
  assert.doesNotThrow(() => assertRowFinanceResourceOwnedByActor(accountsActorA, row));
  assert.throws(
    () =>
      assertRowFinanceResourceOwnedByActor(accountsActorA, {
        created_by_user_id: "u-accounts-2",
        created_by: "u-accounts-1",
      }),
    (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
  );
});

await test("finance resource Sales Technician Customer denied", async () => {
  for (const actor of [salesActor, technicianActor, customerActor]) {
    assert.throws(
      () => assertFinanceResourceRouteAccess(actor),
      (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
    );
    await assert.rejects(
      () =>
        FinanceOwnershipResolver.assertProjectFinanceRecordOwnedByActor(actor, "w5-pfr-own", wave5Db),
      (err: unknown) => err instanceof FinanceOwnershipError && err.statusCode === 403
    );
  }
});

await test("finance resource Director Admin Super Admin bypass where route allows", async () => {
  for (const actor of [superAdminActor, directorActor, adminActor]) {
    assert.doesNotThrow(() => assertFinanceResourceRouteAccess(actor));
    await assert.doesNotReject(() =>
      FinanceOwnershipResolver.assertProjectFinanceRecordOwnedByActor(
        actor,
        "w5-pfr-foreign",
        wave5Db
      )
    );
  }
  const adminList = await listAdminFinanceProjects("u-admin-1", "admin", wave5Db);
  assert.equal(adminList.length, wave5Db.projectFinanceRecords.length);
  const superList = await listAdminFinanceProjects("u-superadmin-1", "allauddin", wave5Db);
  assert.equal(superList.length, wave5Db.projectFinanceRecords.length);
});

await test("finance resource rows filter own-only for Accounts Manager", () => {
  const visible = filterFinanceResourceRowsForActor(
    accountsActorA,
    wave5Db.projectFinanceRecords
  );
  const ids = visible.map((r) => String(r.id));
  assert.ok(ids.includes("w5-pfr-own"));
  assert.ok(ids.includes("w5-pfr-legacy"));
  assert.equal(ids.includes("w5-pfr-foreign"), false);
});

const stateBootWithFinance = {
  leads: [{ id: "lead-1", assigned_sales_user_id: "u-sales-1", name: "Alpha" }],
  projects: [{ id: "proj-1", leadId: "lead-1" }],
  paymentTracks: { "lead-1": { milestones: [{ id: "m1", label: "Advance" }] } },
  invoices: [{ id: "inv-1", invoice_number: "INV-1" }],
  invoiceItems: [{ id: "item-1", invoice_id: "inv-1" }],
  invoicePayments: [{ id: "pay-1", invoice_id: "inv-1" }],
  deliveryChallans: [{ id: "dc-1", invoice_id: "inv-1" }],
  deliveryChallanPhotos: [{ id: "photo-1", challan_id: "dc-1" }],
  projectFinanceRecords: [{ id: "pfr-1" }],
  internalCostingSheets: [{ id: "ics-1" }],
  inventoryPurchases: [{ id: "pur-1" }],
  partyLedgerArchives: [{ party_key: "cid:cust-1" }],
  investors: [{ id: "inv-investor-1", name: "Investor A" }],
  bankAccounts: [
    {
      id: "bank-1",
      bankName: "Test Bank",
      accountTitle: "Sunchaser Energy",
      accountNumber: "1234567890",
      iban: "PK00SECRETIBAN",
      branchCode: "001",
      notes: "internal routing note",
      showOnInvoice: true,
      isActive: true,
    },
  ],
  purchaseOrders: [{ id: "po-1", supplier: "Vendor", total: 5000 }],
  mysteryFinanceLedger: [{ id: "mfl-1", amount: 999 }],
} as Record<string, unknown>;

function applyBootStatePipeline(actor: RequestActor, state: Record<string, unknown>) {
  const afterSales = SalesOwnershipResolver.shouldEnforceForActor(actor)
    ? SalesOwnershipResolver.filterAppStateForActor(actor, state)
    : state;
  return FinanceOwnershipResolver.filterAppStateForActor(actor, afterSales);
}

await test("state boot invoices absent", () => {
  const filtered = applyBootStatePipeline(salesActor, stateBootWithFinance);
  assert.equal("invoices" in filtered, false);
  assert.equal("invoiceItems" in filtered, false);
  assert.equal("invoicePayments" in filtered, false);
});

await test("state boot deliveryChallans absent", () => {
  const filtered = applyBootStatePipeline(salesActor, stateBootWithFinance);
  assert.equal("deliveryChallans" in filtered, false);
  assert.equal("deliveryChallanPhotos" in filtered, false);
});

await test("state boot investors absent", () => {
  const filtered = applyBootStatePipeline(salesActor, stateBootWithFinance);
  assert.equal("investors" in filtered, false);
  assert.equal("partyLedgerArchives" in filtered, false);
});

await test("state boot paymentTracks unchanged by finance filter", () => {
  const afterSales = SalesOwnershipResolver.filterAppStateForActor(salesActor, stateBootWithFinance);
  const filtered = FinanceOwnershipResolver.filterAppStateForActor(salesActor, afterSales);
  assert.deepEqual(filtered.paymentTracks, afterSales.paymentTracks);
});

await test("state boot bankAccounts masked for normal staff", () => {
  const filtered = applyBootStatePipeline(technicianActor, stateBootWithFinance);
  const bank = (filtered.bankAccounts as any[])[0];
  assert.ok(bank);
  assert.equal(bank.bankName, "Test Bank");
  assert.equal(bank.accountTitle, "Sunchaser Energy");
  assert.equal(bank.accountNumber, "******7890");
  assert.equal(bank.showOnInvoice, true);
  assert.equal(bank.isActive, true);
  assert.equal("iban" in bank, false);
  assert.equal("branchCode" in bank, false);
  assert.equal("notes" in bank, false);
});

await test("state boot purchaseOrders hidden for normal staff", () => {
  const filtered = applyBootStatePipeline(salesActor, stateBootWithFinance);
  assert.deepEqual(filtered.purchaseOrders, []);
});

await test("state boot Director bypass gets full bankAccounts and purchaseOrders", () => {
  const filtered = applyBootStatePipeline(directorActor, stateBootWithFinance);
  const bank = (filtered.bankAccounts as any[])[0];
  assert.equal(bank.iban, "PK00SECRETIBAN");
  assert.equal(bank.accountNumber, "1234567890");
  assert.equal((filtered.purchaseOrders as any[]).length, 1);
});

await test("state boot Super Admin bypass gets full bankAccounts and purchaseOrders", () => {
  const filtered = applyBootStatePipeline(superAdminActor, stateBootWithFinance);
  const bank = (filtered.bankAccounts as any[])[0];
  assert.equal(bank.iban, "PK00SECRETIBAN");
  assert.equal((filtered.purchaseOrders as any[]).length, 1);
});

await test("state boot Admin bypass gets full bankAccounts and purchaseOrders", () => {
  const filtered = applyBootStatePipeline(adminActor, stateBootWithFinance);
  const bank = (filtered.bankAccounts as any[])[0];
  assert.equal(bank.iban, "PK00SECRETIBAN");
  assert.equal((filtered.purchaseOrders as any[]).length, 1);
});

await test("state boot unknown finance key removed", () => {
  const filtered = applyBootStatePipeline(salesActor, stateBootWithFinance);
  assert.equal("mysteryFinanceLedger" in filtered, false);
});

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;

console.log(`\nPhase 1B.3B finance ownership tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
