import {
  isSupabaseActive,
  getSupabase,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import {
  canViewInternalCosting,
  boqRowsToCostingItems,
  buildAutoCostingTitle,
  computeCostingItem,
  computeCostingTotals,
  computeInvestorBalance,
  computeProjectProfitabilitySummary,
  computePurchaseTotal,
  quotationBoqRows,
  moneyRound,
  PURCHASE_PAYMENT_STATUSES,
  type InternalCostingItem,
  type InternalCostingSheet,
  type InvestorRecord,
  type InventoryPurchaseRecord,
  type PurchasePaymentStatus,
} from "./src/lib/internalCosting.ts";
import {
  stockInAdminInventoryItem,
  stockOutAdminInventoryItem,
  reserveAdminInventoryForProject,
} from "./inventoryFoundationDb.ts";

export class InternalCostingDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "InternalCostingDbError";
    this.statusCode = statusCode;
  }
}

const SHEETS_TABLE = "internal_costing_sheets";
const INVESTORS_TABLE = "investors";
const PURCHASES_TABLE = "inventory_purchases";

function isCostingTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "42P01" ||
    msg.includes(SHEETS_TABLE) ||
    msg.includes(INVESTORS_TABLE) ||
    msg.includes(PURCHASES_TABLE)
  );
}

const TABLES_NOT_READY =
  "Internal costing tables are not ready. Run scripts/internal-costing-investor-schema.sql on Supabase.";

async function assertInternalCostingAdmin(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { user, role } = await verifyStaffPortalUser(userId, username, localDb);
  if (!canViewInternalCosting(user.username || username, role)) {
    throw new StaffPortalAuthError("Internal costing is restricted to Super Admin.");
  }
  return { user, role };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function parseItems(raw: unknown): InternalCostingItem[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((it) => computeCostingItem(it as Partial<InternalCostingItem>));
}

function mapSheetRow(row: any): InternalCostingSheet {
  const items = parseItems(row.items);
  const totals = computeCostingTotals({
    quotationValue: row.quotation_value ?? row.quotationValue,
    amountReceived: row.amount_received ?? row.amountReceived,
    items,
  });
  const clientName = row.client_name || row.clientName || "";
  return {
    id: row.id,
    title: row.title || buildAutoCostingTitle(clientName),
    clientName,
    leadId: row.lead_id ?? row.leadId ?? null,
    customerId: row.customer_id ?? row.customerId ?? null,
    projectId: row.project_id ?? row.projectId ?? null,
    quotationId: row.quotation_id ?? row.quotationId ?? null,
    invoiceId: row.invoice_id ?? row.invoiceId ?? null,
    quotationValue: totals.quotationValue,
    amountReceived: totals.amountReceived,
    items,
    totals,
    notes: row.notes || "",
    autoCreated: !!(row.auto_created ?? row.autoCreated),
    consumeInventory: !!(row.consume_inventory ?? row.consumeInventory),
    stockReserved: !!(row.stock_reserved ?? row.stockReserved),
    reservedStockValue: Number(row.reserved_stock_value ?? row.reservedStockValue ?? 0),
    consumedStockValue: Number(row.consumed_stock_value ?? row.consumedStockValue ?? 0),
    createdBy: row.created_by ?? row.createdBy ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapInvestorRow(row: any): InvestorRecord {
  return {
    id: row.id,
    name: row.name || "",
    amountReceived: Number(row.amount_received ?? row.amountReceived ?? 0),
    dateReceived: row.date_received ?? row.dateReceived ?? null,
    purpose: row.purpose || "",
    notes: row.notes || "",
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapPurchaseRow(row: any): InventoryPurchaseRecord {
  return {
    id: row.id,
    supplierName: row.supplier_name || row.supplierName || "",
    productName: row.product_name || row.productName || "",
    inventoryItemId: row.inventory_item_id ?? row.inventoryItemId ?? null,
    quantity: Number(row.quantity ?? 0),
    purchaseRate: Number(row.purchase_rate ?? row.purchaseRate ?? 0),
    totalCost: Number(row.total_cost ?? row.totalCost ?? 0),
    investorId: row.investor_id ?? row.investorId ?? null,
    paymentMethod: row.payment_method || row.paymentMethod || "",
    paymentStatus: (row.payment_status ||
      row.paymentStatus ||
      "Unpaid") as PurchasePaymentStatus,
    billUrl: row.bill_url ?? row.billUrl ?? null,
    notes: row.notes || "",
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at || row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Generic loaders (Supabase or local database.json)
// ---------------------------------------------------------------------------

type LocalKey = "internalCostingSheets" | "investors" | "inventoryPurchases";

async function loadRows(table: string, localKey: LocalKey, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      if (isCostingTableMissing(error)) throw new InternalCostingDbError(TABLES_NOT_READY, 503);
      throw error;
    }
    return data || [];
  }
  if (!localDb) throw new InternalCostingDbError("Database unavailable.", 500);
  return ((localDb as any)[localKey] || []) as any[];
}

async function insertRow(table: string, localKey: LocalKey, row: any, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from(table).insert(row).select("*").single();
    if (error) {
      if (isCostingTableMissing(error)) throw new InternalCostingDbError(TABLES_NOT_READY, 503);
      throw error;
    }
    return data;
  }
  if (!localDb) throw new InternalCostingDbError("Database unavailable.", 500);
  const db = localDb as any;
  if (!db[localKey]) db[localKey] = [];
  db[localKey].push(row);
  return row;
}

async function updateRow(
  table: string,
  localKey: LocalKey,
  id: string,
  patch: any,
  localDb?: Database
) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      if (isCostingTableMissing(error)) throw new InternalCostingDbError(TABLES_NOT_READY, 503);
      throw new InternalCostingDbError("Record not found.", 404);
    }
    return data;
  }
  if (!localDb) throw new InternalCostingDbError("Database unavailable.", 500);
  const db = localDb as any;
  const list = db[localKey] || [];
  const idx = list.findIndex((r: any) => r.id === id);
  if (idx < 0) throw new InternalCostingDbError("Record not found.", 404);
  list[idx] = { ...list[idx], ...patch };
  return list[idx];
}

async function deleteRow(table: string, localKey: LocalKey, id: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      if (isCostingTableMissing(error)) throw new InternalCostingDbError(TABLES_NOT_READY, 503);
      throw error;
    }
    return;
  }
  if (!localDb) throw new InternalCostingDbError("Database unavailable.", 500);
  const db = localDb as any;
  db[localKey] = (db[localKey] || []).filter((r: any) => r.id !== id);
}

