import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  StaffPortalAuthError,
  CustomerPortalAuthError,
} from "./dbManager.js";
import {
  canCreateInvoice,
  computeInvoiceTotals,
  derivePaymentStatus,
  type InvoiceLineItem,
  type InvoicePaymentMethod,
  type InvoiceRecord,
} from "./src/lib/invoices.ts";
import type { RequestActor } from "./server/middleware/actor.ts";
import {
  FinanceOwnershipResolver,
} from "./server/ownership/FinanceOwnershipResolver.ts";
import { uploadFileToCustomerStorage } from "./customerProfileDb.js";
import { amountInWordsPkr } from "./src/lib/amountInWords.ts";
import {
  decodeInvoiceMeta,
  encodeInvoiceNotes,
  type InvoicePdfMeta,
} from "./src/lib/invoicePdfMeta.ts";
import { resolveInvoiceCustomerId } from "./invoiceCustomerLink.js";
import { coercePaymentMethod } from "./src/lib/invoicePayments.ts";
import { syncInvoiceDocumentVault, hideInvoiceDocumentVault, unlinkInvoiceDocumentVault } from "./customerDocumentSync.js";
import {
  buildInvoiceDraftFromLead,
  isContractedLeadReady,
  pickQuoteForInvoice,
  type InvoiceDraftFromLead,
} from "./src/lib/invoiceFromLead.ts";
import { isInvoiceArchived } from "./src/lib/invoices.ts";
import { syncCostingSheetFromInvoice } from "./internalCostingDb.js";
import {
  balanceAfterLedger,
  findRecentDuplicatePayment,
  ledgerTotal,
  normalizeClientRequestId,
  overpaymentError,
  paymentIdFor,
  roundMoney,
} from "./server/finance/paymentLedger.ts";

export class InvoiceDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sanitizeDate(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

const INVOICE_DATE_DB_FIELDS = new Set(["invoice_date", "due_date", "po_date"]);

function isInvoiceTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "42P01" || msg.includes("invoices") || msg.includes("invoice_items");
}

export function isMissingInvoiceOwnerColumn(err: unknown): boolean {
  const candidate = err as { code?: unknown; message?: unknown } | null;
  const message = String(candidate?.message || "").toLowerCase();
  return (
    candidate?.code === "PGRST204" &&
    message.includes("created_by_user_id") &&
    message.includes("invoices")
  );
}

function mapInvoiceRow(row: any, items: InvoiceLineItem[] = [], payments: any[] = []): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number || row.invoiceNumber,
    invoiceDate: row.invoice_date || row.invoiceDate,
    invoiceTime: row.invoice_time || row.invoiceTime || null,
    dueDate: row.due_date || row.dueDate || null,
    poNumber: row.po_number || row.poNumber || null,
    poDate: row.po_date || row.poDate || null,
    paymentTerms: row.payment_terms || row.paymentTerms || null,
    paymentMode: row.payment_mode || row.paymentMode || null,
    amountInWords: row.amount_in_words || row.amountInWords || null,
    previousBalance: Number(row.previous_balance ?? row.previousBalance ?? 0),
    customerId: row.customer_id || row.customerId || null,
    customerName: row.customer_name || row.customerName,
    customerPhone: row.customer_phone || row.customerPhone || null,
    customerAddress: row.customer_address || row.customerAddress || null,
    cnicNtn: row.cnic_ntn || row.cnicNtn || null,
    leadId: row.lead_id || row.leadId || null,
    quotationId: row.quotation_id || row.quotationId || null,
    projectId: row.project_id || row.projectId || null,
    subtotal: Number(row.subtotal ?? 0),
    discountAmount: Number(row.discount_amount ?? row.discountAmount ?? 0),
    taxAmount: Number(row.tax_amount ?? row.taxAmount ?? 0),
    grandTotal: Number(row.grand_total ?? row.grandTotal ?? 0),
    paidAmount: Number(row.paid_amount ?? row.paidAmount ?? 0),
    balanceDue: Number(row.balance_due ?? row.balanceDue ?? 0),
    paymentStatus: row.payment_status || row.paymentStatus || "Unpaid",
    invoiceStatus: row.invoice_status || row.invoiceStatus || "active",
    archivedAt: row.archived_at || row.archivedAt || null,
    archivedBy: row.archived_by || row.archivedBy || null,
    notes: row.notes || null,
    terms: row.terms || null,
    pdfUrl: row.pdf_url || row.pdfUrl || null,
    items,
    payments,
    createdBy: row.created_by || row.createdBy,
    updatedBy: row.updated_by || row.updatedBy,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapItemRow(row: any): InvoiceLineItem {
  return {
    id: row.id,
    sortOrder: row.sort_order ?? row.sortOrder,
    itemName: row.item_name || row.itemName || row.description,
    description: row.description,
    qty: Number(row.qty ?? 1),
    unit: row.unit || "pcs",
    rate: Number(row.rate ?? 0),
    taxPercent: Number(row.tax_percent ?? row.taxPercent ?? 0),
    discountAmount: Number(row.discount_amount ?? row.discountAmount ?? 0),
    lineTotal: Number(row.line_total ?? row.lineTotal ?? 0),
    productId: row.product_id || row.productId || null,
    notes: row.notes || null,
  };
}

function mapPaymentRow(row: any) {
  return {
    id: row.id,
    invoiceId: row.invoice_id || row.invoiceId,
    amount: Number(row.amount),
    paymentMethod: row.payment_method || row.paymentMethod,
    paymentDate: row.payment_date || row.paymentDate,
    referenceNumber: row.reference_number || row.referenceNumber || null,
    receiptUrl: row.receipt_url || row.receiptUrl || null,
    notes: row.notes || null,
    recordedBy: row.recorded_by || row.recordedBy || null,
    createdAt: row.created_at || row.createdAt,
  };
}

