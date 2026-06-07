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
  canViewAllInvoices,
  computeInvoiceTotals,
  derivePaymentStatus,
  type InvoiceLineItem,
  type InvoicePaymentMethod,
  type InvoiceRecord,
} from "./src/lib/invoices.ts";
import { uploadFileToCustomerStorage } from "./customerProfileDb.js";
import { amountInWordsPkr } from "./src/lib/amountInWords.ts";
import {
  decodeInvoiceMeta,
  encodeInvoiceNotes,
  type InvoicePdfMeta,
} from "./src/lib/invoicePdfMeta.ts";
import { resolveInvoiceCustomerId } from "./invoiceCustomerLink.js";
import { coercePaymentMethod } from "./src/lib/invoicePayments.ts";
import { syncInvoiceDocumentVault } from "./customerDocumentSync.js";

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

async function assertInvoiceStaff(userId: string, username: string, localDb?: Database) {
  const { user, role } = await verifyStaffPortalUser(userId, username, localDb);
  if (!canCreateInvoice(user.username || username, role)) {
    throw new StaffPortalAuthError("You do not have permission to manage invoices.", 403);
  }
  return { user, role };
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
    return (data || []).map((row: any) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      amount: Number(row.amount),
      paymentMethod: row.payment_method,
      paymentDate: row.payment_date,
      referenceNumber: row.reference_number || null,
      receiptUrl: row.receipt_url || null,
      notes: row.notes || null,
      recordedBy: row.recorded_by || null,
      createdAt: row.created_at,
    }));
  }
  return ((localDb as any)?.invoicePayments || [])
    .filter((r: any) => (r.invoice_id || r.invoiceId) === invoiceId)
    .map((row: any) => ({
      id: row.id,
      invoiceId: row.invoice_id || row.invoiceId,
      amount: Number(row.amount),
      paymentMethod: row.payment_method || row.paymentMethod,
      paymentDate: row.payment_date || row.paymentDate,
      referenceNumber: row.reference_number || row.referenceNumber || null,
      receiptUrl: row.receipt_url || row.receiptUrl || null,
      notes: row.notes || null,
      recordedBy: row.recorded_by || row.recordedBy || null,
    }));
}

async function recalcPaidTotals(invoiceId: string, localDb?: Database) {
  const payments = await loadPayments(invoiceId, localDb);
  return payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}

async function insertPaymentRow(
  payRow: Record<string, unknown>,
  localDb?: Database
) {
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("invoice_payments").insert(payRow);
    if (error) throw error;
  } else {
    const db = localDb as any;
    db.invoicePayments = db.invoicePayments || [];
    db.invoicePayments.push(payRow);
  }
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
    id: `pay-init-${Date.now()}`,
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
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<InvoiceRecord[]> {
  await assertInvoiceStaff(userId, username, localDb);
  const viewAll = canViewAllInvoices(username, role);

  if (isSupabaseActive()) {
    try {
      let q = getSupabase()!.from("invoices").select("*").order("invoice_date", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const out: InvoiceRecord[] = [];
      for (const row of rows) {
        const items = await loadItems(row.id, localDb);
        const payments = await loadPayments(row.id, localDb);
        out.push(mapInvoiceRow(row, items, payments));
      }
      if (!viewAll) {
        return out.filter((inv) => inv.createdBy === username);
      }
      return out;
    } catch (err: any) {
      if (isInvoiceTableMissing(err)) return [];
      throw err;
    }
  }

  const rows = ((localDb as any)?.invoices || []).slice().reverse();
  const out: InvoiceRecord[] = [];
  for (const row of rows) {
    const items = await loadItems(row.id, localDb);
    const payments = await loadPayments(row.id, localDb);
    const inv = mapInvoiceRow(row, items, payments);
    if (viewAll || inv.createdBy === username) out.push(inv);
  }
  return out;
}

export async function getAdminInvoiceById(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  localDb?: Database
): Promise<InvoiceRecord> {
  await assertInvoiceStaff(userId, username, localDb);
  const viewAll = canViewAllInvoices(username, role);

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (error) throw new InvoiceDbError("Invoice not found.", 404);
    if (!viewAll && (data.created_by || data.createdBy) !== username) {
      throw new StaffPortalAuthError("Access denied.", 403);
    }
    const items = await loadItems(invoiceId, localDb);
    const payments = await loadPayments(invoiceId, localDb);
    return mapInvoiceRow(data, items, payments);
  }

  const row = ((localDb as any)?.invoices || []).find((r: any) => r.id === invoiceId);
  if (!row) throw new InvoiceDbError("Invoice not found.", 404);
  const inv = mapInvoiceRow(row, await loadItems(invoiceId, localDb), await loadPayments(invoiceId, localDb));
  if (!viewAll && inv.createdBy !== username) throw new StaffPortalAuthError("Access denied.", 403);
  return inv;
}