// ---------------------------------------------------------------------------
// PART 1 — Internal Costing Sheets
// ---------------------------------------------------------------------------

function buildSheetDbRow(
  body: Record<string, unknown>,
  items: InternalCostingItem[],
  userId: string,
  id: string,
  isCreate: boolean
) {
  const totals = computeCostingTotals({
    quotationValue: body.quotationValue ?? body.quotation_value,
    amountReceived: body.amountReceived ?? body.amount_received,
    items,
  });
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    title: String(body.title ?? body.sheetTitle ?? buildAutoCostingTitle(String(body.clientName ?? body.client_name ?? ""))),
    client_name: String(body.clientName ?? body.client_name ?? "").trim(),
    lead_id: body.leadId ?? body.lead_id ?? null,
    customer_id: body.customerId ?? body.customer_id ?? null,
    project_id: body.projectId ?? body.project_id ?? null,
    quotation_id: body.quotationId ?? body.quotation_id ?? null,
    invoice_id: body.invoiceId ?? body.invoice_id ?? null,
    quotation_value: totals.quotationValue,
    amount_received: totals.amountReceived,
    items: items.map((it) => {
      const { consumeStock, ...rest } = it;
      return rest;
    }),
    total_purchase_cost: totals.totalPurchaseCost,
    total_sale_value: totals.totalSaleValue,
    gross_profit: totals.grossProfit,
    profit_percent: totals.profitPercent,
    amount_paid_to_suppliers: totals.amountPaidToSuppliers,
    net_cash_remaining: totals.netCashRemaining,
    notes: body.notes != null ? String(body.notes) : "",
    auto_created: body.autoCreated ?? body.auto_created ?? false,
    consume_inventory: body.consumeInventory ?? body.consume_inventory ?? false,
    stock_reserved: body.stockReserved ?? body.stock_reserved ?? false,
    reserved_stock_value: body.reservedStockValue ?? body.reserved_stock_value ?? 0,
    consumed_stock_value: body.consumedStockValue ?? body.consumed_stock_value ?? 0,
    updated_by: userId,
    updated_at: now,
  };
  if (isCreate) {
    row.created_by = userId;
    row.created_at = now;
  }
  return row;
}

