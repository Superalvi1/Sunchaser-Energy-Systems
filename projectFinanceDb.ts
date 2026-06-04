import {
  isSupabaseActive,
  getSupabase,
  type Database,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  StaffPortalAuthError,
  CustomerPortalAuthError,
} from "./dbManager.js";
import {
  canViewProjectProfit,
  computeFinanceNumbers,
  toStaffSafeFinance,
  toCustomerPaymentView,
  type ProjectFinanceRecord,
  type PaymentStatus,
} from "./src/lib/projectFinance.ts";
import { buildWhatsAppMessageBody, type WhatsAppMessageType } from "./src/lib/whatsapp.ts";

export class ProjectFinanceDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFinanceDbError";
  }
}

function isPhase11TableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "42P01" ||
    msg.includes("project_finance_records") ||
    msg.includes("whatsapp_message_logs")
  );
}

function mapFinanceRow(row: any): ProjectFinanceRecord {
  return {
    id: row.id,
    customerId: row.customer_id || row.customerId,
    projectDeliveryId: row.project_delivery_id || row.projectDeliveryId || null,
    leadId: row.lead_id || row.leadId || null,
    quotationId: row.quotation_id || row.quotationId || null,
    saleValue: Number(row.sale_value ?? row.saleValue ?? 0),
    advanceReceived: Number(row.advance_received ?? row.advanceReceived ?? 0),
    balanceRemaining: Number(row.balance_remaining ?? row.balanceRemaining ?? 0),
    supplierCost: Number(row.supplier_cost ?? row.supplierCost ?? 0),
    installationCost: Number(row.installation_cost ?? row.installationCost ?? 0),
    transportCost: Number(row.transport_cost ?? row.transportCost ?? 0),
    miscExpense: Number(row.misc_expense ?? row.miscExpense ?? 0),
    totalExpense: Number(row.total_expense ?? row.totalExpense ?? 0),
    grossProfit: Number(row.gross_profit ?? row.grossProfit ?? 0),
    profitMarginPercent: Number(row.profit_margin_percent ?? row.profitMarginPercent ?? 0),
    paymentStatus: (row.payment_status || row.paymentStatus || "Unpaid") as PaymentStatus,
    notes: row.notes || null,
    createdBy: row.created_by || row.createdBy || null,
    updatedBy: row.updated_by || row.updatedBy || null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapWhatsAppLogRow(row: any) {
  return {
    id: row.id,
    customerId: row.customer_id || row.customerId || null,
    leadId: row.lead_id || row.leadId || null,
    projectDeliveryId: row.project_delivery_id || row.projectDeliveryId || null,
    phone: row.phone,
    messageType: row.message_type || row.messageType,
    messageBody: row.message_body || row.messageBody,
    sentBy: row.sent_by || row.sentBy,
    sentAt: row.sent_at || row.sentAt,
    status: row.status,
  };
}

function serializeFinance(record: ProjectFinanceRecord, role: string, username: string) {
  if (canViewProjectProfit(role, username)) return record;
  return toStaffSafeFinance(record);
}

async function assertSuperAdminFinanceUser(userId: string, username: string, localDb?: Database) {
  const { user, role } = await verifyStaffPortalUser(userId, username, localDb);
  if (!canViewProjectProfit(role, user.username || username)) {
    throw new StaffPortalAuthError("Project finance admin access is restricted to Super Admin allauddin.");
  }
  return { user, role };
}

function buildDbPayload(
  body: Record<string, unknown>,
  userId: string,
  id: string,
  isCreate: boolean
) {
  const computed = computeFinanceNumbers({
    saleValue: body.saleValue ?? body.sale_value,
    advanceReceived: body.advanceReceived ?? body.advance_received,
    supplierCost: body.supplierCost ?? body.supplier_cost,
    installationCost: body.installationCost ?? body.installation_cost,
    transportCost: body.transportCost ?? body.transport_cost,
    miscExpense: body.miscExpense ?? body.misc_expense,
    paymentStatus: (body.paymentStatus ?? body.payment_status) as string | undefined,
    forceOverdue:
      String(body.paymentStatus ?? body.payment_status ?? "").toLowerCase() === "overdue",
  });
  const now = new Date().toISOString();
  return {
    id,
    customer_id: String(body.customerId ?? body.customer_id ?? ""),
    project_delivery_id: body.projectDeliveryId ?? body.project_delivery_id ?? null,
    lead_id: body.leadId ?? body.lead_id ?? null,
    quotation_id: body.quotationId ?? body.quotation_id ?? null,
    sale_value: computed.saleValue,
    advance_received: computed.advanceReceived,
    balance_remaining: computed.balanceRemaining,
    supplier_cost: computed.supplierCost,
    installation_cost: computed.installationCost,
    transport_cost: computed.transportCost,
    misc_expense: computed.miscExpense,
    total_expense: computed.totalExpense,
    gross_profit: computed.grossProfit,
    profit_margin_percent: computed.profitMarginPercent,
    payment_status: computed.paymentStatus,
    notes: body.notes != null ? String(body.notes) : null,
    created_by: isCreate ? userId : undefined,
    updated_by: userId,
    created_at: isCreate ? now : undefined,
    updated_at: now,
  };
}

export async function fetchAdminFinanceSummary(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { role } = await assertSuperAdminFinanceUser(userId, username, localDb);
  const records = await loadAllFinanceRecords(localDb);
  const summary = {
    totalSales: 0,
    totalAdvanceReceived: 0,
    totalBalanceRemaining: 0,
    totalSupplierCost: 0,
    totalInstallationCost: 0,
    totalExpenses: 0,
    totalProfit: 0,
    profitMarginPercent: 0,
    projectCount: records.length,
  };
  for (const r of records) {
    summary.totalSales += r.saleValue;
    summary.totalAdvanceReceived += r.advanceReceived;
    summary.totalBalanceRemaining += r.balanceRemaining;
    summary.totalSupplierCost += r.supplierCost;
    summary.totalInstallationCost += r.installationCost;
    summary.totalExpenses += r.totalExpense;
    summary.totalProfit += r.grossProfit;
  }
  if (summary.totalSales > 0) {
    summary.profitMarginPercent = Number(
      ((summary.totalProfit / summary.totalSales) * 100).toFixed(2)
    );
  }
  return { summary, role };
}

async function loadAllFinanceRecords(localDb?: Database): Promise<ProjectFinanceRecord[]> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      if (isPhase11TableMissing(error)) throw new ProjectFinanceDbError("Finance tables not ready.");
      throw error;
    }
    return (data || []).map(mapFinanceRow);
  }
  return (localDb?.projectFinanceRecords || []).map(mapFinanceRow);
}