export function hydrateInvoiceRowsFromRelatedRows(
  invoiceRows: Record<string, unknown>[],
  itemRows: Record<string, unknown>[],
  paymentRows: Record<string, unknown>[]
): InvoiceRecord[] {
  const itemsByInvoice = new Map<string, InvoiceLineItem[]>();
  for (const row of itemRows) {
    const invoiceId = String((row as any).invoice_id || (row as any).invoiceId || "");
    if (!invoiceId) continue;
    const group = itemsByInvoice.get(invoiceId) || [];
    group.push(mapItemRow(row));
    itemsByInvoice.set(invoiceId, group);
  }

  const paymentsByInvoice = new Map<string, any[]>();
  for (const row of paymentRows) {
    const invoiceId = String((row as any).invoice_id || (row as any).invoiceId || "");
    if (!invoiceId) continue;
    const group = paymentsByInvoice.get(invoiceId) || [];
    group.push(mapPaymentRow(row));
    paymentsByInvoice.set(invoiceId, group);
  }

  return invoiceRows.map((row) => {
    const invoiceId = String((row as any).id || "");
    return mapInvoiceRow(
      row,
      itemsByInvoice.get(invoiceId) || [],
      paymentsByInvoice.get(invoiceId) || []
    );
  });
}

export async function hydrateInvoiceRows(
  invoiceRows: Record<string, unknown>[],
  localDb?: Database
): Promise<InvoiceRecord[]> {
  const invoiceIds = invoiceRows.map((row) => String(row.id || "")).filter(Boolean);
  if (invoiceIds.length === 0) return [];

  if (isSupabaseActive()) {
    const [itemsResult, paymentsResult] = await Promise.all([
      getSupabase()!
        .from("invoice_items")
        .select("*")
        .in("invoice_id", invoiceIds)
        .order("sort_order"),
      getSupabase()!
        .from("invoice_payments")
        .select("*")
        .in("invoice_id", invoiceIds)
        .order("created_at", { ascending: false }),
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    return hydrateInvoiceRowsFromRelatedRows(
      invoiceRows,
      (itemsResult.data || []) as Record<string, unknown>[],
      (paymentsResult.data || []) as Record<string, unknown>[]
    );
  }

  const idSet = new Set(invoiceIds);
  const itemRows = (((localDb as any)?.invoiceItems || []) as Record<string, unknown>[]).filter(
    (row: any) => idSet.has(String(row.invoice_id || row.invoiceId || ""))
  );
  const paymentRows = (((localDb as any)?.invoicePayments || []) as Record<string, unknown>[]).filter(
    (row: any) => idSet.has(String(row.invoice_id || row.invoiceId || ""))
  );
  return hydrateInvoiceRowsFromRelatedRows(invoiceRows, itemRows, paymentRows);
}

async function assertInvoiceStaff(actor: RequestActor, localDb?: Database) {
  await verifyStaffPortalUser(actor.id, actor.username, localDb);
  FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(actor);
}

function toRequestActor(userId: string, username: string, role: string): RequestActor {
  return {
    id: userId,
    username,
    name: username,
    email: "",
    role,
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

async function nextInvoiceNumber(localDb?: Database): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  let count = 0;
  if (isSupabaseActive()) {
    const { count: c, error } = await getSupabase()!
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .like("invoice_number", `${prefix}%`);
    if (!error && c != null) count = c;
  } else {
    const rows = (localDb as any)?.invoices || [];
    count = rows.filter((r: any) => String(r.invoice_number || r.invoiceNumber || "").startsWith(prefix)).length;
  }
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

async function loadItems(invoiceId: string, localDb?: Database): Promise<InvoiceLineItem[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("sort_order");
    if (error) throw error;
    return (data || []).map(mapItemRow);
  }
  return ((localDb as any)?.invoiceItems || [])
    .filter((r: any) => (r.invoice_id || r.invoiceId) === invoiceId)
    .map(mapItemRow);
}

async function loadPayments(invoiceId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPaymentRow);
  }
  return ((localDb as any)?.invoicePayments || [])
    .filter((r: any) => (r.invoice_id || r.invoiceId) === invoiceId)
    .map(mapPaymentRow);
}

async function recalcPaidTotals(invoiceId: string, localDb?: Database) {
  const payments = await loadPayments(invoiceId, localDb);
  return payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** Returns false when a row with the same id already exists (a replayed submission). */
async function insertPaymentRow(
  payRow: Record<string, unknown>,
  localDb?: Database
): Promise<boolean> {
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("invoice_payments").insert(payRow);
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }
  const db = localDb as any;
  db.invoicePayments = db.invoicePayments || [];
  if (db.invoicePayments.some((r: any) => r.id === payRow.id)) return false;
  db.invoicePayments.push(payRow);
  return true;
}

/** Persist paid/balance/status derived from the payment ledger. */
async function persistLedgerTotals(
  invoiceId: string,
  grandTotal: number,
  dueDate: string | null | undefined,
  username: string,
  localDb?: Database
) {
  const paidTotal = await recalcPaidTotals(invoiceId, localDb);
  const patch = {
    paid_amount: paidTotal,
    balance_due: balanceAfterLedger(grandTotal, paidTotal),
    payment_status: derivePaymentStatus(grandTotal, paidTotal, dueDate ?? null),
    updated_at: new Date().toISOString(),
    updated_by: username,
  };
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("invoices").update(patch).eq("id", invoiceId);
    if (error) throw new InvoiceDbError(`Payment saved, but the invoice balance could not be updated: ${error.message}. Retry to refresh the balance.`, 500);
  } else {
    const db = localDb as any;
    const idx = (db.invoices || []).findIndex((r: any) => r.id === invoiceId);
    if (idx >= 0) Object.assign(db.invoices[idx], patch);
  }
  return paidTotal;
}

/** Auto-insert audit row when invoice is saved with paidAmount > 0 and no payments yet. */
async function ensureInitialPaymentRow(
  invoiceId: string,
  opts: {
    paidAmount: number;
    paymentMode?: string | null;
    invoiceDate: string;
    createdBy: string;
  },
  localDb?: Database
) {
  if (opts.paidAmount <= 0) return;
  const existing = await loadPayments(invoiceId, localDb);
  if (existing.length > 0) return;

  const payRow = {
    // One opening row per invoice, even if two saves race.
    id: `pay-init-${invoiceId}`,
    invoice_id: invoiceId,
    amount: opts.paidAmount,
    payment_method: coercePaymentMethod(opts.paymentMode),
    payment_date: sanitizeDate(opts.invoiceDate) ?? new Date().toISOString().slice(0, 10),
    receipt_url: null,
    receipt_storage_path: null,
    notes: "Initial payment recorded at invoice creation",
    recorded_by: opts.createdBy,
    created_at: new Date().toISOString(),
  };
  await insertPaymentRow(payRow, localDb);
}

