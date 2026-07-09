import assert from "node:assert/strict";
import {
  assertPreviewSafe,
  assertSearchOutputSafe,
  buildGlobalSearchShellModel,
  clearLegacyRecentSearchStorage,
  GLOBAL_SEARCH_RECENT_STORAGE_KEY,
  isGlobalSearchAllowedForUser,
  isSensitiveFieldKey,
  runGlobalSearch,
  safeDisplayText,
  type StorageLike,
} from "./globalSearch.ts";
import type { AppState, User } from "../types";

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

const staffUser: User = {
  id: "u-1",
  username: "admin",
  name: "Admin User",
  email: "admin@test.com",
  role: "Super Admin",
};

const customerUser: User = {
  id: "u-2",
  username: "cust",
  name: "Customer User",
  email: "cust@test.com",
  role: "Customer",
};

const MALICIOUS = {
  phone: "03001234567",
  cnic: "35202-1234567-1",
  address: "123 Private Street Gulberg",
  bank: "IBAN PK36SCBL0000001123456702",
  notes: "SECRET PRIVATE NOTES bank account 998877",
  email: "fatima.secret@evil-bank.com",
  customer: "Sunrise Villas Fatima Shah",
  rep: "Ali Khan 03001234567",
  subject: "Inverter alarm at Private Street",
  taskName: "Call customer at 123 Private Street",
};

const partialState = {
  leads: [
    {
      id: "lead-1",
      name: MALICIOUS.customer,
      email: MALICIOUS.email,
      phone: MALICIOUS.phone,
      address: MALICIOUS.address,
      status: "Quoted" as const,
      monthlyBill: 50000,
      roofSpace: 100,
      shading: "Low" as const,
      rating: 4,
      assignedSalesperson: MALICIOUS.rep,
      createdAt: "2026-01-01",
      notes: MALICIOUS.notes,
      quotes: [
        {
          id: "q-1",
          systemSizekW: 10,
          panelCount: 18,
          panelType: "SunMax",
          inverterType: "Hybrid",
          batteryCapacity: "10kWh",
          totalCost: 999999,
          federalTaxCredit: 0,
          netCost: 888888,
          estimatedAnnualSavings: 1000,
          paybackPeriodYears: 4,
          status: "Pending" as const,
          createdAt: "2026-01-02",
          cnic: MALICIOUS.cnic,
          clientName: MALICIOUS.customer,
        },
      ],
      installation: {
        status: "Scheduled" as const,
        scheduledDate: new Date().toISOString().slice(0, 10),
        progress: 10,
        tasks: [{ id: "task-1", name: MALICIOUS.taskName, done: false }],
        completionPhotos: [],
        report: MALICIOUS.bank,
      },
    },
    {
      id: "lead-2",
      name: "Green Valley Corp",
      email: "gv@test.com",
      phone: "03007654321",
      address: "Islamabad",
      status: "Contracted" as const,
      monthlyBill: 80000,
      roofSpace: 200,
      shading: "None" as const,
      rating: 5,
      assignedSalesperson: "Sara",
      createdAt: "2026-01-03",
      notes: "hidden",
      quotes: [{ id: "q-2", systemSizekW: 8, panelCount: 14, panelType: "SunMax", inverterType: "Hybrid", batteryCapacity: "5kWh", totalCost: 400000, federalTaxCredit: 0, netCost: 380000, estimatedAnnualSavings: 800, paybackPeriodYears: 5, status: "Accepted" as const, createdAt: "2026-01-04" }],
    },
  ],
  tickets: [
    {
      id: "t-1",
      customerName: MALICIOUS.customer,
      email: MALICIOUS.email,
      subject: MALICIOUS.subject,
      description: MALICIOUS.cnic + " " + MALICIOUS.bank,
      status: "Open" as const,
      priority: "High" as const,
      createdAt: "2026-03-01",
      messages: [],
      internalNotes: MALICIOUS.notes,
    },
  ],
  inventory: [{ id: "inv-1", name: "SunMax Panel", category: "Panels", desc: "550W mono", stock: 40, cost: 45000 }],
  projects: [
    {
      id: "proj-1",
      leadId: "lead-2",
      customerName: MALICIOUS.customer,
      address: MALICIOUS.address,
      stage: "In Progress",
      systemSizekW: 8,
      updatedAt: "2026-03-01",
    },
  ],
  paymentTracks: {
    "lead-2": {
      leadId: "lead-2",
      totalValue: 500000,
      advanceReceived: 100000,
      pendingAmount: 400000,
      reminderSent: false,
      invoiceStatus: "Pending" as const,
      milestones: [],
    },
  },
  users: [{ ...customerUser, customerId: "c-1" }],
} as unknown as AppState;

