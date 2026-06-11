import {
  getSupabase,
  isSupabaseActive,
  type Database,
} from "./dbManager.js";
import { generateCustomerCode } from "./customerCode.js";
import { pickQuoteForInvoice, resolveLeadCustomerId } from "./src/lib/invoiceFromLead.ts";
import { createInvoiceFromContractedLead } from "./invoiceDb.js";
import { provisionInternalCostingSheet } from "./internalCostingDb.js";
import { computeNetProposalValue, resolveQuoteDiscountAmount } from "./src/lib/quoteDiscount.ts";
import { filterBoqRowsForPdf, renderBoqTableBodyHtml } from "./src/lib/quoteBoqPdf.ts";

function resolveAutomationActor(localDb?: Database) {
  const users = (localDb as any)?.users || [];
  const hit =
    users.find((u: any) => String(u.username || "").toLowerCase() === "allauddin") ||
    users.find((u: any) => u.role === "Super Admin");
  if (hit) {
    return {
      userId: hit.id,
      username: hit.username,
      role: hit.role || "Super Admin",
    };
  }
  return {
    userId: "u-allauddin",
    username: "allauddin",
    role: "Super Admin",
  };
}

export type ContractProvisionResult = {
  customerId: string | null;
  projectId: string | null;
  invoiceId: string | null;
  invoiceExisting: boolean;
  paymentTrackEnsured: boolean;
  quoteId: string | null;
  costingSheetId: string | null;
  costingSheetExisting: boolean;
  skipped?: string;
};

function quoteNetAmount(quote: any): number {
  const rows = quote?.boqRows || quote?.boqItems || [];
  if (rows.length) {
    const filtered = filterBoqRowsForPdf(rows, { includeSizerItems: true });
    const { calculatedGross } = renderBoqTableBodyHtml(filtered, (n) => String(n));
    const discount = resolveQuoteDiscountAmount(calculatedGross, {
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discount: quote.discount,
    });
    const societyCharges = Number(quote.societyCharges) || 0;
    const taxEnabled = !!quote.taxEnabled;
    const taxRate = Number(quote.taxRate) || 0;
    const taxAmount = taxEnabled ? Math.round(calculatedGross * (taxRate / 100)) : 0;
    return computeNetProposalValue(calculatedGross, discount.discountAmount, {
      taxAmount,
      societyCharges,
    });
  }
  return Number(quote?.grandTotal ?? quote?.netCost ?? quote?.totalCost ?? 0);
}

async function customerExists(customerId: string, localDb?: Database): Promise<boolean> {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    return !!data?.id;
  }
  return ((localDb as any)?.customers || []).some((c: any) => c.id === customerId);
}

async function ensureCustomerForLead(lead: any, localDb?: Database): Promise<string> {
  const customerId = resolveLeadCustomerId(lead);
  const name = String(lead.name || "").trim();
  const email = String(lead.email || "").trim() || `lead+${customerId}@sunchaser.local`;
  const phone = String(lead.phone || "").trim();
  const address = String(lead.address || lead.location || "").trim() || null;

  if (await customerExists(customerId, localDb)) {
    const patch: Record<string, unknown> = { name, email, phone, address };
    if (isSupabaseActive()) {
      await getSupabase()!.from("customers").update(patch).eq("id", customerId);
    } else {
      const db = localDb as any;
      const idx = (db.customers || []).findIndex((c: any) => c.id === customerId);
      if (idx >= 0) Object.assign(db.customers[idx], patch);
    }
    return customerId;
  }

  const customerCode = await generateCustomerCode(localDb);
  const row = {
    id: customerId,
    name,
    email,
    phone,
    address,
    customer_code: customerCode,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("customers").insert(row);
    if (error) throw error;
  } else {
    const db = localDb as any;
    db.customers = db.customers || [];
    db.customers.push(row);
  }

  return customerId;
}

function findLocalProject(leadId: string, localDb?: Database) {
  return ((localDb as any)?.projects || []).find((p: any) => p.leadId === leadId) || null;
}