/**
 * PART 4 — Profitability link: consume hardware stock for costing items that
 * request it (consumeStock=true, linked to an inventory item, not yet consumed).
 */
async function applyStockConsumption(
  userId: string,
  username: string,
  sheetId: string,
  items: InternalCostingItem[],
  previousItems: InternalCostingItem[],
  localDb?: Database
) {
  const previousById = new Map(previousItems.map((it) => [it.id, it]));
  for (const item of items) {
    const prev = previousById.get(item.id);
    const alreadyConsumed = item.stockConsumed || prev?.stockConsumed;
    if (alreadyConsumed) {
      item.stockConsumed = true;
      item.consumeStock = false;
      continue;
    }
    if (!item.consumeStock || !item.inventoryItemId || item.purchaseQty <= 0) {
      item.consumeStock = false;
      continue;
    }
    try {
      await stockOutAdminInventoryItem(
        userId,
        username,
        item.inventoryItemId,
        {
          qty: item.purchaseQty,
          referenceType: "internal_costing",
          referenceId: sheetId,
          notes: `Internal costing: ${item.itemName || "item"}`,
        },
        localDb
      );
    } catch (err: any) {
      throw new InternalCostingDbError(
        `Stock consume failed for "${item.itemName || item.inventoryItemId}": ${err?.message || err}`
      );
    }
    item.stockConsumed = true;
    item.consumeStock = false;
  }
  return items;
}

async function loadCostingSheetRows(localDb?: Database) {
  try {
    return await loadRows(SHEETS_TABLE, "internalCostingSheets", localDb);
  } catch (err: any) {
    if (err instanceof InternalCostingDbError && err.statusCode === 503) return null;
    throw err;
  }
}

function findExistingCostingSheet(
  rows: any[],
  keys: { projectId?: string | null; leadId?: string | null; quotationId?: string | null }
) {
  const { projectId, leadId, quotationId } = keys;
  if (projectId) {
    const hit = rows.find(
      (r) => (r.project_id || r.projectId) === projectId
    );
    if (hit) return hit;
  }
  if (leadId) {
    const hit = rows.find((r) => (r.lead_id || r.leadId) === leadId);
    if (hit) return hit;
  }
  if (quotationId) {
    const hit = rows.find((r) => (r.quotation_id || r.quotationId) === quotationId);
    if (hit) return hit;
  }
  return null;
}

export type CostingProvisionResult = {
  sheetId: string | null;
  existing: boolean;
  skipped?: string;
};

/**
 * Phase 23 — Auto-create internal costing sheet when a lead becomes Contracted.
 * Idempotent: returns existing sheet if one is already linked to the project/lead/quote.
 */