export async function listAdminFinanceProjects(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { role } = await assertSuperAdminFinanceUser(userId, username, localDb);
  const records = await loadAllFinanceRecords(localDb);
  return records.map((r) => serializeFinance(r, role, username));
}

export async function getAdminFinanceProjectById(
  userId: string,
  username: string,
  id: string,
  localDb?: Database
) {
  const { role } = await assertSuperAdminFinanceUser(userId, username, localDb);
  const record = await loadFinanceById(id, localDb);
  return serializeFinance(record, role, username);
}

async function loadFinanceById(id: string, localDb?: Database): Promise<ProjectFinanceRecord> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw new ProjectFinanceDbError("Finance record not found.");
    return mapFinanceRow(data);
  }
  const row = (localDb?.projectFinanceRecords || []).find((r: any) => r.id === id);
  if (!row) throw new ProjectFinanceDbError("Finance record not found.");
  return mapFinanceRow(row);
}

export async function createAdminFinanceProject(
  userId: string,
  username: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertSuperAdminFinanceUser(userId, username, localDb);
  const id = String(body.id || `fin-${Date.now()}`);
  const payload = buildDbPayload(body, userId, id, true);
  if (!payload.customer_id) throw new ProjectFinanceDbError("customerId is required.");

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (isPhase11TableMissing(error)) throw new ProjectFinanceDbError("Finance tables not ready.");
      throw error;
    }
    return mapFinanceRow(data);
  }

  if (!localDb) throw new ProjectFinanceDbError("Database unavailable.");
  if (!localDb.projectFinanceRecords) localDb.projectFinanceRecords = [];
  const row = {
    ...payload,
    customerId: payload.customer_id,
    projectDeliveryId: payload.project_delivery_id,
  };
  localDb.projectFinanceRecords.push(row);
  return mapFinanceRow(row);
}