export async function listAdminInvoices(
  actor: RequestActor,
  localDb?: Database,
  options?: { includeArchived?: boolean }
): Promise<InvoiceRecord[]>;
export async function listAdminInvoices(
  userId: string,
  username: string,
  role: string,
  localDb?: Database,
  options?: { includeArchived?: boolean }
): Promise<InvoiceRecord[]>;
export async function listAdminInvoices(
  actorOrUserId: RequestActor | string,
  localDbOrUsername?: Database | string,
  roleOrOptions?: string | { includeArchived?: boolean },
  localDbMaybe?: Database,
  optionsMaybe?: { includeArchived?: boolean }
): Promise<InvoiceRecord[]> {
  let actor: RequestActor;
  let localDb: Database | undefined;
  let options: { includeArchived?: boolean } | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, String(localDbOrUsername || ""), String(roleOrOptions || ""));
    localDb = localDbMaybe;
    options = optionsMaybe;
  } else {
    actor = actorOrUserId;
    localDb = localDbOrUsername as Database | undefined;
    options = roleOrOptions as { includeArchived?: boolean } | undefined;
  }

  await assertInvoiceStaff(actor, localDb);
  const includeArchived = options?.includeArchived === true;

  const filterArchived = (inv: InvoiceRecord) =>
    includeArchived || !isInvoiceArchived(inv);

  if (isSupabaseActive()) {
    try {
      const { data, error } = await getSupabase()!.from("invoices").select("*").order("invoice_date", { ascending: false });
      if (error) throw error;
      const rows = FinanceOwnershipResolver.filterInvoiceRowsForActor(actor, (data || []) as Record<string, unknown>[]);
      const out = await hydrateInvoiceRows(rows, localDb);
      return out.filter(filterArchived);
    } catch (err: any) {
      if (isInvoiceTableMissing(err)) return [];
      throw err;
    }
  }

  const rows = FinanceOwnershipResolver.filterInvoiceRowsForActor(
    actor,
    (((localDb as any)?.invoices || []) as Record<string, unknown>[]).slice().reverse()
  );
  const out: InvoiceRecord[] = [];
  for (const row of rows) {
    const items = await loadItems(String(row.id), localDb);
    const payments = await loadPayments(String(row.id), localDb);
    out.push(mapInvoiceRow(row, items, payments));
  }
  return out.filter(filterArchived);
}

export async function loadInvoiceRecordById(
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (error || !data) throw new InvoiceDbError("Invoice not found.", 404);
    const items = await loadItems(invoiceId, localDb);
    const payments = await loadPayments(invoiceId, localDb);
    return mapInvoiceRow(data, items, payments);
  }

  const row = ((localDb as any)?.invoices || []).find((r: any) => r.id === invoiceId);
  if (!row) throw new InvoiceDbError("Invoice not found.", 404);
  return mapInvoiceRow(row, await loadItems(invoiceId, localDb), await loadPayments(invoiceId, localDb));
}

export async function getAdminInvoiceById(
  actor: RequestActor,
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function getAdminInvoiceById(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function getAdminInvoiceById(
  actorOrUserId: RequestActor | string,
  invoiceIdOrUsername: string,
  localDbOrRole?: Database | string,
  invoiceIdMaybe?: string,
  localDbMaybe?: Database
): Promise<InvoiceRecord> {
  let actor: RequestActor;
  let invoiceId: string;
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, invoiceIdOrUsername, String(localDbOrRole || ""));
    invoiceId = String(invoiceIdMaybe || "");
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    invoiceId = invoiceIdOrUsername;
    localDb = localDbOrRole as Database | undefined;
  }

  await assertInvoiceStaff(actor, localDb);
  await FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
  return loadInvoiceRecordById(invoiceId, localDb);
}