export async function provisionInternalCostingSheet(
  input: {
    lead: any;
    quote: any;
    customerId: string;
    projectId: string;
    invoiceId: string | null;
    amountReceived?: number;
    actor: { userId: string; username: string; role: string };
  },
  localDb?: Database
): Promise<CostingProvisionResult> {
  const rows = await loadCostingSheetRows(localDb);
  if (rows === null) {
    return { sheetId: null, existing: false, skipped: TABLES_NOT_READY };
  }

  const existing = findExistingCostingSheet(rows, {
    projectId: input.projectId,
    leadId: input.lead?.id,
    quotationId: input.quote?.id,
  });
  if (existing) {
    return { sheetId: existing.id, existing: true };
  }

  const clientName = String(input.lead?.name || input.quote?.clientName || "").trim();
  if (!clientName) {
    return { sheetId: null, existing: false, skipped: "Client name missing." };
  }

  const boqItems = boqRowsToCostingItems(quotationBoqRows(input.quote));
  const saleTotal = moneyRound(boqItems.reduce((s, it) => s + it.totalSaleValue, 0));
  const quotationValue =
    saleTotal ||
    Number(input.quote?.grandTotal ?? input.quote?.totalCost ?? input.quote?.netCost ?? 0);

  const id = `cost-${Date.now()}`;
  const body = {
    title: buildAutoCostingTitle(clientName),
    clientName,
    leadId: input.lead?.id || null,
    customerId: input.customerId,
    projectId: input.projectId,
    quotationId: input.quote?.id || null,
    invoiceId: input.invoiceId,
    quotationValue,
    amountReceived: Math.max(0, Number(input.amountReceived ?? 0)),
    items: boqItems,
    notes: "Auto-created from contracted quotation BOQ.",
    autoCreated: true,
    consumeInventory: false,
    stockReserved: false,
    reservedStockValue: 0,
    consumedStockValue: 0,
  };
  const row = buildSheetDbRow(body, boqItems, input.actor.userId, id, true);
  const saved = await insertRow(SHEETS_TABLE, "internalCostingSheets", row, localDb);
  return { sheetId: saved.id, existing: false };
}

/** Sync amount received on the costing sheet linked to an invoice (Phase 23 PART 5). */
export async function syncCostingSheetFromInvoice(
  invoiceId: string,
  paidAmount: number,
  localDb?: Database
): Promise<{ sheetId: string } | null> {
  const rows = await loadCostingSheetRows(localDb);
  if (!rows) return null;
  const row = rows.find((r) => (r.invoice_id || r.invoiceId) === invoiceId);
  if (!row) return null;

  const sheet = mapSheetRow(row);
  const totals = computeCostingTotals({
    quotationValue: sheet.quotationValue,
    amountReceived: paidAmount,
    items: sheet.items,
  });
  const patch = {
    amount_received: totals.amountReceived,
    net_cash_remaining: totals.netCashRemaining,
    updated_at: new Date().toISOString(),
  };
  await updateRow(SHEETS_TABLE, "internalCostingSheets", sheet.id, patch, localDb);
  return { sheetId: sheet.id };
}

async function applySheetInventoryReserve(
  userId: string,
  username: string,
  sheet: InternalCostingSheet,
  localDb?: Database
) {
  if (!sheet.projectId) return { reservedStockValue: 0 };
  let reservedStockValue = 0;
  for (const item of sheet.items) {
    if (!item.inventoryItemId) continue;
    const qty = Math.max(0, item.purchaseQty || item.saleQty);
    if (qty <= 0) continue;
    await reserveAdminInventoryForProject(userId, username, {
      inventoryItemId: item.inventoryItemId,
      projectId: sheet.projectId,
      qty,
      notes: `Reserved for costing sheet ${sheet.id}: ${item.itemName}`,
    }, localDb);
    reservedStockValue = moneyRound(
      reservedStockValue + qty * Math.max(0, item.purchaseRate || 0)
    );
  }
  return { reservedStockValue };
}

/** Consume reserved inventory when installation starts (Phase 23 PART 6). */
export async function maybeConsumeCostingInventoryForProject(
  projectId: string,
  actor: { userId: string; username: string; role: string },
  localDb?: Database
) {
  const rows = await loadCostingSheetRows(localDb);
  if (!rows) return null;
  const row = rows.find((r) => (r.project_id || r.projectId) === projectId);
  if (!row) return null;
  const sheet = mapSheetRow(row);
  if (!sheet.consumeInventory || sheet.consumedStockValue > 0) return { sheetId: sheet.id, consumed: false };

  let items = sheet.items.map((it) => ({ ...it, consumeStock: !!it.inventoryItemId && !it.stockConsumed }));
  items = await applyStockConsumption(actor.userId, actor.username, sheet.id, items, sheet.items, localDb);
  const consumedStockValue = moneyRound(
    items
      .filter((it) => it.stockConsumed && it.inventoryItemId)
      .reduce((s, it) => s + (it.purchaseQty || it.saleQty) * Math.max(0, it.purchaseRate || 0), 0)
  );
  await updateRow(
    SHEETS_TABLE,
    "internalCostingSheets",
    sheet.id,
    {
      items: items.map(({ consumeStock, ...rest }) => rest),
      consumed_stock_value: consumedStockValue,
      updated_at: new Date().toISOString(),
    },
    localDb
  );
  return { sheetId: sheet.id, consumed: true, consumedStockValue };
}