const forbiddenNeedles = [
  MALICIOUS.phone,
  MALICIOUS.cnic,
  MALICIOUS.address,
  MALICIOUS.bank,
  MALICIOUS.notes,
  MALICIOUS.email,
  MALICIOUS.customer,
  MALICIOUS.rep,
  MALICIOUS.subject,
  "Ali Khan",
  "Fatima",
  "Private Street",
  "999999",
  "888888",
  "500000",
  "03007654321",
];

await test("customer role is not allowed global search", () => {
  assert.equal(isGlobalSearchAllowedForUser(customerUser), false);
  assert.equal(isGlobalSearchAllowedForUser(staffUser), true);
});

await test("runGlobalSearch handles null appState without throwing", () => {
  const groups = runGlobalSearch({
    appState: null,
    query: "sop",
    allowedTabIds: ["Admin Dashboard"],
    documentsEnabled: true,
  });
  assert.ok(Array.isArray(groups));
  const docs = groups.find((g) => g.category === "documents");
  assert.ok(docs && docs.results.length > 0);
});

await test("documents omitted when mock flag disabled", () => {
  const groups = runGlobalSearch({
    appState: null,
    query: "sop",
    allowedTabIds: ["Admin Dashboard"],
    documentsEnabled: false,
  });
  assert.equal(groups.length, 0);
});

await test("runGlobalSearch handles partial appState with safe labels", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "sunrise",
    allowedTabIds: ["CRM Database", "Admin Dashboard"],
    documentsEnabled: false,
  });
  const flat = groups.flatMap((g) => g.results);
  assert.ok(flat.some((r) => r.category === "leads"));
  assert.ok(flat.some((r) => r.category === "tickets"));
  assert.ok(flat.every((r) => r.title.startsWith("Lead ·") || r.title.startsWith("Support ticket ·") || r.title.startsWith("Customer ·") || r.title.startsWith("Quotation ·") || r.title.startsWith("Project ·") || r.title.startsWith("Invoice ·") || r.title.includes("Panel") || r.title === "Portal Account"));
});

const PORTAL_PII = {
  emailUsername: "fatima.secret@evil-bank.com",
  emailShapedUsername: "user.name+tag@company.co.uk",
  phone: "03001234567",
  cnic: "35202-1234567-1",
  address: "123 Private Street Gulberg Lahore",
  iban: "PK36SCBL0000001123456702",
  login: "portal-login-fatima",
  customerId: "cust-portal-secret-99",
};

function portalUserState(
  matchField: keyof typeof PORTAL_PII,
  accountStatus: "Approved" | "Pending" = "Approved"
): AppState {
  const user = {
    id: "u-portal-test",
    username: matchField === "emailUsername" || matchField === "emailShapedUsername" ? PORTAL_PII[matchField] : "safe-user",
    name: matchField === "phone" ? PORTAL_PII.phone : "Portal User",
    email: matchField === "emailUsername" ? PORTAL_PII.emailUsername : "safe@example.com",
    role: "Customer" as const,
    customerId: matchField === "customerId" ? PORTAL_PII.customerId : "internal-only-id",
    accountStatus,
    phone: matchField === "phone" ? PORTAL_PII.phone : undefined,
    cnic: matchField === "cnic" ? PORTAL_PII.cnic : undefined,
    address: matchField === "address" ? PORTAL_PII.address : undefined,
    iban: matchField === "iban" ? PORTAL_PII.iban : undefined,
    login: matchField === "login" ? PORTAL_PII.login : undefined,
  };
  return { users: [user], leads: [], tickets: [], inventory: [], projects: [] } as unknown as AppState;
}

