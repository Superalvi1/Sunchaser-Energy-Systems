#!/usr/bin/env node
/**
 * Phase 22 verification — Internal Costing Sheet + Investor Inventory Ledger.
 * Runs the full PART 7 test plan against the DB module in local (file db) mode.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Force local mode — never touch Supabase in this verification.
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

  const costing = await import("../internalCostingDb.ts");
  const inventory = await import("../inventoryFoundationDb.ts");
  const { StaffPortalAuthError } = await import("../dbManager.ts");

  const SUPER = { id: "u-super", username: "allauddin" };
  const SALES = { id: "u-sales", username: "salesguy" };

  const localDb = {
    users: [
      { id: SUPER.id, username: "allauddin", role: "Super Admin", name: "Allauddin" },
      { id: SALES.id, username: "salesguy", role: "Sales Executive", name: "Sales Guy" },
    ],
    inventoryFoundationItems: [],
    inventoryFoundationMovements: [],
    projectInventoryReservations: [],
    internalCostingSheets: [],
    investors: [],
    inventoryPurchases: [],
  };

  console.log("\n1) Add investor Raza Niazi with Rs. 930,000");
  const { investor } = await costing.createAdminInvestor(SUPER.id, SUPER.username, {
    name: "Barrister Raza Khan Niazi",
    amountReceived: 930000,
    dateReceived: "2026-06-01",
    purpose: "Inverter stock funding",
  }, localDb);
  check("investor created", investor.name.includes("Raza"));
  check("investor balance starts at 930,000", investor.remainingBalance === 930000);

  console.log("\n2) Buy inverter stock using that investment");
  const invItem = await inventory.createAdminInventoryFoundationItem(
    SUPER.id,
    SUPER.username,
    { category: "Inverter", brand: "Knox", model: "6kW", sku: "KNOX-6KW", costPrice: 85000, initialStock: 0 },
    localDb
  );
  check("inventory item created with 0 stock", invItem.stockQty === 0);

  const { purchase, inventoryItem } = await costing.createAdminInventoryPurchase(
    SUPER.id,
    SUPER.username,
    {
      supplierName: "Knox supplier",
      productName: "Knox 6kW inverter",
      quantity: 10,
      purchaseRate: 85000,
      investorId: investor.id,
      inventoryItemId: invItem.id,
      paymentMethod: "Bank Transfer",
      paymentStatus: "Paid",
    },
    localDb
  );
  check("purchase recorded for Rs. 850,000", purchase.totalCost === 850000);

  console.log("\n3) Inventory stock increases");
  check("stock increased to 10", inventoryItem && inventoryItem.stockQty === 10,
    `got ${inventoryItem?.stockQty}`);
  const movements = localDb.inventoryFoundationMovements.filter(
    (m) => (m.inventory_item_id || m.inventoryItemId) === invItem.id
  );
  check("stock_in movement logged", movements.some((m) => (m.movement_type || m.movementType) === "stock_in"));

  console.log("\n4) Investor balance decreases");
  const { investors } = await costing.listAdminInvestors(SUPER.id, SUPER.username, localDb);
  const raza = investors.find((i) => i.id === investor.id);
  check("remaining balance is Rs. 80,000", raza.remainingBalance === 80000, `got ${raza.remainingBalance}`);

  console.log("   (extra) Over-budget purchase is rejected");
  let overBudgetBlocked = false;
  try {
    await costing.createAdminInventoryPurchase(SUPER.id, SUPER.username, {
      supplierName: "Knox supplier",
      productName: "More inverters",
      quantity: 2,
      purchaseRate: 85000,
      investorId: investor.id,
    }, localDb);
  } catch (err) {
    overBudgetBlocked = /exceeds/i.test(err.message);
  }
  check("purchase above remaining balance blocked", overBudgetBlocked);

  console.log("\n5-8) Create client costing sheet, profit auto-calculates");
  const { sheet } = await costing.createAdminCostingSheet(SUPER.id, SUPER.username, {
    clientName: "Arsalan",
    quotationValue: 316050,
    amountReceived: 150000,
    items: [
      {
        itemName: "Longi X10 panels",
        supplierName: "Solar Market Lahore",
        purchaseRate: 29500,
        purchaseQty: 10,
        saleRate: 31605,
        saleQty: 10,
        paidToSupplier: true,
        supplierPaymentDate: "2026-06-05",
      },
    ],
  }, localDb);
  const item = sheet.items[0];
  check("purchase cost 295,000", item.totalPurchaseCost === 295000);
  check("sale value 316,050", item.totalSaleValue === 316050);
  check("item profit auto-calculated 21,050", item.profit === 21050, `got ${item.profit}`);
  check("item profit % ≈ 7.14", Math.abs(item.profitPercent - 7.14) < 0.01, `got ${item.profitPercent}`);
  check("sheet gross profit 21,050", sheet.totals.grossProfit === 21050);
  check("amount paid to suppliers 295,000", sheet.totals.amountPaidToSuppliers === 295000);
  check("net cash remaining -145,000", sheet.totals.netCashRemaining === -145000);

  console.log("   (extra) Stock consume link reduces inventory");
  const { sheet: updated } = await costing.updateAdminCostingSheet(SUPER.id, SUPER.username, sheet.id, {
    items: [
      ...sheet.items,
      {
        itemName: "Knox 6kW inverter",
        supplierName: "Knox supplier",
        purchaseRate: 85000,
        purchaseQty: 2,
        saleRate: 95000,
        saleQty: 2,
        inventoryItemId: invItem.id,
        consumeStock: true,
      },
    ],
  }, localDb);
  const consumedItem = updated.items.find((it) => it.inventoryItemId === invItem.id);
  check("costing item marked stockConsumed", consumedItem && consumedItem.stockConsumed === true);
  const itemRow = localDb.inventoryFoundationItems.find((r) => r.id === invItem.id);
  const stockNow = Number(itemRow.stock_qty ?? itemRow.stockQty);
  check("inventory stock reduced 10 → 8", stockNow === 8, `got ${stockNow}`);

  console.log("\n9) Customer portal does not expose costing");
  const serverSrc = readFileSync(resolve(__dir, "../server.ts"), "utf8");
  const costingRoutes = serverSrc.match(/app\.(get|post|patch|delete)\(\s*\n?\s*"([^"]*costing[^"]*)"/g) || [];
  const nonAdmin = costingRoutes.filter((r) => !r.includes("/api/admin/costing/"));
  check("all costing routes live under /api/admin/", costingRoutes.length > 0 && nonAdmin.length === 0);
  const stateBlock = serverSrc.includes("internalCostingSheets:") || serverSrc.includes("inventoryPurchases:");
  check("costing data not embedded in /api/state payload", !stateBlock);

  console.log("\n10) Normal sales user cannot see internal costing");
  const expectBlocked = async (label, fn) => {
    try {
      await fn();
      check(label, false, "was allowed");
    } catch (err) {
      check(label, err instanceof StaffPortalAuthError, err.message);
    }
  };
  await expectBlocked("sales user blocked from costing sheets", () =>
    costing.listAdminCostingSheets(SALES.id, SALES.username, localDb));
  await expectBlocked("sales user blocked from investors", () =>
    costing.listAdminInvestors(SALES.id, SALES.username, localDb));
  await expectBlocked("sales user blocked from purchases", () =>
    costing.listAdminInventoryPurchases(SALES.id, SALES.username, localDb));
  await expectBlocked("sales user blocked from reports", () =>
    costing.fetchAdminCostingReports(SALES.id, SALES.username, localDb));
  await expectBlocked("sales user cannot create investor", () =>
    costing.createAdminInvestor(SALES.id, SALES.username, { name: "X", amountReceived: 1 }, localDb));

  console.log("\nReports endpoint (PART 6)");
  const reports = await costing.fetchAdminCostingReports(SUPER.id, SUPER.username, localDb);
  check("profit by client present", reports.profitByClient.length === 1);
  check("investor balances present", reports.investorBalances.length === 1);
  check("purchase history present", reports.purchaseHistory.length === 1);
  check("stock value computed", reports.stockValue.total === 8 * 85000, `got ${reports.stockValue.total}`);
  check("gross margin computed", reports.grossMargin.sheetCount === 1);
  check("supplier payable empty (all paid/consumed unpaid?) computed",
    Array.isArray(reports.supplierPayable));

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