export async function createAdminInvoice(
  actor: RequestActor,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function createAdminInvoice(
  userId: string,
  username: string,
  role: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function createAdminInvoice(
  actorOrUserId: RequestActor | string,
  bodyOrUsername: Record<string, unknown> | string,
  roleOrLocalDb?: string | Database,
  bodyMaybe?: Record<string, unknown>,
  localDbMaybe?: Database
): Promise<InvoiceRecord> {
  let actor: RequestActor;
  let body: Record<string, unknown>;
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, String(bodyOrUsername), String(roleOrLocalDb || ""));
    body = bodyMaybe || {};
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    body = bodyOrUsername as Record<string, unknown>;
    localDb = roleOrLocalDb as Database | undefined;
  }

  await assertInvoiceStaff(actor, localDb);
  const username = actor.username;
  const id = `inv-${Date.now()}`;
  const invoiceNumber = String(body.invoiceNumber || "") || (await nextInvoiceNumber(localDb));
  const rawItems = (body.items as InvoiceLineItem[]) || [];
  const totals = computeInvoiceTotals(
    rawItems,
    Number(body.discountAmount ?? body.discount_amount ?? 0)
  );
  const paidAmount = Number(body.paidAmount ?? body.paid_amount ?? 0);
  const grandTotal = totals.grandTotal;
  const balanceDue = Math.max(0, Math.round((grandTotal - paidAmount) * 100) / 100);
  const dueDate = sanitizeDate(body.dueDate ?? body.due_date);
  const poDate = sanitizeDate(body.poDate ?? body.po_date);
  const paymentStatus = derivePaymentStatus(
    grandTotal,
    paidAmount,
    dueDate,
    body.paymentStatus as any
  );

  const amountWords =
    String(body.amountInWords || body.amount_in_words || "") ||
    amountInWordsPkr(totals.grandTotal);

  const invoiceDate =
    sanitizeDate(body.invoiceDate ?? body.invoice_date) ??
    new Date().toISOString().slice(0, 10);

  const resolvedCustomerId = await resolveInvoiceCustomerId(
    {
      customerId: (body.customerId || body.customer_id) as string | null | undefined,
      customerName: String(body.customerName || body.customer_name || "Customer"),
      customerPhone: (body.customerPhone || body.customer_phone) as string | null | undefined,
      customerEmail: (body.customerEmail || body.customer_email) as string | null | undefined,
      customerAddress: (body.customerAddress || body.customer_address) as string | null | undefined,
      cnicNtn: (body.cnicNtn || body.cnic_ntn) as string | null | undefined,
    },
    localDb,
    { username, invoiceNumber }
  );

  const row = {
    id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    invoice_time: body.invoiceTime || body.invoice_time || null,
    due_date: dueDate,
    po_number: body.poNumber || body.po_number || null,
    po_date: poDate,
    payment_terms: body.paymentTerms || body.payment_terms || null,
    payment_mode: body.paymentMode || body.payment_mode || null,
    amount_in_words: amountWords,
    previous_balance: Number(body.previousBalance ?? body.previous_balance ?? 0),
    customer_id: resolvedCustomerId,
    customer_name: String(body.customerName || body.customer_name || "Customer"),
    customer_phone: body.customerPhone || body.customer_phone || null,
    customer_address: body.customerAddress || body.customer_address || null,
    cnic_ntn: body.cnicNtn || body.cnic_ntn || null,
    lead_id: body.leadId || body.lead_id || null,
    quotation_id: body.quotationId || body.quotation_id || null,
    project_id: body.projectId || body.project_id || null,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    tax_amount: totals.taxAmount,
    grand_total: grandTotal,
    paid_amount: paidAmount,
    balance_due: balanceDue,
    payment_status: paymentStatus,
    invoice_status: "active",
    notes: encodeInvoiceNotes(
      String(body.notes || ""),
      (body.invoiceMeta as InvoicePdfMeta | undefined) || undefined
    ),
    terms: body.terms || null,
    pdf_url: null,
    created_by: username,
    created_by_user_id: actor.id,
    updated_by: username,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const itemRows = totals.items.map((it, idx) => ({
    id: it.id || `item-${Date.now()}-${idx}`,
    invoice_id: id,
    sort_order: idx,
    item_name: it.itemName || it.description,
    description: it.description || it.itemName || "Item",
    qty: it.qty,
    unit: it.unit || "pcs",
    rate: it.rate,
    tax_percent: it.taxPercent,
    discount_amount: it.discountAmount,
    line_total: it.lineTotal,
    product_id: it.productId || null,
    notes: it.notes || null,
  }));

  if (isSupabaseActive()) {
    let { error } = await getSupabase()!.from("invoices").insert(row);
    if (error && actor.role === "Super Admin" && isMissingInvoiceOwnerColumn(error)) {
      // Some production installations predate the durable finance-owner column.
      // Preserve the legacy username owner for Super Admin operations so historical
      // data can be imported; scoped staff creates still require the durable column.
      const { created_by_user_id: _ownerUserId, ...legacyCompatibleRow } = row;
      ({ error } = await getSupabase()!.from("invoices").insert(legacyCompatibleRow));
    }
    if (error) throw error;
    if (itemRows.length) {
      const { error: iErr } = await getSupabase()!.from("invoice_items").insert(itemRows);
      if (iErr) throw iErr;
    }
  } else {
    const db = localDb as any;
    db.invoices = db.invoices || [];
    db.invoiceItems = db.invoiceItems || [];
    db.invoices.push(row);
    db.invoiceItems.push(...itemRows);
  }

  await ensureInitialPaymentRow(
    id,
    {
      paidAmount,
      paymentMode: (body.paymentMode || body.payment_mode) as string | null | undefined,
      invoiceDate,
      createdBy: username,
    },
    localDb
  );

  const created = await getAdminInvoiceById(actor, id, localDb);
  try {
    await syncInvoiceDocumentVault(created, localDb);
  } catch (err: any) {
    console.warn("[InvoiceDocumentSync] create:", err?.message || err);
  }
  return created;
}

export async function updateAdminInvoice(
  actor: RequestActor,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function updateAdminInvoice(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function updateAdminInvoice(
  actorOrUserId: RequestActor | string,
  invoiceIdOrUsername: string,
  bodyOrRole?: Record<string, unknown> | string,
  localDbOrInvoiceId?: Database | string,
  bodyMaybe?: Record<string, unknown>,
  localDbMaybe?: Database
): Promise<InvoiceRecord> {
  let actor: RequestActor;
  let invoiceId: string;
  let body: Record<string, unknown>;
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, invoiceIdOrUsername, String(bodyOrRole || ""));
    invoiceId = String(localDbOrInvoiceId || "");
    body = bodyMaybe || {};
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    invoiceId = invoiceIdOrUsername;
    body = bodyOrRole as Record<string, unknown>;
    localDb = localDbOrInvoiceId as Database | undefined;
  }

  const username = actor.username;
  const existing = await getAdminInvoiceById(actor, invoiceId, localDb);

  const rawItems = body.items as InvoiceLineItem[] | undefined;
  let patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: username,
  };

  // Recorded payments decide what was paid; a stale form value must not overwrite the ledger.
  const ledger = await loadPayments(invoiceId, localDb);
  const totals = rawItems
    ? computeInvoiceTotals(rawItems, Number(body.discountAmount ?? body.discount_amount ?? 0))
    : null;
  const grandTotal = totals ? totals.grandTotal : existing.grandTotal;
  const requestedPaid = body.paidAmount !== undefined || body.paid_amount !== undefined
    ? roundMoney(Number(body.paidAmount ?? body.paid_amount ?? 0))
    : existing.paidAmount;
  const paidAmount = ledger.length ? ledgerTotal(ledger) : requestedPaid;
  // Only an edit that changes the total or paid amount is checked; legacy overpaid invoices stay editable.
  const changesMoney = grandTotal !== existing.grandTotal || (!ledger.length && requestedPaid !== existing.paidAmount);
  if (paidAmount > grandTotal && changesMoney) {
    throw new InvoiceDbError(
      ledger.length
        ? `The invoice total (PKR ${grandTotal.toLocaleString("en-PK")}) cannot be lower than payments already recorded (PKR ${paidAmount.toLocaleString("en-PK")}).`
        : "Paid amount cannot exceed the invoice total.",
      422
    );
  }
  if (totals || body.paidAmount !== undefined || body.paid_amount !== undefined) {
    patch = {
      ...patch,
      paid_amount: paidAmount,
      balance_due: balanceAfterLedger(grandTotal, paidAmount),
      payment_status: derivePaymentStatus(
        grandTotal,
        paidAmount,
        sanitizeDate(body.dueDate ?? body.due_date ?? existing.dueDate),
        body.paymentStatus as any
      ),
    };
  }

  if (rawItems && totals) {
    patch = {
      ...patch,
      subtotal: totals.subtotal,
      discount_amount: totals.discountAmount,
      tax_amount: totals.taxAmount,
      grand_total: totals.grandTotal,
    };

    const amountWords =
      String(body.amountInWords || body.amount_in_words || "") ||
      amountInWordsPkr(totals.grandTotal);
    patch.amount_in_words = amountWords;

    const itemRows = totals.items.map((it, idx) => ({
      id: it.id || `item-${Date.now()}-${idx}`,
      invoice_id: invoiceId,
      sort_order: idx,
      item_name: it.itemName || it.description,
      description: it.description || it.itemName || "Item",
      qty: it.qty,
      unit: it.unit || "pcs",
      rate: it.rate,
      tax_percent: it.taxPercent,
      discount_amount: it.discountAmount,
      line_total: it.lineTotal,
      product_id: it.productId || null,
      notes: it.notes || null,
    }));

    if (isSupabaseActive()) {
      // Write the new lines before removing old ones, so a failed save never leaves an empty invoice.
      const client = getSupabase()!;
      if (itemRows.length) {
        const { error: upsertError } = await client.from("invoice_items").upsert(itemRows, { onConflict: "id" });
        if (upsertError) throw new InvoiceDbError(`Invoice items could not be saved: ${upsertError.message}`, 500);
      }
      const keep = itemRows.map((r) => r.id);
      let removal = client.from("invoice_items").delete().eq("invoice_id", invoiceId);
      if (keep.length) removal = removal.not("id", "in", `(${keep.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",")})`);
      const { error: deleteError } = await removal;
      if (deleteError) throw new InvoiceDbError(`Removed invoice items could not be deleted: ${deleteError.message}`, 500);
    } else {
      const db = localDb as any;
      db.invoiceItems = (db.invoiceItems || []).filter(
        (r: any) => (r.invoice_id || r.invoiceId) !== invoiceId
      );
      db.invoiceItems.push(...itemRows);
    }
  }

  if (!existing.customerId) {
    const explicitCid = body.customerId ?? body.customer_id;
    const linkedId = await resolveInvoiceCustomerId(
      {
        customerId: explicitCid as string | null | undefined,
        customerName:
          (body.customerName ?? body.customer_name ?? existing.customerName) as string,
        customerPhone:
          (body.customerPhone ?? body.customer_phone ?? existing.customerPhone) as
            | string
            | null
            | undefined,
        customerEmail: (body.customerEmail ?? body.customer_email) as string | null | undefined,
        customerAddress:
          (body.customerAddress ?? body.customer_address ?? existing.customerAddress) as
            | string
            | null
            | undefined,
        cnicNtn: (body.cnicNtn ?? body.cnic_ntn ?? existing.cnicNtn) as string | null | undefined,
      },
      localDb,
      { username, invoiceNumber: existing.invoiceNumber }
    );
    if (linkedId) patch.customer_id = linkedId;
  }

  const scalarFields: [string, string][] = [
    ["invoice_date", "invoiceDate"],
    ["invoice_time", "invoiceTime"],
    ["due_date", "dueDate"],
    ["po_number", "poNumber"],
    ["po_date", "poDate"],
    ["payment_terms", "paymentTerms"],
    ["payment_mode", "paymentMode"],
    ["amount_in_words", "amountInWords"],
    ["previous_balance", "previousBalance"],
    ["customer_name", "customerName"],
    ["customer_phone", "customerPhone"],
    ["customer_address", "customerAddress"],
    ["cnic_ntn", "cnicNtn"],
    ["lead_id", "leadId"],
    ["quotation_id", "quotationId"],
    ["project_id", "projectId"],
    ["notes", "notes"],
    ["terms", "terms"],
    ["pdf_url", "pdfUrl"],
  ];
  for (const [dbKey, bodyKey] of scalarFields) {
    if (body[bodyKey] !== undefined || body[dbKey] !== undefined) {
      const raw = body[bodyKey] ?? body[dbKey];
      patch[dbKey] = INVOICE_DATE_DB_FIELDS.has(dbKey) ? sanitizeDate(raw) : raw;
    }
  }

  if (body.invoiceMeta !== undefined || body.notes !== undefined) {
    const meta =
      body.invoiceMeta !== undefined
        ? (body.invoiceMeta as InvoicePdfMeta)
        : decodeInvoiceMeta(existing.notes);
    const userNotes =
      body.notes !== undefined ? String(body.notes) : undefined;
    patch.notes = encodeInvoiceNotes(
      userNotes !== undefined ? userNotes : existing.notes || "",
      meta || undefined
    );
  }

  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("invoices").update(patch).eq("id", invoiceId);
    if (error) throw error;
  } else {
    const db = localDb as any;
    const idx = (db.invoices || []).findIndex((r: any) => r.id === invoiceId);
    if (idx >= 0) Object.assign(db.invoices[idx], patch);
  }

  const paidForAudit =
    patch.paid_amount !== undefined
      ? Number(patch.paid_amount)
      : existing.paidAmount;
  const invoiceDateForAudit =
    sanitizeDate(patch.invoice_date) ??
    sanitizeDate(existing.invoiceDate) ??
    new Date().toISOString().slice(0, 10);
  const paymentModeForAudit =
    (patch.payment_mode as string | undefined) ?? existing.paymentMode;
  await ensureInitialPaymentRow(
    invoiceId,
    {
      paidAmount: paidForAudit,
      paymentMode: paymentModeForAudit,
      invoiceDate: invoiceDateForAudit,
      createdBy: username,
    },
    localDb
  );

  const updated = await getAdminInvoiceById(actor, invoiceId, localDb);
  try {
    await syncInvoiceDocumentVault(updated, localDb);
  } catch (err: any) {
    console.warn("[InvoiceDocumentSync] update:", err?.message || err);
  }
  return updated;
}