async function findSupabaseProject(supabase: ReturnType<typeof getSupabase>, leadId: string) {
  const { data } = await supabase!
    .from("projects")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data || [])[0] || null;
}

async function ensureProjectForLead(
  lead: any,
  quote: any,
  customerId: string,
  localDb?: Database,
  supabase?: ReturnType<typeof getSupabase>
): Promise<string> {
  const existing = supabase
    ? await findSupabaseProject(supabase, lead.id)
    : findLocalProject(lead.id, localDb);
  if (existing) return existing.id || existing.project_id;

  const projId = `project-${Date.now()}`;
  const sizeKw = Number(quote?.systemSizekW) || 0;
  const row = {
    id: projId,
    leadId: lead.id,
    lead_id: lead.id,
    quotation_id: quote?.id || null,
    customer_id: customerId,
    customer_name: lead.name,
    customerName: lead.name,
    address: lead.address || lead.location || "",
    system_size_kw: sizeKw,
    systemSizekW: sizeKw,
    stage: "Advance Received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    await supabase.from("projects").insert({
      id: projId,
      lead_id: lead.id,
      quotation_id: quote?.id || null,
      customer_id: customerId,
      customer_name: lead.name,
      address: row.address,
      system_size_kw: sizeKw,
      stage: "Advance Received",
    });
  } else {
    const db = localDb as any;
    db.projects = db.projects || [];
    db.projects.unshift({
      id: projId,
      leadId: lead.id,
      customerName: lead.name,
      address: row.address,
      systemSizekW: sizeKw,
      stage: "Advance Received",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  return projId;
}

function buildPaymentMilestones(costTotal: number) {
  const advanceAmt = Number((costTotal * 0.3).toFixed(2));
  return [
    { name: "30% Sign-up Advance", amount: advanceAmt, status: "Pending", dueDate: new Date().toISOString().split("T")[0] },
    {
      name: "30% Structural Engineering Approval",
      amount: advanceAmt,
      status: "Pending",
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
    {
      name: "30% Panel Arrays Completed",
      amount: advanceAmt,
      status: "Pending",
      dueDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
    {
      name: "10% Utility Interconnection Active",
      amount: Number((costTotal * 0.1).toFixed(2)),
      status: "Pending",
      dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
  ];
}

async function ensurePaymentTrack(
  lead: any,
  quote: any,
  projectId: string,
  customerId: string,
  localDb?: Database,
  supabase?: ReturnType<typeof getSupabase>
): Promise<boolean> {
  const costTotal = quoteNetAmount(quote) || Number(quote?.totalCost) || 0;
  const advanceAmt = Number((costTotal * 0.3).toFixed(2));
  const milestones = buildPaymentMilestones(costTotal);

  if (supabase) {
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (existing?.id) return false;

    await supabase.from("payments").insert({
      lead_id: lead.id,
      project_id: projectId,
      customer_id: customerId,
      total_value: costTotal,
      advance_received: 0,
      pending_amount: costTotal,
      invoice_status: "Draft",
      milestones: JSON.stringify(milestones),
    });
    return true;
  }

  const db = localDb as any;
  if (db.paymentTracks?.[lead.id]) return false;
  db.paymentTracks = db.paymentTracks || {};
  db.paymentTracks[lead.id] = {
    leadId: lead.id,
    totalValue: costTotal,
    advanceReceived: 0,
    pendingAmount: costTotal,
    reminderSent: false,
    invoiceStatus: "Draft",
    milestones,
  };
  return true;
}

function markQuoteAccepted(lead: any, quoteId: string) {
  lead.quotes = (lead.quotes || []).map((q: any) => {
    if (!q?.id) return q;
    if (q.id === quoteId) return { ...q, status: "Accepted" };
    if (q.status === "Accepted") return { ...q, status: "Pending" };
    return q;
  });
}

async function syncQuoteAccepted(
  leadId: string,
  quoteId: string,
  supabase?: ReturnType<typeof getSupabase>
) {
  if (!supabase) return;
  await supabase.from("quotations").update({ status: "Accepted" }).eq("id", quoteId);
  await supabase.from("quotations").update({ status: "Pending" }).eq("lead_id", leadId).neq("id", quoteId);
}

async function linkLeadCustomer(
  lead: any,
  customerId: string,
  localDb?: Database,
  supabase?: ReturnType<typeof getSupabase>
) {
  lead.customerId = customerId;
  lead.customer_id = customerId;

  if (supabase) {
    await supabase.from("leads").update({ customer_id: customerId }).eq("id", lead.id);
    return;
  }

  const db = localDb as any;
  const idx = (db.leads || []).findIndex((l: any) => l.id === lead.id);
  if (idx >= 0) {
    db.leads[idx].customerId = customerId;
    db.leads[idx].customer_id = customerId;
  }
}

/**
 * When a lead becomes Contracted: ensure customer, project, payment ledger, and invoice draft.
 * Idempotent — safe to call multiple times.
 */
export async function provisionContractToInvoiceWorkflow(
  lead: any,
  localDb: Database,
  options: {
    quotationId?: string;
    supabase?: ReturnType<typeof getSupabase>;
    actor?: { userId: string; username: string; role: string };
  } = {}
): Promise<ContractProvisionResult> {
  const supabase = options.supabase ?? (isSupabaseActive() ? getSupabase()! : undefined);
  const actor = options.actor || resolveAutomationActor(localDb);

  if (!["Contracted", "Installed"].includes(String(lead.status || ""))) {
    return {
      customerId: null,
      projectId: null,
      invoiceId: null,
      invoiceExisting: false,
      paymentTrackEnsured: false,
      quoteId: null,
      costingSheetId: null,
      costingSheetExisting: false,
      skipped: "Lead is not Contracted.",
    };
  }

  const quote =
    (options.quotationId
      ? (lead.quotes || []).find((q: any) => q.id === options.quotationId)
      : null) || pickQuoteForInvoice(lead);

  if (!quote?.id) {
    return {
      customerId: null,
      projectId: null,
      invoiceId: null,
      invoiceExisting: false,
      paymentTrackEnsured: false,
      quoteId: null,
      costingSheetId: null,
      costingSheetExisting: false,
      skipped: "No quotation on lead.",
    };
  }

  if (quote.status !== "Accepted") {
    markQuoteAccepted(lead, quote.id);
    await syncQuoteAccepted(lead.id, quote.id, supabase);
  }

  const customerId = await ensureCustomerForLead(lead, localDb);
  await linkLeadCustomer(lead, customerId, localDb, supabase);

  const projectId = await ensureProjectForLead(lead, quote, customerId, localDb, supabase);
  const paymentTrackEnsured = await ensurePaymentTrack(
    lead,
    quote,
    projectId,
    customerId,
    localDb,
    supabase
  );

  const { invoice, existing } = await createInvoiceFromContractedLead(
    actor.userId,
    actor.username,
    actor.role,
    { leadId: lead.id, quotationId: quote.id, projectId },
    [lead],
    localDb
  );

  let costingSheetId: string | null = null;
  let costingSheetExisting = false;
  try {
    const costing = await provisionInternalCostingSheet(
      {
        lead,
        quote,
        customerId,
        projectId,
        invoiceId: invoice?.id || null,
        amountReceived: Number(invoice?.paidAmount ?? (invoice as any)?.paid_amount ?? 0),
        actor,
      },
      localDb
    );
    costingSheetId = costing.sheetId;
    costingSheetExisting = costing.existing;
    if (costing.skipped && !costing.sheetId) {
      console.warn("[CostingProvision]", costing.skipped);
    }
  } catch (err: any) {
    console.warn("[CostingProvision]", err?.message || err);
  }

  return {
    customerId,
    projectId,
    invoiceId: invoice?.id || null,
    invoiceExisting: existing,
    paymentTrackEnsured,
    quoteId: quote.id,
    costingSheetId,
    costingSheetExisting,
  };
}