export async function patchAdminFinanceProject(
  userId: string,
  username: string,
  id: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertSuperAdminFinanceUser(userId, username, localDb);
  const existing = await loadFinanceById(id, localDb);
  const merged = {
    ...existing,
    ...body,
    customerId: body.customerId ?? body.customer_id ?? existing.customerId,
    projectDeliveryId:
      body.projectDeliveryId ?? body.project_delivery_id ?? existing.projectDeliveryId,
    leadId: body.leadId ?? body.lead_id ?? existing.leadId,
    quotationId: body.quotationId ?? body.quotation_id ?? existing.quotationId,
    saleValue: body.saleValue ?? body.sale_value ?? existing.saleValue,
    advanceReceived: body.advanceReceived ?? body.advance_received ?? existing.advanceReceived,
    supplierCost: body.supplierCost ?? body.supplier_cost ?? existing.supplierCost,
    installationCost: body.installationCost ?? body.installation_cost ?? existing.installationCost,
    transportCost: body.transportCost ?? body.transport_cost ?? existing.transportCost,
    miscExpense: body.miscExpense ?? body.misc_expense ?? existing.miscExpense,
    paymentStatus: body.paymentStatus ?? body.payment_status ?? existing.paymentStatus,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  };
  const payload = buildDbPayload(merged, userId, id, false);
  delete (payload as any).created_at;
  delete (payload as any).created_by;
  Object.keys(payload).forEach((k) => {
    if ((payload as any)[k] === undefined) delete (payload as any)[k];
  });

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapFinanceRow(data);
  }

  if (!localDb?.projectFinanceRecords) throw new ProjectFinanceDbError("Database unavailable.");
  const idx = localDb.projectFinanceRecords.findIndex((r: any) => r.id === id);
  if (idx < 0) throw new ProjectFinanceDbError("Finance record not found.");
  localDb.projectFinanceRecords[idx] = { ...localDb.projectFinanceRecords[idx], ...payload };
  return mapFinanceRow(localDb.projectFinanceRecords[idx]);
}

export async function getStaffProjectPayments(
  userId: string,
  username: string,
  projectDeliveryId: string,
  localDb?: Database
) {
  const { role, user } = await verifyStaffPortalUser(userId, username, localDb);
  const record = await findFinanceByDeliveryId(projectDeliveryId, localDb);
  if (!record) {
    return { projectDeliveryId, finance: null };
  }
  return {
    projectDeliveryId,
    finance: serializeFinance(record, role, user.username || username),
  };
}

async function findFinanceByDeliveryId(
  projectDeliveryId: string,
  localDb?: Database
): Promise<ProjectFinanceRecord | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .select("*")
      .eq("project_delivery_id", projectDeliveryId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isPhase11TableMissing(error)) return null;
      throw error;
    }
    return data ? mapFinanceRow(data) : null;
  }
  const row = (localDb?.projectFinanceRecords || []).find(
    (r: any) => (r.project_delivery_id || r.projectDeliveryId) === projectDeliveryId
  );
  return row ? mapFinanceRow(row) : null;
}