export async function recordInvoicePayment(
  actor: RequestActor,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<{ payment: Record<string, unknown>; invoice: InvoiceRecord; replayed: boolean }>;
export async function recordInvoicePayment(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<{ payment: Record<string, unknown>; invoice: InvoiceRecord; replayed: boolean }>;
export async function recordInvoicePayment(
  actorOrUserId: RequestActor | string,
  invoiceIdOrUsername: string,
  bodyOrRole?: Record<string, unknown> | string,
  localDbOrInvoiceId?: Database | string,
  bodyMaybe?: Record<string, unknown>,
  localDbMaybe?: Database
) {
  let actor: RequestActor;
  let invoiceId: string;
  let body: Record<string, unknown>;
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, invoiceIdOrUsername, String(bodyOrRole || ""));
    invoiceId = String(localDbOrInvoiceId || "");
    body = bodyMaybe || {};
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    invoiceId = invoiceIdOrUsername;
    body = bodyOrRole as Record<string, unknown>;
    localDb = localDbOrInvoiceId as Database | undefined;
  }

  const username = actor.username;
  await FinanceOwnershipResolver.assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
  const before = await getAdminInvoiceById(actor, invoiceId, localDb);
  const amount = roundMoney(Number(body.amount || 0));
  if (!(amount > 0)) throw new InvoiceDbError("Payment amount must be positive.");

  const clientRequestId = normalizeClientRequestId(body.clientRequestId);
  const paymentMethod = coercePaymentMethod((body.paymentMethod || body.payment_method) as string | undefined);
  const paymentDate = sanitizeDate(body.paymentDate ?? body.payment_date) ?? new Date().toISOString().slice(0, 10);
  const referenceNumber = String(body.referenceNumber || body.reference_number || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;
  const nowMs = Date.now();
  const payId = paymentIdFor({ invoiceId, clientRequestId, amount, paymentMethod, paymentDate, referenceNumber, notes, recordedBy: username, nowMs });

  // Legacy invoices may carry a paid amount without ledger rows; record it before adding more.
  await ensureInitialPaymentRow(invoiceId, { paidAmount: before.paidAmount, paymentMode: before.paymentMode, invoiceDate: before.invoiceDate, createdBy: username }, localDb);
  const ledger = await loadPayments(invoiceId, localDb);
  const replay = async () => {
    const existing = (await loadPayments(invoiceId, localDb)).find((p) => p.id === payId);
    if (!clientRequestId) throw new InvoiceDbError("An identical payment was recorded moments ago. Refresh the invoice before recording it again, or add a reference to tell the payments apart.", 409);
    await persistLedgerTotals(invoiceId, before.grandTotal, before.dueDate, username, localDb);
    return { payment: existing as Record<string, unknown>, invoice: await getAdminInvoiceById(actor, invoiceId, localDb), replayed: true };
  };
  if (ledger.some((p) => p.id === payId)) return replay();
  if (!clientRequestId && findRecentDuplicatePayment(ledger, { amount, paymentMethod, paymentDate, referenceNumber, notes, recordedBy: username, nowMs })) {
    throw new InvoiceDbError("An identical payment was recorded moments ago. Refresh the invoice before recording it again, or add a reference to tell the payments apart.", 409);
  }
  const overpaid = overpaymentError(amount, before.grandTotal, ledgerTotal(ledger));
  if (overpaid) throw new InvoiceDbError(overpaid, 422);

  let receiptUrl = body.receiptUrl || body.receipt_url || null;
  let receiptStoragePath = body.receiptStoragePath || body.receipt_storage_path || null;
  if (body.base64Receipt && body.fileName) {
    const cid = before.customerId || "general";
    const up = await uploadFileToCustomerStorage(
      cid,
      String(body.base64Receipt),
      String(body.fileName),
      body.mimeType as string | undefined
    );
    receiptUrl = up.url;
    receiptStoragePath = up.storagePath;
  }

  const payRow = {
    id: payId,
    invoice_id: invoiceId,
    amount,
    payment_method: paymentMethod,
    payment_date: paymentDate,
    reference_number: referenceNumber,
    receipt_url: receiptUrl,
    receipt_storage_path: receiptStoragePath,
    notes,
    recorded_by: username,
    created_at: new Date(nowMs).toISOString(),
  };

  if (!(await insertPaymentRow(payRow, localDb))) return replay();

  const paidTotal = await persistLedgerTotals(invoiceId, before.grandTotal, before.dueDate, username, localDb);

  try {
    await syncCostingSheetFromInvoice(invoiceId, paidTotal, localDb);
  } catch (err: any) {
    console.warn("[CostingPaymentSync]", err?.message || err);
  }

  return { payment: payRow, invoice: await getAdminInvoiceById(actor, invoiceId, localDb), replayed: false };
}

export async function fetchCustomerPortalInvoicesMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer not linked.", 403);

  if (isSupabaseActive()) {
    try {
      const { data, error } = await getSupabase()!
        .from("invoices")
        .select("*")
        .eq("customer_id", customerId)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      const out: InvoiceRecord[] = [];
      for (const row of data || []) {
        if (row.archived_at || String(row.invoice_status || "").toLowerCase() === "archived") continue;
        out.push(
          mapInvoiceRow(row, await loadItems(row.id, localDb), await loadPayments(row.id, localDb))
        );
      }
      const payableBalance = out.reduce((s, inv) => s + Number(inv.balanceDue || 0), 0);
      return { invoices: out, payableBalance: Math.round(payableBalance * 100) / 100 };
    } catch (err: any) {
      if (isInvoiceTableMissing(err)) return { invoices: [], payableBalance: 0 };
      throw err;
    }
  }

  const rows = ((localDb as any)?.invoices || []).filter(
    (r: any) =>
      (r.customer_id || r.customerId) === customerId &&
      !r.archived_at &&
      !r.archivedAt &&
      String(r.invoice_status || r.invoiceStatus || "").toLowerCase() !== "archived"
  );
  const out: InvoiceRecord[] = [];
  for (const row of rows) {
    out.push(mapInvoiceRow(row, await loadItems(row.id, localDb), await loadPayments(row.id, localDb)));
  }
  const payableBalance = out.reduce((s, inv) => s + Number(inv.balanceDue || 0), 0);
  return { invoices: out, payableBalance: Math.round(payableBalance * 100) / 100 };
}