export async function createAdminInvoice(
  userId: string,
  username: string,
  role: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord> {
  await assertInvoiceStaff(userId, username, localDb);
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
    const { error } = await getSupabase()!.from("invoices").insert(row);
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

  const created = await getAdminInvoiceById(userId, username, role, id, localDb);
  try {
    await syncInvoiceDocumentVault(created, localDb);
  } catch (err: any) {
    console.warn("[InvoiceDocumentSync] create:", err?.message || err);
  }
  return created;
}

export async function updateAdminInvoice(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
): Promise<InvoiceRecord> {
  const existing = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);

  const rawItems = body.items as InvoiceLineItem[] | undefined;
  let patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: username,
  };

  if (rawItems) {
    const totals = computeInvoiceTotals(
      rawItems,
      Number(body.discountAmount ?? body.discount_amount ?? 0)
    );
    const paidAmount =
      body.paidAmount !== undefined || body.paid_amount !== undefined
        ? Number(body.paidAmount ?? body.paid_amount ?? 0)
        : existing.paidAmount;
    const balanceDue = Math.max(0, totals.grandTotal - paidAmount);
    patch = {
      ...patch,
      subtotal: totals.subtotal,
      discount_amount: totals.discountAmount,
      tax_amount: totals.taxAmount,
      grand_total: totals.grandTotal,
      paid_amount: paidAmount,
      balance_due: balanceDue,
      payment_status: derivePaymentStatus(
        totals.grandTotal,
        paidAmount,
        sanitizeDate(body.dueDate ?? body.due_date),
        body.paymentStatus as any
      ),
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
      await getSupabase()!.from("invoice_items").delete().eq("invoice_id", invoiceId);
      if (itemRows.length) await getSupabase()!.from("invoice_items").insert(itemRows);
    } else {
      const db = localDb as any;
      db.invoiceItems = (db.invoiceItems || []).filter(
        (r: any) => (r.invoice_id || r.invoiceId) !== invoiceId
      );
      db.invoiceItems.push(...itemRows);
    }
  }

  if (body.paidAmount !== undefined || body.paid_amount !== undefined) {
    const paidAmount = Number(body.paidAmount ?? body.paid_amount ?? 0);
    const balanceDue = Math.max(0, Math.round((existing.grandTotal - paidAmount) * 100) / 100);
    patch.paid_amount = paidAmount;
    patch.balance_due = balanceDue;
    patch.payment_status = derivePaymentStatus(
      existing.grandTotal,
      paidAmount,
      sanitizeDate(body.dueDate ?? body.due_date ?? existing.dueDate),
      body.paymentStatus as any
    );
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

  const updated = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);
  try {
    await syncInvoiceDocumentVault(updated, localDb);
  } catch (err: any) {
    console.warn("[InvoiceDocumentSync] update:", err?.message || err);
  }
  return updated;
}
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await getAdminInvoiceById(userId, username, role, invoiceId, localDb);
  const amount = Number(body.amount || 0);
  if (amount <= 0) throw new InvoiceDbError("Payment amount must be positive.");

  let receiptUrl = body.receiptUrl || body.receipt_url || null;
  let receiptStoragePath = body.receiptStoragePath || body.receipt_storage_path || null;
  if (body.base64Receipt && body.fileName) {
    const inv = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);
    const cid = inv.customerId || "general";
    const up = await uploadFileToCustomerStorage(
      cid,
      String(body.base64Receipt),
      String(body.fileName),
      body.mimeType as string | undefined
    );
    receiptUrl = up.url;
    receiptStoragePath = up.storagePath;
  }

  const payId = `pay-${Date.now()}`;
  const payRow = {
    id: payId,
    invoice_id: invoiceId,
    amount,
    payment_method: coercePaymentMethod(
      (body.paymentMethod || body.payment_method) as string | undefined
    ),
    payment_date:
      sanitizeDate(body.paymentDate ?? body.payment_date) ??
      new Date().toISOString().slice(0, 10),
    reference_number: body.referenceNumber || body.reference_number || null,
    receipt_url: receiptUrl,
    receipt_storage_path: receiptStoragePath,
    notes: body.notes || null,
    recorded_by: username,
    created_at: new Date().toISOString(),
  };

  await insertPaymentRow(payRow, localDb);

  const paidTotal = await recalcPaidTotals(invoiceId, localDb);
  const inv = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);
  const balanceDue = Math.max(0, inv.grandTotal - paidTotal);
  const paymentStatus = derivePaymentStatus(inv.grandTotal, paidTotal, inv.dueDate);

  const patch = {
    paid_amount: paidTotal,
    balance_due: balanceDue,
    payment_status: paymentStatus,
    updated_at: new Date().toISOString(),
    updated_by: username,
  };

  if (isSupabaseActive()) {
    await getSupabase()!.from("invoices").update(patch).eq("id", invoiceId);
  } else {
    const db = localDb as any;
    const idx = (db.invoices || []).findIndex((r: any) => r.id === invoiceId);
    if (idx >= 0) Object.assign(db.invoices[idx], patch);
  }

  return { payment: payRow, invoice: await getAdminInvoiceById(userId, username, role, invoiceId, localDb) };
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
    (r: any) => (r.customer_id || r.customerId) === customerId
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