function portalSearchBlob(matchField: keyof typeof PORTAL_PII): string {
  const query = PORTAL_PII[matchField];
  const groups = runGlobalSearch({
    appState: portalUserState(matchField),
    query,
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  const portal = groups.flatMap((g) => g.results).find((r) => r.id.startsWith("customer-user-"));
  assert.ok(portal, `expected portal hit for ${matchField}`);
  return JSON.stringify(groups);
}

const portalForbiddenNeedles = Object.values(PORTAL_PII);

await test("portal preview uses safe labels only (Portal Account / Customer Account)", () => {
  const groups = runGlobalSearch({
    appState: portalUserState("emailUsername", "Approved"),
    query: PORTAL_PII.emailUsername,
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  const portal = groups.flatMap((g) => g.results).find((r) => r.category === "customers" && r.title === "Portal Account");
  assert.ok(portal);
  assert.equal(portal?.meta, "Customer Account");
  assert.equal(portal?.subtitle, "Portal Enabled");
  assert.equal(portal?.preview.heading, "Portal Account");
  assert.deepEqual(
    portal?.preview.lines.map((l) => l.value),
    ["Customer Account", "Portal Enabled"]
  );
});

await test("portal disabled shows Portal Disabled label", () => {
  const groups = runGlobalSearch({
    appState: portalUserState("emailUsername", "Pending"),
    query: PORTAL_PII.emailUsername,
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  const portal = groups.flatMap((g) => g.results).find((r) => r.title === "Portal Account");
  assert.ok(portal);
  assert.equal(portal?.subtitle, "Portal Disabled");
  assert.ok(portal?.preview.lines.some((l) => l.label === "Status" && l.value === "Portal Disabled"));
});

await test("portal preview never renders email username in JSON", () => {
  const blob = portalSearchBlob("emailUsername");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
  assert.equal(blob.includes("Username"), false);
});

await test("portal preview never renders email-shaped username in JSON", () => {
  const blob = portalSearchBlob("emailShapedUsername");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
});

await test("portal preview never renders phone in JSON", () => {
  const blob = portalSearchBlob("phone");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
});

await test("portal preview never renders CNIC in JSON", () => {
  const blob = portalSearchBlob("cnic");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
});

await test("portal preview never renders address in JSON", () => {
  const blob = portalSearchBlob("address");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
});

await test("portal preview never renders IBAN in JSON", () => {
  const blob = portalSearchBlob("iban");
  assert.equal(assertSearchOutputSafe(blob, portalForbiddenNeedles), true);
});

await test("portal preview never renders login or portal customerId in JSON", () => {
  const loginBlob = portalSearchBlob("login");
  const idBlob = portalSearchBlob("customerId");
  assert.equal(assertSearchOutputSafe(loginBlob, portalForbiddenNeedles), true);
  assert.equal(assertSearchOutputSafe(idBlob, portalForbiddenNeedles), true);
  assert.equal(idBlob.includes(PORTAL_PII.customerId), false);
});

await test("preview lines never use sensitive field labels", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "sunrise",
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  for (const result of groups.flatMap((g) => g.results)) {
    assert.equal(assertPreviewSafe(result.preview.lines), true);
  }
});

await test("full search JSON excludes malicious CRM values", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "sunrise",
    allowedTabIds: ["CRM Database", "Admin Dashboard"],
    documentsEnabled: false,
  });
  const blob = JSON.stringify(groups);
  assert.equal(assertSearchOutputSafe(blob, forbiddenNeedles), true);
  assert.equal(blob.includes("Sunrise Villas"), false);
  assert.equal(blob.includes("Inverter alarm"), false);
});

await test("pipeline-style lead results use status labels not raw names", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "quoted",
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  const lead = groups.flatMap((g) => g.results).find((r) => r.category === "leads");
  assert.ok(lead);
  assert.equal(lead?.title, "Lead · Quoted");
  assert.equal(JSON.stringify(lead).includes(MALICIOUS.customer), false);
});

await test("revenue-style customer results anonymize salesperson", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "green",
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  const customer = groups.flatMap((g) => g.results).find((r) => r.category === "customers");
  assert.ok(customer);
  assert.equal(customer?.title, "Customer · Contracted");
  const blob = JSON.stringify(customer);
  assert.equal(blob.includes("Sara"), false);
  assert.equal(blob.includes("Green Valley"), false);
});