export async function setInvoicePdfUrl(
  invoiceId: string,
  pdfUrl: string,
  localDb?: Database
) {
  const patch = { pdf_url: pdfUrl, updated_at: new Date().toISOString() };
  if (isSupabaseActive()) {
    await getSupabase()!.from("invoices").update(patch).eq("id", invoiceId);
  } else {
    const db = localDb as any;
    const idx = (db.invoices || []).findIndex((r: any) => r.id === invoiceId);
    if (idx >= 0) Object.assign(db.invoices[idx], patch);
  }
}

export async function syncInvoiceToCustomerDocuments(
  userId: string,
  username: string,
  role: string,
  invoice: InvoiceRecord,
  pdfUrl: string,
  localDb?: Database
) {
  if (!invoice.customerId) return null;
  const withUrl = pdfUrl ? { ...invoice, pdfUrl } : invoice;
  return syncInvoiceDocumentVault(withUrl, localDb);
}

export type ContractedLeadReadyRow = {
  leadId: string;
  customerName: string;
  phone: string;
  siteAddress: string;
  systemSize: string;
  quoteAmount: number;
  quotationId: string;
  quoteStatus: string;
  leadStatus: string;
  hasInvoice: boolean;
  invoiceId: string | null;
};

export async function findInvoiceByLeadAndQuote(
  leadId: string,
  quotationId: string,
  localDb?: Database
): Promise<InvoiceRecord | null> {
  if (!leadId || !quotationId) return null;
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("invoices")
      .select("*")
      .eq("lead_id", leadId)
      .eq("quotation_id", quotationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const row = (data || []).find((r) => !isInvoiceArchived(mapInvoiceRow(r)));
    if (!row) return null;
    return mapInvoiceRow(row, await loadItems(row.id, localDb), await loadPayments(row.id, localDb));
  }
  const row = ((localDb as any)?.invoices || []).find(
    (r: any) =>
      (r.lead_id || r.leadId) === leadId &&
      (r.quotation_id || r.quotationId) === quotationId &&
      !r.archived_at &&
      !r.archivedAt &&
      String(r.invoice_status || r.invoiceStatus || "").toLowerCase() !== "archived"
  );
  if (!row) return null;
  return mapInvoiceRow(row, await loadItems(row.id, localDb), await loadPayments(row.id, localDb));
}