export async function fetchProjectProfitabilitySummary(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(SHEETS_TABLE, "internalCostingSheets", localDb);
  const sheets = rows.map(mapSheetRow);
  return { summary: computeProjectProfitabilitySummary(sheets) };
}

export async function listAdminCostingSheets(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(SHEETS_TABLE, "internalCostingSheets", localDb);
  const sheets = rows
    .map(mapSheetRow)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return { sheets };
}

export async function getAdminCostingSheet(
  userId: string,
  username: string,
  id: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(SHEETS_TABLE, "internalCostingSheets", localDb);
  const row = rows.find((r: any) => r.id === id);
  if (!row) throw new InternalCostingDbError("Costing sheet not found.", 404);
  return { sheet: mapSheetRow(row) };
}

export async function createAdminCostingSheet(
  userId: string,
  username: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const clientName = String(body.clientName ?? body.client_name ?? "").trim();
  if (!clientName) throw new InternalCostingDbError("clientName is required.");
  const id = String(body.id || `cost-${Date.now()}`);
  let items = parseItems(body.items);
  items = await applyStockConsumption(userId, username, id, items, [], localDb);
  const row = buildSheetDbRow(body, items, userId, id, true);
  const saved = await insertRow(SHEETS_TABLE, "internalCostingSheets", row, localDb);
  return { sheet: mapSheetRow(saved) };
}

export async function updateAdminCostingSheet(
  userId: string,
  username: string,
  id: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const { sheet: existing } = await getAdminCostingSheet(userId, username, id, localDb);
  const merged: Record<string, unknown> = {
    title: body.title ?? existing.title,
    clientName: body.clientName ?? body.client_name ?? existing.clientName,
    leadId: body.leadId ?? body.lead_id ?? existing.leadId,
    customerId: body.customerId ?? body.customer_id ?? existing.customerId,
    projectId: body.projectId ?? body.project_id ?? existing.projectId,
    quotationId: body.quotationId ?? body.quotation_id ?? existing.quotationId,
    invoiceId: body.invoiceId ?? body.invoice_id ?? existing.invoiceId,
    quotationValue: body.quotationValue ?? body.quotation_value ?? existing.quotationValue,
    amountReceived: body.amountReceived ?? body.amount_received ?? existing.amountReceived,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    autoCreated: body.autoCreated ?? body.auto_created ?? existing.autoCreated,
    consumeInventory: body.consumeInventory ?? body.consume_inventory ?? existing.consumeInventory,
    stockReserved: existing.stockReserved,
    reservedStockValue: existing.reservedStockValue,
    consumedStockValue: existing.consumedStockValue,
  };
  let items = body.items !== undefined ? parseItems(body.items) : existing.items;

  const consumeEnabled = !!merged.consumeInventory;
  const wasConsumeEnabled = existing.consumeInventory;
  if (consumeEnabled && !wasConsumeEnabled && !existing.stockReserved) {
    const reserve = await applySheetInventoryReserve(userId, username, { ...existing, items }, localDb);
    merged.stockReserved = true;
    merged.reservedStockValue = reserve.reservedStockValue;
  }

  items = await applyStockConsumption(userId, username, id, items, existing.items, localDb);
  const row = buildSheetDbRow(merged, items, userId, id, false);
  const saved = await updateRow(SHEETS_TABLE, "internalCostingSheets", id, row, localDb);
  return { sheet: mapSheetRow(saved) };
}

