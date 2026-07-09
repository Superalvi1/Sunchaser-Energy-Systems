/**
 * Safe business context tests — run: npm run test:phase-1b1
 */
import assert from "node:assert/strict";
import type { Database } from "../../dbManager.ts";
import type { RequestActor } from "../middleware/actor.ts";
import { ChatBusinessContextProvider } from "./ChatBusinessContextProvider.ts";
import {
  SAFE_BUSINESS_CONTEXT_MAX_CHARS,
  boundSafeBusinessContextJson,
  buildSafeBusinessContext,
  canActorAccessFinanceSummary,
  containsSensitiveBusinessFields,
  normalizeLeadStatusBucket,
  normalizeProjectStageBucket,
} from "./SafeBusinessContext.ts";
import { isChatV1ToolsDisabled, createChatV1Engine } from "../chatV1.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
const savedSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let passCount = 0;

function pass(name: string): void {
  passCount += 1;
  console.log(`PASS: ${name}`);
}

const baseActor = (overrides: Partial<RequestActor>): RequestActor => ({
  id: "u-1",
  username: "user1",
  name: "User One",
  email: "user1@test.com",
  role: "Sales Executive",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
  ...overrides,
});

const salesActorA = baseActor({
  id: "u-sales-1",
  username: "sarah",
  name: "Sarah Connor",
  role: "Sales Executive",
});

const salesActorB = baseActor({
  id: "u-sales-2",
  username: "michael",
  name: "Michael Scott",
  role: "Sales Executive",
});

const customerActor = baseActor({
  id: "u-customer-1",
  username: "portaluser",
  role: "Customer",
  customerId: "cust-1",
});

const technicianActor = baseActor({
  id: "u-tech-1",
  username: "tariq",
  name: "Tariq Technician",
  role: "Technician",
});

const accountsActor = baseActor({
  id: "u-accounts-1",
  username: "amir",
  name: "Amir Accounts",
  role: "Accounts Manager",
});

const adminActor = baseActor({
  id: "u-admin-1",
  username: "admin",
  name: "Alice Admin",
  role: "Admin",
});

const directorActor = baseActor({
  id: "u-director-1",
  username: "director",
  name: "Dana Director",
  role: "Director",
});

const mockDb = {
  leads: [
    {
      id: "lead-1",
      customerId: "cust-1",
      status: "New",
      assigned_sales_user_id: "u-sales-1",
      phone: "0300-1111111",
      address: "Secret St 1",
      quotes: [{ id: "q-1" }, { id: "q-2" }],
      installation: {
        tasks: [
          { dueDate: new Date().toISOString().slice(0, 10), title: "Today task" },
          {
            dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            title: "Tomorrow task",
          },
        ],
      },
    },
    {
      id: "lead-2",
      customerId: "cust-2",
      status: "Contracted",
      assigned_sales_user_id: "u-sales-2",
      phone: "0300-2222222",
      quotes: [{ id: "q-3" }],
    },
    {
      id: "lead-3",
      customerId: "cust-1",
      status: "Lost",
      assigned_sales_user_id: "u-sales-2",
    },
  ],
  projects: [
    { id: "proj-1", leadId: "lead-1", customerId: "cust-1", stage: "Installation" },
    { id: "proj-2", leadId: "lead-2", customerId: "cust-2", stage: "Survey" },
  ],
  quotations: [{ id: "q-standalone", leadId: "lead-2", customerId: "cust-2" }],
  tickets: [
    {
      id: "t-1",
      customerId: "cust-1",
      status: "Open",
      assigned_user_id: "u-tech-1",
      customer_phone: "0300-999",
    },
    {
      id: "t-2",
      customerId: "cust-2",
      status: "Resolved",
      assigned_user_id: "u-tech-2",
    },
  ],
  serviceRequests: [
    { id: "sr-1", customerId: "cust-1", status: "Assigned", assigned_user_id: "u-tech-1" },
    { id: "sr-2", customerId: "cust-2", status: "Closed", assigned_user_id: "u-tech-2" },
  ],
  projectDeliveries: [
    { id: "d-1", leadId: "lead-1", status: "Pending", assigned_user_id: "u-tech-1" },
    { id: "d-2", leadId: "lead-2", status: "Delivered", assigned_user_id: "u-tech-2" },
  ],
  invoices: [
    {
      id: "inv-1",
      customer_id: "cust-1",
      customer_name: "Alpha Corp",
      customer_phone: "0300-111",
      grand_total: 1000,
      payment_status: "Unpaid",
      due_date: "2020-01-01",
      created_by_user_id: "u-accounts-1",
    },
    {
      id: "inv-2",
      customer_id: "cust-2",
      customer_name: "Beta Ltd",
      grand_total: 500,
      payment_status: "Paid",
      created_by_user_id: "u-accounts-2",
    },
    {
      id: "inv-sales",
      customer_name: "Sales Co",
      grand_total: 200,
      payment_status: "Overdue",
      created_by_user_id: "u-sales-1",
    },
  ],
  inventoryFoundationItems: [
    { id: "i-1", availableQty: 2, lowStockThreshold: 5 },
    { id: "i-2", availableQty: 20, lowStockThreshold: 5 },
  ],
} as unknown as Database;