async function loadCustomerReceiptDocs(customerId: string, localDb?: Database) {
  const types = new Set(["invoice", "receipt", "Invoice", "Receipt", "payment_receipt"]);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase
      .from("customer_documents")
      .select("*")
      .eq("customer_id", customerId)
      .order("uploaded_at", { ascending: false });
    return (data || [])
      .filter((d: any) => {
        const t = String(d.document_type || d.documentType || "").toLowerCase();
        return types.has(t) || t.includes("invoice") || t.includes("receipt");
      })
      .map((d: any) => ({
        id: d.id,
        title: d.title || d.file_name || "Document",
        fileUrl: d.file_url || d.fileUrl,
        documentType: d.document_type || d.documentType,
      }));
  }
  return (localDb?.customerDocuments || [])
    .filter(
      (d: any) =>
        (d.customerId === customerId || d.customer_id === customerId) &&
        types.has(String(d.documentType || d.document_type || ""))
    )
    .map((d: any) => ({
      id: d.id,
      title: d.title,
      fileUrl: d.fileUrl || d.file_url,
      documentType: d.documentType || d.document_type,
    }));
}

export async function fetchCustomerPortalPaymentsMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer account is not linked.");

  let records: ProjectFinanceRecord[] = [];
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_finance_records")
      .select("*")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false });
    if (error && !isPhase11TableMissing(error)) throw error;
    records = (data || []).map(mapFinanceRow);
  } else {
    records = (localDb?.projectFinanceRecords || [])
      .filter((r: any) => (r.customer_id || r.customerId) === customerId)
      .map(mapFinanceRow);
  }

  const receipts = await loadCustomerReceiptDocs(customerId, localDb);
  const projects = records.map((r) => toCustomerPaymentView(r, receipts));
  const totals = projects.reduce(
    (acc, p) => {
      acc.invoiceAmount += p.invoiceAmount;
      acc.amountPaid += p.amountPaid;
      acc.balanceRemaining += p.balanceRemaining;
      return acc;
    },
    { invoiceAmount: 0, amountPaid: 0, balanceRemaining: 0 }
  );

  return { customerId, totals, projects, receipts };
}

export async function logWhatsAppMessageOpened(
  userId: string,
  username: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await verifyStaffPortalUser(userId, username, localDb);
  const messageType = String(body.messageType || body.message_type || "quotation_sent");
  const vars = (body.vars || body.templateVars || {}) as Record<string, unknown>;
  const phone = String(body.phone || "");
  if (!phone) throw new ProjectFinanceDbError("phone is required.");

  let messageBody =
    String(body.messageBody || body.message_body || "") ||
    buildWhatsAppMessageBody(messageType as WhatsAppMessageType, vars as any);
  const ticketRef = body.supportTicketId ?? body.support_ticket_id;
  if (ticketRef) {
    messageBody = `[ticket:${ticketRef}] ${messageBody}`;
  }

  const id = `wa-${Date.now()}`;
  const row = {
    id,
    customer_id: body.customerId ?? body.customer_id ?? null,
    lead_id: body.leadId ?? body.lead_id ?? null,
    project_delivery_id: body.projectDeliveryId ?? body.project_delivery_id ?? null,
    phone,
    message_type: messageType,
    message_body: messageBody,
    sent_by: username,
    status: "Opened",
    sent_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("whatsapp_message_logs")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isPhase11TableMissing(error)) throw new ProjectFinanceDbError("WhatsApp log tables not ready.");
      throw error;
    }
    return mapWhatsAppLogRow(data);
  }

  if (!localDb) throw new ProjectFinanceDbError("Database unavailable.");
  if (!localDb.whatsappMessageLogs) localDb.whatsappMessageLogs = [];
  localDb.whatsappMessageLogs.push(row);
  return mapWhatsAppLogRow(row);
}

export async function listAdminWhatsAppLogs(
  userId: string,
  username: string,
  localDb?: Database
) {
  await assertSuperAdminFinanceUser(userId, username, localDb);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("whatsapp_message_logs")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(200);
    if (error) {
      if (isPhase11TableMissing(error)) return [];
      throw error;
    }
    return (data || []).map(mapWhatsAppLogRow);
  }
  return (localDb?.whatsappMessageLogs || []).map(mapWhatsAppLogRow).reverse().slice(0, 200);
}