export async function deleteAdminCostingSheet(
  userId: string,
  username: string,
  id: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  await getAdminCostingSheet(userId, username, id, localDb);
  await deleteRow(SHEETS_TABLE, "internalCostingSheets", id, localDb);
  return { success: true, id };
}

// ---------------------------------------------------------------------------
// PART 2 — Investors
// ---------------------------------------------------------------------------

export async function listAdminInvestors(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const [investorRows, purchaseRows] = await Promise.all([
    loadRows(INVESTORS_TABLE, "investors", localDb),
    loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb),
  ]);
  const purchases = purchaseRows.map(mapPurchaseRow);
  const investors = investorRows
    .map((r: any) => computeInvestorBalance(mapInvestorRow(r), purchases))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { investors };
}

function buildInvestorDbRow(
  body: Record<string, unknown>,
  id: string,
  isCreate: boolean
) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    name: String(body.name ?? "").trim(),
    amount_received: moneyRound(Math.max(0, Number(body.amountReceived ?? body.amount_received ?? 0) || 0)),
    date_received: body.dateReceived ?? body.date_received ?? null,
    purpose: body.purpose != null ? String(body.purpose) : "",
    notes: body.notes != null ? String(body.notes) : "",
    updated_at: now,
  };
  if (isCreate) row.created_at = now;
  return row;
}

export async function createAdminInvestor(
  userId: string,
  username: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const name = String(body.name ?? "").trim();
  if (!name) throw new InternalCostingDbError("Investor name is required.");
  const id = String(body.id || `invr-${Date.now()}`);
  const row = buildInvestorDbRow(body, id, true);
  const saved = await insertRow(INVESTORS_TABLE, "investors", row, localDb);
  return { investor: computeInvestorBalance(mapInvestorRow(saved), []) };
}

export async function updateAdminInvestor(
  userId: string,
  username: string,
  id: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(INVESTORS_TABLE, "investors", localDb);
  const existingRow = rows.find((r: any) => r.id === id);
  if (!existingRow) throw new InternalCostingDbError("Investor not found.", 404);
  const existing = mapInvestorRow(existingRow);
  const merged = {
    name: body.name ?? existing.name,
    amountReceived: body.amountReceived ?? body.amount_received ?? existing.amountReceived,
    dateReceived: body.dateReceived ?? body.date_received ?? existing.dateReceived,
    purpose: body.purpose !== undefined ? body.purpose : existing.purpose,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  };
  const row = buildInvestorDbRow(merged, id, false);
  const saved = await updateRow(INVESTORS_TABLE, "investors", id, row, localDb);
  const purchaseRows = await loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb);
  return {
    investor: computeInvestorBalance(mapInvestorRow(saved), purchaseRows.map(mapPurchaseRow)),
  };
}

export async function deleteAdminInvestor(
  userId: string,
  username: string,
  id: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const purchaseRows = await loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb);
  const linked = purchaseRows.map(mapPurchaseRow).filter((p) => p.investorId === id);
  if (linked.length > 0) {
    throw new InternalCostingDbError(
      `Cannot delete investor: ${linked.length} purchase(s) are linked to this investor.`
    );
  }
  await deleteRow(INVESTORS_TABLE, "investors", id, localDb);
  return { success: true, id };
}

// ---------------------------------------------------------------------------
// PART 3 — Inventory Purchases
// ---------------------------------------------------------------------------

export async function listAdminInventoryPurchases(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb);
  const purchases = rows
    .map(mapPurchaseRow)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { purchases };
}