export async function listContractedLeadsReadyForInvoice(
  actor: RequestActor,
  leads: any[],
  localDb?: Database
): Promise<ContractedLeadReadyRow[]> {
  await assertInvoiceStaff(actor, localDb);
  const allInvoices = await listAdminInvoices(actor, localDb, { includeArchived: false });

  const rows: ContractedLeadReadyRow[] = [];
  for (const lead of leads || []) {
    if (!isContractedLeadReady(lead)) continue;
    const quote = pickQuoteForInvoice(lead);
    if (!quote?.id) continue;
    const draft = buildInvoiceDraftFromLead(lead, quote);
    const existing = allInvoices.find(
      (inv) => inv.leadId === lead.id && inv.quotationId === quote.id && !isInvoiceArchived(inv)
    );
    rows.push({
      leadId: lead.id,
      customerName: lead.name,
      phone: lead.phone || "",
      siteAddress: draft.customerAddress,
      systemSize: draft.systemSize,
      quoteAmount: draft.quoteAmount,
      quotationId: quote.id,
      quoteStatus: quote.status || "Pending",
      leadStatus: lead.status,
      hasInvoice: !!existing,
      invoiceId: existing?.id || null,
    });
  }
  return rows.sort((a, b) => a.customerName.localeCompare(b.customerName));
}

function draftToCreateBody(draft: InvoiceDraftFromLead) {
  return {
    customerId: draft.customerId,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    customerAddress: draft.customerAddress,
    leadId: draft.leadId,
    quotationId: draft.quotationId,
    projectId: draft.projectId || null,
    paidAmount: 0,
    discountAmount: draft.discountAmount,
    items: draft.items,
    invoiceMeta: {
      project: {
        projectNumber: draft.projectNumber,
        systemSize: draft.systemSize,
        systemType: draft.systemType || undefined,
        panelBrand: draft.panelBrand || undefined,
        inverterBrand: draft.inverterBrand || undefined,
        batteryBrand: draft.batteryBrand || undefined,
        structureType: draft.structureType || undefined,
        netMeteringStatus: draft.netMeteringStatus || undefined,
        salesAdvisor: draft.salesAdvisor || undefined,
      },
    },
    terms: "System booked in COD basis.",
  };
}

export async function createInvoiceFromContractedLead(
  actor: RequestActor,
  body: { leadId: string; quotationId?: string; projectId?: string },
  leads: any[],
  localDb?: Database
): Promise<{ invoice: InvoiceRecord; existing: boolean }>;
export async function createInvoiceFromContractedLead(
  userId: string,
  username: string,
  role: string,
  body: { leadId: string; quotationId?: string; projectId?: string },
  leads: any[],
  localDb?: Database
): Promise<{ invoice: InvoiceRecord; existing: boolean }>;
export async function createInvoiceFromContractedLead(
  actorOrUserId: RequestActor | string,
  bodyOrUsername: { leadId: string; quotationId?: string; projectId?: string } | string,
  leadsOrRole?: any[] | string,
  localDbOrBody?: Database | { leadId: string; quotationId?: string; projectId?: string },
  leadsMaybe?: any[],
  localDbMaybe?: Database
): Promise<{ invoice: InvoiceRecord; existing: boolean }> {
  let actor: RequestActor;
  let body: { leadId: string; quotationId?: string; projectId?: string };
  let leads: any[];
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, String(bodyOrUsername), String(leadsOrRole || ""));
    body = (localDbOrBody || { leadId: "" }) as { leadId: string; quotationId?: string; projectId?: string };
    leads = leadsMaybe || [];
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    body = bodyOrUsername as { leadId: string; quotationId?: string; projectId?: string };
    leads = (leadsOrRole || []) as any[];
    localDb = localDbOrBody as Database | undefined;
  }

  const lead = (leads || []).find((l: any) => l.id === body.leadId);
  if (!lead) throw new InvoiceDbError("Lead not found.", 404);
  if (!["Contracted", "Installed"].includes(String(lead.status || ""))) {
    throw new InvoiceDbError("Lead must be Contracted or Installed to create an invoice.", 400);
  }

  const quote = body.quotationId
    ? (lead.quotes || []).find((q: any) => q.id === body.quotationId) || pickQuoteForInvoice(lead)
    : pickQuoteForInvoice(lead);
  if (!quote?.id) throw new InvoiceDbError("No quotation found for this lead.", 400);

  const existing = await findInvoiceByLeadAndQuote(lead.id, quote.id, localDb);
  if (existing) {
    return { invoice: existing, existing: true };
  }

  const draft = buildInvoiceDraftFromLead(lead, quote, { projectId: body.projectId });
  const invoice = await createAdminInvoice(actor, draftToCreateBody(draft), localDb);
  return { invoice, existing: false };
}