await test("ticket results never expose subject or customer name", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "inverter",
    allowedTabIds: ["Admin Dashboard"],
    documentsEnabled: false,
  });
  const ticket = groups.flatMap((g) => g.results).find((r) => r.category === "tickets");
  assert.ok(ticket);
  assert.equal(ticket?.title, "Support ticket · Open");
  assert.equal(JSON.stringify(ticket).includes(MALICIOUS.subject), false);
});

await test("isSensitiveFieldKey blocks finance and PII keys", () => {
  assert.equal(isSensitiveFieldKey("cnic"), true);
  assert.equal(isSensitiveFieldKey("internalNotes"), true);
  assert.equal(isSensitiveFieldKey("totalValue"), true);
  assert.equal(isSensitiveFieldKey("email"), true);
  assert.equal(isSensitiveFieldKey("status"), false);
});

await test("safeDisplayText truncates long strings", () => {
  const long = "a".repeat(200);
  assert.equal(safeDisplayText(long, 50).length, 50);
});

await test("empty query returns no result groups", () => {
  const groups = runGlobalSearch({
    appState: partialState,
    query: "   ",
    allowedTabIds: ["CRM Database"],
    documentsEnabled: false,
  });
  assert.deepEqual(groups, []);
});

const MALICIOUS_USER_NAME = "Fatima Shah CNIC 35202-1234567-1";
const MALICIOUS_QUERY = "secret@evil.com 03001234567 IBAN PK36";

await test("shell model never includes currentUser.name", () => {
  const shell = buildGlobalSearchShellModel();
  const blob = JSON.stringify(shell);
  assert.equal(shell.recentSearchesEnabled, false);
  assert.equal(blob.includes(MALICIOUS_USER_NAME), false);
  assert.equal(blob.includes("Signed in as"), false);
});

await test("no-results copy never echoes raw query text", () => {
  const shell = buildGlobalSearchShellModel();
  assert.equal(shell.noResultsMessage, "No matching results found");
  assert.equal(shell.noResultsMessage.includes(MALICIOUS_QUERY), false);
  assert.equal(shell.noResultsMessage.includes("No results for"), false);
});

await test("shell model disables recent searches for V1", () => {
  const shell = buildGlobalSearchShellModel();
  assert.equal(shell.recentSearchesEnabled, false);
});

function createMockStorage(): StorageLike & { store: Map<string, string>; writes: string[] } {
  const store = new Map<string, string>();
  const writes: string[] = [];
  return {
    store,
    writes,
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      writes.push(`${key}=${value}`);
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

await test("clearLegacyRecentSearchStorage removes legacy key", () => {
  const storage = createMockStorage();
  storage.setItem(
    GLOBAL_SEARCH_RECENT_STORAGE_KEY,
    JSON.stringify([MALICIOUS_QUERY, "another raw query"])
  );
  clearLegacyRecentSearchStorage(storage);
  assert.equal(storage.getItem(GLOBAL_SEARCH_RECENT_STORAGE_KEY), null);
});

await test("no localStorage writes of raw queries in V1", () => {
  const storage = createMockStorage();
  storage.store.set(
    GLOBAL_SEARCH_RECENT_STORAGE_KEY,
    JSON.stringify([MALICIOUS_QUERY])
  );
  storage.writes.length = 0;
  clearLegacyRecentSearchStorage(storage);
  const queryWrites = storage.writes.filter((w) => w.startsWith(GLOBAL_SEARCH_RECENT_STORAGE_KEY));
  assert.equal(queryWrites.length, 0);
  assert.equal(storage.getItem(GLOBAL_SEARCH_RECENT_STORAGE_KEY), null);
});

console.log(`\nglobalSearch tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