export async function createAdminInventoryPurchase(
  userId: string,
  username: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);

  const supplierName = String(body.supplierName ?? body.supplier_name ?? "").trim();
  const productName = String(body.productName ?? body.product_name ?? "").trim();
  const quantity = Math.max(0, Number(body.quantity ?? 0) || 0);
  const purchaseRate = Math.max(0, Number(body.purchaseRate ?? body.purchase_rate ?? 0) || 0);
  if (!supplierName) throw new InternalCostingDbError("Supplier name is required.");
  if (!productName) throw new InternalCostingDbError("Product name is required.");
  if (quantity <= 0) throw new InternalCostingDbError("Quantity must be greater than 0.");
  const totalCost = computePurchaseTotal(quantity, purchaseRate);

  const investorId = body.investorId ?? body.investor_id ?? null;
  if (investorId) {
    const { investors } = await listAdminInvestors(userId, username, localDb);
    const investor = investors.find((i) => i.id === investorId);
    if (!investor) throw new InternalCostingDbError("Investor not found.", 404);
    if (totalCost > investor.remainingBalance) {
      throw new InternalCostingDbError(
        `Purchase of Rs. ${totalCost.toLocaleString()} exceeds investor "${investor.name}" remaining balance of Rs. ${investor.remainingBalance.toLocaleString()}.`
      );
    }
  }

  const rawStatus = String(body.paymentStatus ?? body.payment_status ?? "Unpaid");
  const paymentStatus = (PURCHASE_PAYMENT_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : "Unpaid";

  const id = String(body.id || `pur-${Date.now()}`);
  const now = new Date().toISOString();
  const row = {
    id,
    supplier_name: supplierName,
    product_name: productName,
    inventory_item_id: body.inventoryItemId ?? body.inventory_item_id ?? null,
    quantity,
    purchase_rate: purchaseRate,
    total_cost: totalCost,
    investor_id: investorId,
    payment_method: String(body.paymentMethod ?? body.payment_method ?? ""),
    payment_status: paymentStatus,
    bill_url: body.billUrl ?? body.bill_url ?? null,
    notes: body.notes != null ? String(body.notes) : "",
    created_by: userId,
    created_at: now,
  };

  const saved = await insertRow(PURCHASES_TABLE, "inventoryPurchases", row, localDb);
  const purchase = mapPurchaseRow(saved);

  // Increase hardware inventory stock when the purchase is linked to an item.
  let stockResult: { item: any; movement: any } | null = null;
  if (purchase.inventoryItemId) {
    try {
      stockResult = await stockInAdminInventoryItem(
        userId,
        username,
        purchase.inventoryItemId,
        {
          qty: quantity,
          referenceType: "purchase",
          referenceId: id,
          notes: `Purchase from ${supplierName} (${productName})`,
        },
        localDb
      );
    } catch (err: any) {
      await deleteRow(PURCHASES_TABLE, "inventoryPurchases", id, localDb).catch(() => {});
      throw new InternalCostingDbError(
        `Purchase rolled back — stock-in failed: ${err?.message || err}`
      );
    }
  }

  return { purchase, inventoryItem: stockResult?.item || null };
}

export async function deleteAdminInventoryPurchase(
  userId: string,
  username: string,
  id: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const rows = await loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb);
  const row = rows.find((r: any) => r.id === id);
  if (!row) throw new InternalCostingDbError("Purchase not found.", 404);
  const purchase = mapPurchaseRow(row);

  // Reverse the stock-in so inventory stays consistent.
  if (purchase.inventoryItemId && purchase.quantity > 0) {
    try {
      await stockOutAdminInventoryItem(
        userId,
        username,
        purchase.inventoryItemId,
        {
          qty: purchase.quantity,
          referenceType: "purchase_reversal",
          referenceId: id,
          notes: `Reversal of deleted purchase ${id}`,
        },
        localDb
      );
    } catch (err: any) {
      throw new InternalCostingDbError(
        `Cannot delete purchase — stock reversal failed: ${err?.message || err}`
      );
    }
  }

  await deleteRow(PURCHASES_TABLE, "inventoryPurchases", id, localDb);
  return { success: true, id };
}

// ---------------------------------------------------------------------------
// PART 6 — Reports
// ---------------------------------------------------------------------------

