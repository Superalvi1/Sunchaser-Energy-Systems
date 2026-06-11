#!/usr/bin/env node
/**
 * Phase 23 verification — auto internal costing sheet from contracted project.
 */
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const { register } = await import("tsx/esm/api");
  register();

  const { provisionContractToInvoiceWorkflow } = await import("../contractToInvoiceDb.ts");
  const costing = await import("../internalCostingDb.ts");
  const invoiceDb = await import("../invoiceDb.ts");

  const ACTOR = { userId: "u-super", username: "allauddin", role: "Super Admin" };
  const quoteId = "q-test-arsalan";
  const leadId = "lead-test-arsalan";

  const localDb = {
    users: [{ id: ACTOR.userId, username: "allauddin", role: "Super Admin", name: "Allauddin" }],
    customers: [],
    leads: [],
    projects: [],
    invoices: [],
    invoiceItems: [],
    invoicePayments: [],
    paymentTracks: {},
    internalCostingSheets: [],
    investors: [],
    inventoryPurchases: [],
  };

  const lead = {
    id: leadId,
    name: "Arsalan",
    email: "arsalan@test.com",
    phone: "03001234567",
    address: "Lahore",
    status: "Contracted",
    quotes: [
      {
        id: quoteId,
        status: "Pending",
        totalCost: 316050,
        systemSizekW: 10,
        boqRows: [
          { id: "h-1", type: "heading", name: "Solar Panels" },
          {
            id: "panel-1",
            type: "item",
            name: "Longi X10 panels",
            qty: 10,
            rate: 31605,
            total: 316050,
          },
        ],
      },
    ],
  };
  localDb.leads.push(lead);

  console.log("\n1-2) Mark Contracted → run contract workflow");
  const provision1 = await provisionContractToInvoiceWorkflow(lead, localDb, {
    quotationId: quoteId,
    actor: ACTOR,
  });
  check("customer created", !!provision1.customerId);
  check("project created", !!provision1.projectId);
  check("invoice created", !!provision1.invoiceId);
  check("payment track ensured", provision1.paymentTrackEnsured === true);
  check("costing sheet auto-created", !!provision1.costingSheetId);
  check("costing sheet is new", provision1.costingSheetExisting === false);

  console.log("\n3-8) Verify costing sheet BOQ import");
  const { sheet } = await costing.getAdminCostingSheet(
    ACTOR.userId,
    ACTOR.username,
    provision1.costingSheetId,
    localDb
  );
  check("sheet title", sheet.title === "Internal Costing — Arsalan", `got "${sheet.title}"`);
  check("linked lead", sheet.leadId === leadId);
  check("linked project", sheet.projectId === provision1.projectId);
  check("linked quotation", sheet.quotationId === quoteId);
  check("linked invoice", sheet.invoiceId === provision1.invoiceId);
  check("autoCreated flag", sheet.autoCreated === true);
  check("BOQ item imported", sheet.items.length === 1, `got ${sheet.items.length}`);
  const row = sheet.items[0];
  check("item name from BOQ", row.itemName.includes("Longi"), row.itemName);
  check("sale qty 10", row.saleQty === 10);
  check("sale rate 31605", row.saleRate === 31605);
  check("purchase fields blank", row.purchaseRate === 0 && !row.supplierName);
  check("quotation value 316050", sheet.totals.quotationValue === 316050);

  console.log("\n9-10) Enter supplier costs → profit auto-calculates");
  const { sheet: updated } = await costing.updateAdminCostingSheet(
    ACTOR.userId,
    ACTOR.username,
    sheet.id,
    {
      items: [
        {
          ...row,
          supplierName: "Solar Market Lahore",
          purchaseRate: 29500,
          purchaseQty: 10,
          paidToSupplier: true,
        },
      ],
    },
    localDb
  );
  const urow = updated.items[0];
  check("purchase cost 295000", urow.totalPurchaseCost === 295000);
  check("gross profit 21050", updated.totals.grossProfit === 21050, `got ${updated.totals.grossProfit}`);

  console.log("\n11-12) Invoice payment syncs Amount Received");
  await invoiceDb.recordInvoicePayment(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    provision1.invoiceId,
    { amount: 150000, paymentMethod: "Bank Transfer" },
    localDb
  );
  const { sheet: afterPay } = await costing.getAdminCostingSheet(
    ACTOR.userId,
    ACTOR.username,
    sheet.id,
    localDb
  );
  check("amount received updated to 150000", afterPay.amountReceived === 150000, `got ${afterPay.amountReceived}`);
  check("net cash reflects payment", afterPay.totals.netCashRemaining === -145000, `got ${afterPay.totals.netCashRemaining}`);

  console.log("\n13) Second contract workflow does not duplicate sheet");
  const provision2 = await provisionContractToInvoiceWorkflow(lead, localDb, {
    quotationId: quoteId,
    actor: ACTOR,
  });
  check("same costing sheet id", provision2.costingSheetId === provision1.costingSheetId);
  check("marked existing", provision2.costingSheetExisting === true);
  check("only one sheet in db", localDb.internalCostingSheets.length === 1);

  console.log("\nPART 7) Profitability summary endpoint");
  const { summary } = await costing.fetchProjectProfitabilitySummary(
    ACTOR.userId,
    ACTOR.username,
    localDb
  );
  check("summary has revenue", summary.totalRevenue === 316050);
  check("summary has cost after edit", summary.totalCost === 295000);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