export async function bulkDeleteAdminInvoices(
  userId: string,
  username: string,
  role: string,
  body: { ids?: string[]; confirmText?: string },
  localDb?: Database
): Promise<{ deleted: string[]; failed: Array<{ id: string; error: string }> }> {
  const actor = toRequestActor(userId, username, role);
  if (actor.role !== "Super Admin") {
    throw new StaffPortalAuthError("Only Super Admin can bulk delete invoices.", 403);
  }
  if (String(body.confirmText || "").trim() !== "DELETE") {
    throw new InvoiceDbError('Type DELETE to confirm bulk deletion.', 400);
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) throw new InvoiceDbError("No invoice ids provided.", 400);

  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of ids) {
    try {
      await deleteAdminInvoice(actor, id, { confirmText: "DELETE" }, localDb);
      deleted.push(id);
    } catch (err: any) {
      failed.push({ id, error: err?.message || "Delete failed." });
    }
  }
  return { deleted, failed };
}

export async function archiveAdminInvoice(
  actor: RequestActor,
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function archiveAdminInvoice(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord>;
export async function archiveAdminInvoice(
  actorOrUserId: RequestActor | string,
  invoiceIdOrUsername: string,
  localDbOrRole?: Database | string,
  invoiceIdMaybe?: string,
  localDbMaybe?: Database
): Promise<InvoiceRecord> {
  let actor: RequestActor;
  let invoiceId: string;
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, invoiceIdOrUsername, String(localDbOrRole || ""));
    invoiceId = String(invoiceIdMaybe || "");
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    invoiceId = invoiceIdOrUsername;
    localDb = localDbOrRole as Database | undefined;
  }

  if (actor.role !== "Super Admin") {
    throw new StaffPortalAuthError("Only Super Admin can archive invoices.", 403);
  }
  await getAdminInvoiceById(actor, invoiceId, localDb);
  const username = actor.username;
  const patch = {
    archived_at: new Date().toISOString(),
    archived_by: username,
    invoice_status: "archived",
    updated_at: new Date().toISOString(),
    updated_by: username,
  };

  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("invoices").update(patch).eq("id", invoiceId);
    if (error) throw error;
  } else {
    const db = localDb as any;
    const idx = (db.invoices || []).findIndex((r: any) => r.id === invoiceId);
    if (idx >= 0) Object.assign(db.invoices[idx], patch);
  }

  const archived = await getAdminInvoiceById(actor, invoiceId, localDb);
  try {
    await hideInvoiceDocumentVault(archived, localDb);
  } catch (err: any) {
    console.warn("[InvoiceArchive] document hide:", err?.message || err);
  }
  return archived;
}

export async function deleteAdminInvoice(
  actor: RequestActor,
  invoiceId: string,
  body: { confirmText?: string },
  localDb?: Database
): Promise<{ ok: boolean; message: string }>;
export async function deleteAdminInvoice(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  body: { confirmText?: string },
  localDb?: Database
): Promise<{ ok: boolean; message: string }>;
export async function deleteAdminInvoice(
  actorOrUserId: RequestActor | string,
  invoiceIdOrUsername: string,
  bodyOrRole?: { confirmText?: string } | string,
  localDbOrInvoiceId?: Database | string,
  bodyMaybe?: { confirmText?: string },
  localDbMaybe?: Database
): Promise<{ ok: boolean; message: string }> {
  let actor: RequestActor;
  let invoiceId: string;
  let body: { confirmText?: string };
  let localDb: Database | undefined;

  if (typeof actorOrUserId === "string") {
    actor = toRequestActor(actorOrUserId, invoiceIdOrUsername, String(bodyOrRole || ""));
    invoiceId = String(localDbOrInvoiceId || "");
    body = bodyMaybe || {};
    localDb = localDbMaybe;
  } else {
    actor = actorOrUserId;
    invoiceId = invoiceIdOrUsername;
    body = (bodyOrRole || {}) as { confirmText?: string };
    localDb = localDbOrInvoiceId as Database | undefined;
  }

  if (actor.role !== "Super Admin") {
    throw new StaffPortalAuthError("Only Super Admin can permanently delete invoices.", 403);
  }
  if (String(body.confirmText || "").trim() !== "DELETE") {
    throw new InvoiceDbError('Type DELETE to confirm permanent deletion.', 400);
  }

  const inv = await getAdminInvoiceById(actor, invoiceId, localDb);
  const payments = await loadPayments(invoiceId, localDb);
  if (payments.length > 0) {
    throw new InvoiceDbError("Cannot delete an invoice that has payment records.", 409);
  }
  if (Number(inv.paidAmount || 0) > 0) {
    throw new InvoiceDbError("Cannot delete an invoice with recorded payments.", 409);
  }

  try {
    await unlinkInvoiceDocumentVault(inv, localDb);
  } catch (err: any) {
    console.warn("[InvoiceDelete] document unlink:", err?.message || err);
  }

  if (isSupabaseActive()) {
    await getSupabase()!.from("invoice_items").delete().eq("invoice_id", invoiceId);
    await getSupabase()!.from("invoice_payments").delete().eq("invoice_id", invoiceId);
    const { error } = await getSupabase()!.from("invoices").delete().eq("id", invoiceId);
    if (error) throw error;
  } else {
    const db = localDb as any;
    db.invoices = (db.invoices || []).filter((r: any) => r.id !== invoiceId);
    db.invoiceItems = (db.invoiceItems || []).filter(
      (r: any) => (r.invoice_id || r.invoiceId) !== invoiceId
    );
    db.invoicePayments = (db.invoicePayments || []).filter(
      (r: any) => (r.invoice_id || r.invoiceId) !== invoiceId
    );
  }

  return { ok: true, message: "Invoice permanently deleted." };
}