export async function fetchAdminCostingReports(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertInternalCostingAdmin(userId, username, localDb);
  const [sheetRows, investorRows, purchaseRows] = await Promise.all([
    loadRows(SHEETS_TABLE, "internalCostingSheets", localDb),
    loadRows(INVESTORS_TABLE, "investors", localDb),
    loadRows(PURCHASES_TABLE, "inventoryPurchases", localDb),
  ]);
  const sheets = sheetRows.map(mapSheetRow);
  const purchases = purchaseRows.map(mapPurchaseRow);
  const investors = investorRows.map((r: any) =>
    computeInvestorBalance(mapInvestorRow(r), purchases)
  );

  // Profit by client / project (each sheet is one client project).
  const profitByClient = sheets.map((s) => ({
    sheetId: s.id,
    clientName: s.clientName,
    leadId: s.leadId,
    quotationId: s.quotationId,
    quotationValue: s.totals.quotationValue,
    totalPurchaseCost: s.totals.totalPurchaseCost,
    grossProfit: s.totals.grossProfit,
    profitPercent: s.totals.profitPercent,
    amountReceived: s.totals.amountReceived,
    netCashRemaining: s.totals.netCashRemaining,
  }));

  // Supplier payable = unpaid costing items + unpaid purchases, by supplier.
  const supplierPayable = new Map<string, { supplier: string; payable: number; entries: number }>();
  const addPayable = (supplier: string, amount: number) => {
    const key = supplier.trim().toLowerCase() || "(unknown)";
    const entry = supplierPayable.get(key) || {
      supplier: supplier.trim() || "(Unknown supplier)",
      payable: 0,
      entries: 0,
    };
    entry.payable = moneyRound(entry.payable + amount);
    entry.entries += 1;
    supplierPayable.set(key, entry);
  };
  for (const s of sheets) {
    for (const it of s.items) {
      if (!it.paidToSupplier && it.totalPurchaseCost > 0) {
        addPayable(it.supplierName, it.totalPurchaseCost);
      }
    }
  }
  for (const p of purchases) {
    if (p.paymentStatus !== "Paid" && p.totalCost > 0) {
      addPayable(p.supplierName, p.totalCost);
    }
  }

  // Stock value from hardware inventory foundation items.
  let stockValue = 0;
  let stockItems: { id: string; label: string; stockQty: number; costPrice: number; value: number }[] = [];
  try {
    let foundationRows: any[] = [];
    if (isSupabaseActive()) {
      const { data } = await getSupabase()!.from("inventory_items").select("*");
      foundationRows = data || [];
    } else {
      foundationRows = ((localDb as any)?.inventoryFoundationItems || []) as any[];
    }
    stockItems = foundationRows.map((r: any) => {
      const stockQty = Number(r.stock_qty ?? r.stockQty ?? 0);
      const costPrice = Number(r.cost_price ?? r.costPrice ?? 0);
      const value = moneyRound(stockQty * costPrice);
      return {
        id: r.id,
        label: [r.brand, r.model].filter(Boolean).join(" ") || r.sku || r.id,
        stockQty,
        costPrice,
        value,
      };
    });
    stockValue = moneyRound(stockItems.reduce((s, it) => s + it.value, 0));
  } catch {
    stockItems = [];
  }

  // Gross margin summary across all sheets.
  const totalSale = moneyRound(sheets.reduce((s, x) => s + x.totals.quotationValue, 0));
  const totalCost = moneyRound(sheets.reduce((s, x) => s + x.totals.totalPurchaseCost, 0));
  const totalProfit = moneyRound(totalSale - totalCost);
  const grossMargin = {
    totalSale,
    totalCost,
    totalProfit,
    marginPercent: totalSale > 0 ? moneyRound((totalProfit / totalSale) * 100) : 0,
    sheetCount: sheets.length,
  };

  return {
    profitByClient,
    investorBalances: investors.map((i) => ({
      id: i.id,
      name: i.name,
      amountReceived: i.amountReceived,
      amountSpent: i.amountSpent,
      remainingBalance: i.remainingBalance,
      purchaseCount: i.purchaseCount,
    })),
    supplierPayable: Array.from(supplierPayable.values()).sort((a, b) => b.payable - a.payable),
    purchaseHistory: purchases,
    stockValue: { total: stockValue, items: stockItems },
    grossMargin,
  };
}
