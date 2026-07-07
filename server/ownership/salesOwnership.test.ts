/**
 * Phase 1B.2C sales ownership tests — run: npm run test:phase-1b2c
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  SalesOwnershipError,
  SalesOwnershipResolver,
  assertRowSalesOwnedByActor,
  isRowSalesOwnedByActor,
  isSalesOwnershipBypassRole,
  isSalesStaffRole,
  legacySalespersonNameMatches,
  readAssignedSalesUserId,
  readLegacySalesOwnerName,
} from "./SalesOwnershipResolver.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;

const salesActorA: RequestActor = {
  id: "u-sales-1",
  username: "sarah",
  name: "Sarah Connor",
  email: "sarah@sunchaser.com",
  role: "Sales Executive",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const salesActorB: RequestActor = {
  ...salesActorA,
  id: "u-sales-2",
  username: "michael",
  name: "Michael Scott",
};

const adminActor: RequestActor = {
  ...salesActorA,
  id: "u-admin-1",
  role: "Admin",
  username: "admin",
  name: "Alice Admin",
};

const directorActor: RequestActor = {
  ...salesActorA,
  id: "u-director-1",
  role: "Director",
  username: "director",
  name: "Dana Director",
};

const superAdminActor: RequestActor = {
  ...salesActorA,
  id: "u-superadmin-1",
  role: "Super Admin",
  username: "allauddin",
  name: "Allauddin",
};

const technicianActor: RequestActor = {
  ...salesActorA,
  id: "u-tech-1",
  role: "Technician",
  username: "tariq",
  name: "Tariq Technician",
};

const accountsManagerActor: RequestActor = {
  ...salesActorA,
  id: "u-accounts-1",
  role: "Accounts Manager",
  username: "amir",
  name: "Amir Accounts",
};

const surveyEngineerActor: RequestActor = {
  ...salesActorA,
  id: "u-survey-1",
  role: "Survey Engineer",
  username: "faisal",
  name: "Faisal Surveyor",
};

const customerActor: RequestActor = {
  ...salesActorA,
  id: "u-customer-1",
  role: "Customer",
  username: "cust1",
  name: "Cust Omer",
};

const mockDb = {
  leads: [
    {
      id: "lead-1",
      customerId: "cust-1",
      assigned_sales_user_id: "u-sales-1",
      assigned_salesperson: "Sarah Connor",
      quotes: [{ id: "quote-1", quote_type: "manual_boq" }],
    },
    {
      id: "lead-2",
      customerId: "cust-2",
      assigned_sales_user_id: "u-sales-2",
      assigned_salesperson: "Michael Scott",
      quotes: [{ id: "quote-2" }],
    },
    {
      id: "lead-legacy",
      customerId: "cust-legacy",
      assigned_salesperson: "Sarah Connor",
      quotes: [],
    },
    {
      id: "lead-stale",
      customerId: "cust-stale",
      assigned_sales_user_id: "u-sales-2",
      assigned_salesperson: "Sarah Connor",
      quotes: [],
    },
    {
      id: "lead-unassigned",
      customerId: "cust-open",
      assigned_salesperson: "",
      quotes: [],
    },
  ],
  projects: [
    { id: "proj-1", leadId: "lead-1", customerId: "cust-1" },
    { id: "proj-2", leadId: "lead-2", customerId: "cust-2" },
  ],
  quotations: [
    { id: "quote-1", leadId: "lead-1", customerId: "cust-1" },
    { id: "quote-2", leadId: "lead-2", customerId: "cust-2" },
  ],
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

await test("readAssignedSalesUserId prefers durable user id fields", () => {
  assert.equal(
    readAssignedSalesUserId({ assigned_sales_user_id: "u-sales-1", assigned_salesperson: "Other" }),
    "u-sales-1"
  );
  assert.equal(
    readAssignedSalesUserId({ assignedSalesUserId: "u-sales-1", assignedSalesperson: "Other" }),
    "u-sales-1"
  );
});

await test("readLegacySalesOwnerName includes bdmName fallback fields", () => {
  assert.equal(readLegacySalesOwnerName({ bdmName: "Sarah Connor" }), "Sarah Connor");
  assert.equal(readLegacySalesOwnerName({ bdm_name: "Sarah Connor" }), "Sarah Connor");
  assert.equal(
    readLegacySalesOwnerName({ assigned_salesperson: "Michael Scott", bdmName: "Sarah Connor" }),
    "Michael Scott"
  );
});

await test("assertRowSalesOwnedByActor matches legacy bdmName when durable id absent", () => {
  assertRowSalesOwnedByActor(salesActorA, { bdmName: "Sarah Connor" });
  assert.throws(
    () => assertRowSalesOwnedByActor(salesActorA, { bdmName: "Michael Scott" }),
    SalesOwnershipError
  );
});

await test("assertResourceOwnedByActor quotation uses bdmName legacy fallback", async () => {
  const quoteOnlyDb = {
    ...mockDb,
    leads: [
      {
        id: "lead-bdm",
        customerId: "cust-bdm",
        assigned_salesperson: "",
        quotes: [{ id: "quote-bdm", bdmName: "Sarah Connor" }],
      },
    ],
    quotations: [{ id: "quote-bdm", leadId: "lead-bdm" }],
  } as any;
  await SalesOwnershipResolver.assertResourceOwnedByActor(
    salesActorA,
    "quotation",
    "quote-bdm",
    quoteOnlyDb
  );
});

await test("legacySalespersonNameMatches supports exact name or username only", () => {
  assert.equal(legacySalespersonNameMatches(salesActorA, "Sarah Connor"), true);
  assert.equal(legacySalespersonNameMatches(salesActorA, "sarah"), true);
  assert.equal(legacySalespersonNameMatches(salesActorA, "Connor"), false);
  assert.equal(legacySalespersonNameMatches(salesActorA, "Sarah Connor Jr"), false);
  assert.equal(legacySalespersonNameMatches(salesActorA, "Michael Scott"), false);
});

await test("assertRowSalesOwnedByActor matches durable user id", () => {
  assertRowSalesOwnedByActor(salesActorA, { assigned_sales_user_id: "u-sales-1" });
});

await test("assertRowSalesOwnedByActor rejects mismatched durable user id", () => {
  assert.throws(
    () => assertRowSalesOwnedByActor(salesActorA, { assigned_sales_user_id: "u-sales-2" }),
    SalesOwnershipError
  );
});

await test("assertRowSalesOwnedByActor rejects stale legacy when durable id points elsewhere", () => {
  assert.throws(
    () =>
      assertRowSalesOwnedByActor(salesActorA, {
        assigned_sales_user_id: "u-sales-2",
        assigned_salesperson: "Sarah Connor",
      }),
    (err: any) => err instanceof SalesOwnershipError && err.statusCode === 403
  );
});

await test("assertRowSalesOwnedByActor falls back to legacy name when user id absent", () => {
  assertRowSalesOwnedByActor(salesActorA, { assigned_salesperson: "Sarah Connor" });
  assert.throws(
    () => assertRowSalesOwnedByActor(salesActorA, { assigned_salesperson: "Michael Scott" }),
    SalesOwnershipError
  );
});

await test("assertRowSalesOwnedByActor rejects unassigned lead for sales actor", () => {
  assert.throws(
    () => assertRowSalesOwnedByActor(salesActorA, { assigned_salesperson: "" }),
    (err: any) => err instanceof SalesOwnershipError && err.statusCode === 403
  );
});

await test("isSalesStaffRole and bypass roles", () => {
  assert.equal(isSalesStaffRole("Sales Executive"), true);
  assert.equal(isSalesStaffRole("Sales Advisor"), true);
  assert.equal(isSalesStaffRole("Sales Manager"), true);
  assert.equal(isSalesStaffRole("Technician"), false);
  assert.equal(isSalesOwnershipBypassRole("Admin"), true);
  assert.equal(isSalesOwnershipBypassRole("Director"), true);
  assert.equal(isSalesOwnershipBypassRole("Super Admin"), true);
  assert.equal(isSalesOwnershipBypassRole("Sales Executive"), false);
});

await test("shouldEnforceForActor bypasses only Admin/Director/Super Admin; never silently allows anyone else", () => {
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(salesActorA), true);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(adminActor), false);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(directorActor), false);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(superAdminActor), false);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(technicianActor), true);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(accountsManagerActor), true);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(surveyEngineerActor), true);
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(customerActor), true);
  // No actor must never be treated as a free pass.
  assert.equal(SalesOwnershipResolver.shouldEnforceForActor(undefined), true);
});

await test("non-sales, non-bypass roles are denied (403) on sales resources, never silently allowed", async () => {
  for (const actor of [technicianActor, accountsManagerActor, surveyEngineerActor, customerActor]) {
    try {
      await SalesOwnershipResolver.assertResourceOwnedByActor(actor, "lead", "lead-1", mockDb);
      assert.fail(`expected SalesOwnershipError for role ${actor.role}`);
    } catch (err) {
      assert.ok(err instanceof SalesOwnershipError, `role ${actor.role} must throw SalesOwnershipError`);
      assert.equal((err as InstanceType<typeof SalesOwnershipError>).statusCode, 403);
    }
  }
});

await test("filterAppStateForActor returns empty sales collections for non-sales staff (no cross-sales leakage)", () => {
  const stateWithTrackers = {
    ...mockDb,
    paymentTracks: { "lead-1": { totalValue: 100 } },
    netMeteringTrackers: { "lead-1": { meterInstallation: true } },
  } as any;
  for (const actor of [technicianActor, accountsManagerActor, surveyEngineerActor, customerActor]) {
    const filtered = SalesOwnershipResolver.filterAppStateForActor(actor, stateWithTrackers);
    assert.deepEqual(filtered.leads, [], `${actor.role} must see no leads`);
    assert.deepEqual(filtered.projects, [], `${actor.role} must see no projects`);
    assert.deepEqual(filtered.quotations, [], `${actor.role} must see no quotations`);
    assert.deepEqual(filtered.paymentTracks, {}, `${actor.role} must see no payment tracks`);
    assert.deepEqual(filtered.netMeteringTrackers, {}, `${actor.role} must see no net metering trackers`);
  }
});

await test("assertSalesActor returns actor id and rejects missing actor", () => {
  assert.equal(SalesOwnershipResolver.assertSalesActor(salesActorA), "u-sales-1");
  assert.throws(() => SalesOwnershipResolver.assertSalesActor(undefined), (err: any) => {
    assert.equal(err.statusCode, 401);
    return true;
  });
});

await test("assertResourceOwnedByActor lead allows owned lead", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "lead", "lead-1", mockDb);
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "lead", "lead-legacy", mockDb);
});

await test("assertResourceOwnedByActor lead denies other salesperson lead", async () => {
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "lead", "lead-2", mockDb);
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertResourceOwnedByActor lead returns 404 for missing lead", async () => {
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "lead", "lead-missing", mockDb);
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 404);
  }
});

await test("assertResourceOwnedByActor quotation resolves via parent lead", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "quotation", "quote-1", mockDb);
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "quotation", "quote-2", mockDb);
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertResourceOwnedByActor customer requires owned linked lead", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "customer", "cust-1", mockDb);
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "customer", "cust-legacy", mockDb);
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "customer", "cust-2", mockDb);
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertResourceOwnedByActor project resolves via lead", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "project", "proj-1", mockDb);
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "project", "proj-2", mockDb);
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertResourceOwnedByActor manual quote export and quotation pdf use lead ownership", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(
    salesActorA,
    "manual_quote_export",
    "lead-1",
    mockDb
  );
  await SalesOwnershipResolver.assertResourceOwnedByActor(salesActorA, "quotation_pdf", "lead-1", mockDb);
  try {
    await SalesOwnershipResolver.assertResourceOwnedByActor(
      salesActorA,
      "quotation_pdf",
      "lead-2",
      mockDb
    );
    assert.fail("expected SalesOwnershipError");
  } catch (err) {
    assert.ok(err instanceof SalesOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("admin bypass skips ownership enforcement", async () => {
  await SalesOwnershipResolver.assertResourceOwnedByActor(adminActor, "lead", "lead-2", mockDb);
  await SalesOwnershipResolver.assertResourceOwnedByActor(adminActor, "customer", "cust-2", mockDb);
});

await test("filterAppStateForActor keeps only owned leads projects and quotations", () => {
  const filtered = SalesOwnershipResolver.filterAppStateForActor(salesActorA, mockDb);
  assert.deepEqual(
    (filtered.leads as any[]).map((lead) => lead.id).sort(),
    ["lead-1", "lead-legacy"].sort()
  );
  assert.deepEqual((filtered.projects as any[]).map((project) => project.id), ["proj-1"]);
  assert.deepEqual((filtered.quotations as any[]).map((quote) => quote.id), ["quote-1"]);
  assert.equal(isRowSalesOwnedByActor(salesActorA, { id: "lead-stale" }), false);
});

await test("only Admin/Director/Super Admin bypass; all other non-sales roles are non-bypass and non-sales (denied)", () => {
  for (const role of ["Admin", "Director", "Super Admin"]) {
    assert.equal(isSalesOwnershipBypassRole(role), true, `${role} must bypass`);
  }
  const deniedRoles = [
    "Accounts Manager",
    "Technician",
    "Survey Engineer",
    "Installation Team",
    "Customer",
    "Unknown Role",
  ];
  for (const role of deniedRoles) {
    assert.equal(isSalesOwnershipBypassRole(role), false, `${role} must not bypass`);
    assert.equal(isSalesStaffRole(role), false, `${role} must not be sales staff`);
  }
});

await test("filterAppStateForActor filters paymentTracks and netMeteringTrackers by owned lead ids", () => {
  const stateWithTrackers = {
    ...mockDb,
    paymentTracks: {
      "lead-1": { totalValue: 100 },
      "lead-2": { totalValue: 200 },
      "lead-legacy": { totalValue: 300 },
    },
    netMeteringTrackers: {
      "lead-1": { meterInstallation: true },
      "lead-2": { meterInstallation: false },
    },
  } as any;
  const filtered = SalesOwnershipResolver.filterAppStateForActor(salesActorA, stateWithTrackers);
  assert.deepEqual(
    Object.keys(filtered.paymentTracks as Record<string, unknown>).sort(),
    ["lead-1", "lead-legacy"].sort()
  );
  assert.deepEqual(Object.keys(filtered.netMeteringTrackers as Record<string, unknown>), ["lead-1"]);
  // No cross-sales leakage of another salesperson's tracker
  assert.equal((filtered.paymentTracks as Record<string, unknown>)["lead-2"], undefined);
  assert.equal((filtered.netMeteringTrackers as Record<string, unknown>)["lead-2"], undefined);
});

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;

console.log(`\nPhase 1B.2C tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