const MALICIOUS_STATUS = "0300-1111111 Secret Address Lane 42";
const MALICIOUS_STAGE = "12345-1234567-1 PK36SCBL0000001123456702 private note";
const MALICIOUS_NEEDLES = [
  "0300-1111111",
  "Secret Address",
  "12345-1234567-1",
  "PK36SCBL0000001123456702",
  "private note",
];

function assertJsonExcludesNeedles(json: string, needles: string[]): void {
  for (const needle of needles) {
    assert.equal(json.includes(needle), false, `JSON must not contain: ${needle}`);
  }
}

async function runTests(): Promise<void> {
  try {
    assert.equal(await buildSafeBusinessContext(salesActorA, mockDb, false), null);
    pass("includeBusinessContext false returns null");

    const salesSummary = await buildSafeBusinessContext(salesActorA, mockDb, true);
    assert.ok(salesSummary);
    assert.equal(salesSummary!.scope, "sales");
    assert.equal(salesSummary!.leads?.total, 1);
    assert.equal(salesSummary!.projects?.total, 1);
    assert.equal(salesSummary!.quotations?.total, 2);
    assert.equal(salesSummary!.leads?.byStatus?.new, 1);
    assert.ok(!salesSummary!.leads?.byStatus?.contracted);
    pass("sales actor sees only owned lead/project/quotation counts");

    const otherSales = await buildSafeBusinessContext(salesActorB, mockDb, true);
    assert.equal(otherSales!.leads?.total, 2);
    assert.equal(otherSales!.projects?.total, 1);
    pass("second sales actor sees different owned counts");

    const customerSummary = await buildSafeBusinessContext(customerActor, mockDb, true);
    assert.equal(customerSummary!.scope, "customer");
    assert.equal(customerSummary!.leads?.total, 2);
    assert.equal(customerSummary!.projects?.total, 1);
    assert.equal(customerSummary!.tickets?.total, 1);
    assert.equal(customerSummary!.invoices, undefined);
    pass("customer actor sees only own-safe summary without finance");

    const techSummary = await buildSafeBusinessContext(technicianActor, mockDb, true);
    assert.equal(techSummary!.scope, "technician");
    assert.equal(techSummary!.assignedJobs?.serviceRequests, 1);
    assert.equal(techSummary!.assignedJobs?.supportTickets, 1);
    assert.equal(techSummary!.assignedJobs?.deliveries, 1);
    assert.equal(techSummary!.invoices, undefined);
    pass("technician actor sees only assigned-job summary");

    assert.equal(canActorAccessFinanceSummary(technicianActor), false);
    assert.equal(canActorAccessFinanceSummary(customerActor), false);
    assert.equal(canActorAccessFinanceSummary(accountsActor), true);

    const techWithFlag = await buildSafeBusinessContext(technicianActor, mockDb, true);
    assert.equal(techWithFlag!.invoices, undefined);
    pass("finance summary hidden from technician");

    const salesFinance = await buildSafeBusinessContext(salesActorA, mockDb, true);
    assert.ok(salesFinance!.invoices);
    assert.equal(salesFinance!.invoices!.totalCount, 1);
    assert.equal(salesFinance!.invoices!.totalAmount, 200);
    pass("sales actor with invoice access sees owned invoice totals only");

    const accountsSummary = await buildSafeBusinessContext(accountsActor, mockDb, true);
    assert.ok(accountsSummary!.invoices);
    assert.equal(accountsSummary!.invoices!.totalCount, 1);
    assert.equal(accountsSummary!.invoices!.overdueCount, 1);
    pass("accounts actor sees finance totals for owned invoices");

    const adminSummary = await buildSafeBusinessContext(adminActor, mockDb, true);
    assert.equal(adminSummary!.scope, "admin");
    assert.equal(adminSummary!.leads?.total, 3);
    assert.ok(adminSummary!.inventory);
    pass("admin receives broader operational summaries");

    const directorSummary = await buildSafeBusinessContext(directorActor, mockDb, true);
    assert.ok(directorSummary!.invoices);
    assert.equal(directorSummary!.invoices!.totalCount, 3);
    pass("director receives full finance invoice totals");

    const json = boundSafeBusinessContextJson(directorSummary!);
    assert.ok(json.length <= SAFE_BUSINESS_CONTEXT_MAX_CHARS);
    assert.equal(containsSensitiveBusinessFields(JSON.parse(json)), false);
    assert.doesNotMatch(json, /0300-/);
    assert.doesNotMatch(json, /Secret St/);
    assert.doesNotMatch(json, /Alpha Corp/);
    pass("no sensitive fields and context JSON is bounded");

    const provider = new ChatBusinessContextProvider({
      requestActor: salesActorA,
      db: mockDb,
      includeBusinessContext: false,
    });
    const ctxOff = await provider.load({
      actor: { userId: salesActorA.id, role: salesActorA.role, permissions: [] },
      agentId: "sales",
      conversationId: "conv-1",
    });
    assert.equal(ctxOff.blocks.length, 1);
    assert.equal(ctxOff.facts.businessContextIncluded, undefined);
    pass("provider with flag false sends no business context block");

    const providerOn = new ChatBusinessContextProvider({
      requestActor: salesActorA,
      db: mockDb,
      includeBusinessContext: true,
    });
    const ctxOn = await providerOn.load({
      actor: { userId: salesActorA.id, role: salesActorA.role, permissions: [] },
      agentId: "sales",
      conversationId: "conv-1",
    });
    assert.equal(ctxOn.blocks.length, 2);
    assert.equal(ctxOn.facts.businessContextIncluded, true);
    assert.equal(ctxOn.blocks[1]!.key, "business-insights");
    assert.match(ctxOn.blocks[1]!.content, /Use only the permitted business summary/i);
    pass("provider with flag true attaches business insights block");

    process.env.GEMINI_API_KEY = "gemini-test";
    const bundle = createChatV1Engine();
    assert.ok(isChatV1ToolsDisabled(bundle));
    delete process.env.GEMINI_API_KEY;
    pass("tools still disabled in chat engine wiring");

    assert.equal(normalizeLeadStatusBucket("New"), "new");
    assert.equal(normalizeLeadStatusBucket("Contracted"), "contracted");
    assert.equal(normalizeLeadStatusBucket(MALICIOUS_STATUS), "other");
    assert.equal(normalizeProjectStageBucket("Installation"), "installation");
    assert.equal(normalizeProjectStageBucket(MALICIOUS_STAGE), "other");
    pass("known statuses map to safe buckets; untrusted values become other");

    const maliciousDb = {
      ...mockDb,
      leads: [
        {
          id: "lead-evil",
          customerId: "cust-1",
          status: MALICIOUS_STATUS,
          assigned_sales_user_id: "u-sales-1",
          phone: "0300-1111111",
          address: "Secret Address",
          notes: "private note",
        },
        {
          id: "lead-cnic",
          customerId: "cust-1",
          status: "12345-1234567-1",
          assigned_sales_user_id: "u-sales-1",
        },
      ],
      projects: [
        {
          id: "proj-evil",
          leadId: "lead-evil",
          customerId: "cust-1",
          stage: MALICIOUS_STAGE,
        },
      ],
      tickets: [
        {
          id: "t-evil",
          customerId: "cust-1",
          status: "PK36SCBL0000001123456702 bank transfer",
          assigned_user_id: "u-tech-1",
        },
      ],
      serviceRequests: [
        {
          id: "sr-evil",
          customerId: "cust-1",
          status: "private note urgent",
          assigned_user_id: "u-tech-1",
        },
      ],
      projectDeliveries: [
        {
          id: "d-evil",
          leadId: "lead-evil",
          status: "0300-9999999 delivery address",
          assigned_user_id: "u-tech-1",
        },
      ],
    } as unknown as Database;

    const maliciousSales = await buildSafeBusinessContext(salesActorA, maliciousDb, true);
    const maliciousJson = boundSafeBusinessContextJson(maliciousSales!);
    assert.equal(maliciousSales!.leads?.byStatus?.other, 2);
    assert.equal(maliciousSales!.projects?.byStage?.other, 1);
    assert.ok(maliciousJson.length <= SAFE_BUSINESS_CONTEXT_MAX_CHARS);
    assertJsonExcludesNeedles(maliciousJson, MALICIOUS_NEEDLES);
    assertJsonExcludesNeedles(maliciousJson, ["PK36SCBL", "bank transfer", "delivery address"]);
    pass("malicious status/stage strings never appear in bounded AI context JSON");

    const maliciousTech = await buildSafeBusinessContext(technicianActor, maliciousDb, true);
    const techJson = boundSafeBusinessContextJson(maliciousTech!);
    assertJsonExcludesNeedles(techJson, MALICIOUS_NEEDLES);
    pass("technician summary JSON excludes malicious strings");

    console.log(`safeBusinessContext.test.ts: ${passCount} checks passed`);
  } finally {
    if (savedSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedSupabaseUrl;
    if (savedSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedSupabaseKey;
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
