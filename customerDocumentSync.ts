import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import { mapDocumentRow } from "./src/lib/clientPortalPhase2.ts";
import type { InvoiceRecord } from "./src/lib/invoices.ts";

function apiPublicBase(): string {
  return (
    process.env.APP_PUBLIC_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.API_BASE_URL ||
    ""
  ).replace(/\/$/, "");
}

export function vaultInvoiceDocumentUrl(invoiceId: string): string {
  const path = `/api/export/pdf/invoice/${encodeURIComponent(invoiceId)}`;
  const base = apiPublicBase();
  return base ? `${base}${path}` : path;
}

export function vaultQuotationDocumentUrl(leadId: string, quoteId: string): string {
  const path = `/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}?quoteId=${encodeURIComponent(quoteId)}`;
  const base = apiPublicBase();
  return base ? `${base}${path}` : path;
}

export function vaultWarrantyCertificateDocumentUrl(customerId: string): string {
  const path = `/api/admin/customers/${encodeURIComponent(customerId)}/warranty-certificate`;
  const base = apiPublicBase();
  return base ? `${base}${path}` : path;
}

async function upsertVaultCustomerDocument(
  body: {
    customerId: string;
    documentType: string;
    title: string;
    fileUrl: string;
    fileName?: string;
    uploadedBy?: string;
    notes?: string;
  },
  localDb?: Database
) {
  const customerId = String(body.customerId || "").trim();
  if (!customerId || !body.fileUrl) return null;

  const now = new Date().toISOString();
  const doc = {
    id: `doc-${Date.now()}`,
    customer_id: customerId,
    project_id: null,
    document_type: body.documentType,
    title: body.title || body.documentType,
    file_url: body.fileUrl,
    file_name: body.fileName || null,
    mime_type: "text/html",
    storage_path: null,
    visible_to_customer: true,
    internal_only: false,
    notes: body.notes || null,
    uploaded_by: body.uploadedBy || "system-sync",
    uploaded_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: existing } = await supabase
      .from("customer_documents")
      .select("id")
      .eq("customer_id", customerId)
      .eq("document_type", body.documentType)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from("customer_documents")
        .update({
          title: doc.title,
          file_url: doc.file_url,
          file_name: doc.file_name,
          visible_to_customer: true,
          internal_only: false,
          notes: doc.notes,
          uploaded_by: doc.uploaded_by,
          uploaded_at: now,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return mapDocumentRow(data);
    }
    const { data, error } = await supabase.from("customer_documents").insert(doc).select("*").single();
    if (error) throw error;
    return mapDocumentRow(data);
  }

  const db = localDb as any;
  db.customerDocuments = db.customerDocuments || [];
  const idx = db.customerDocuments.findIndex(
    (d: any) =>
      (d.customer_id || d.customerId) === customerId &&
      (d.document_type || d.documentType) === body.documentType
  );
  const mapped = {
    ...doc,
    customerId: doc.customer_id,
    documentType: doc.document_type,
    fileUrl: doc.file_url,
    visibleToCustomer: true,
    internalOnly: false,
  };
  if (idx >= 0) {
    db.customerDocuments[idx] = { ...db.customerDocuments[idx], ...mapped, uploadedAt: now };
    return mapDocumentRow(db.customerDocuments[idx]);
  }
  db.customerDocuments.unshift(mapped);
  return mapDocumentRow(mapped);
}

export async function syncInvoiceDocumentVault(invoice: InvoiceRecord, localDb?: Database) {
  if (!invoice.customerId || !invoice.id) return null;
  if (invoice.archivedAt || String(invoice.invoiceStatus || "").toLowerCase() === "archived") {
    return hideInvoiceDocumentVault(invoice, localDb);
  }
  const fileUrl = invoice.pdfUrl || vaultInvoiceDocumentUrl(invoice.id);
  return upsertVaultCustomerDocument(
    {
      customerId: invoice.customerId,
      documentType: "invoice",
      title: `Invoice ${invoice.invoiceNumber}`,
      fileUrl,
      fileName: `${invoice.invoiceNumber}.html`,
      notes: `Grand total PKR ${Number(invoice.grandTotal || 0).toLocaleString()}`,
    },
    localDb
  );
}

export async function hideInvoiceDocumentVault(invoice: InvoiceRecord, localDb?: Database) {
  if (!invoice.customerId || !invoice.id) return null;
  const needle = invoice.id;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: rows } = await supabase
      .from("customer_documents")
      .select("id, file_url")
      .eq("customer_id", invoice.customerId)
      .eq("document_type", "invoice");
    const matches = (rows || []).filter((r: any) => String(r.file_url || "").includes(needle));
    for (const row of matches) {
      await supabase
        .from("customer_documents")
        .update({ visible_to_customer: false, internal_only: true })
        .eq("id", row.id);
    }
    return matches[0] || null;
  }
  const db = localDb as any;
  const docs = db.customerDocuments || [];
  let hit = null;
  for (const d of docs) {
    const url = d.file_url || d.fileUrl || "";
    if (
      (d.customer_id || d.customerId) === invoice.customerId &&
      (d.document_type || d.documentType) === "invoice" &&
      (url.includes(invoice.id) || url === needle)
    ) {
      d.visible_to_customer = false;
      d.visibleToCustomer = false;
      d.internal_only = true;
      d.internalOnly = true;
      hit = d;
    }
  }
  return hit;
}

export async function unlinkInvoiceDocumentVault(invoice: InvoiceRecord, localDb?: Database) {
  if (!invoice.customerId || !invoice.id) return null;
  const needle = invoice.id;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: rows } = await supabase
      .from("customer_documents")
      .select("id, file_url")
      .eq("customer_id", invoice.customerId)
      .eq("document_type", "invoice");
    const matches = (rows || []).filter((r: any) => String(r.file_url || "").includes(needle));
    for (const row of matches) {
      await supabase.from("customer_documents").delete().eq("id", row.id);
    }
    return matches.length;
  }
  const db = localDb as any;
  const before = (db.customerDocuments || []).length;
  db.customerDocuments = (db.customerDocuments || []).filter((d: any) => {
    const url = d.file_url || d.fileUrl || "";
    const isMatch =
      (d.customer_id || d.customerId) === invoice.customerId &&
      (d.document_type || d.documentType) === "invoice" &&
      url.includes(needle);
    return !isMatch;
  });
  return before - (db.customerDocuments || []).length;
}

export async function syncQuotationDocumentVault(
  opts: {
    customerId: string;
    leadId: string;
    quoteId: string;
    title?: string;
    notes?: string;
  },
  localDb?: Database
) {
  const customerId = String(opts.customerId || "").trim();
  if (!customerId || !opts.leadId || !opts.quoteId) return null;
  return upsertVaultCustomerDocument(
    {
      customerId,
      documentType: "quotation_pdf",
      title: opts.title || `Quotation ${opts.quoteId}`,
      fileUrl: vaultQuotationDocumentUrl(opts.leadId, opts.quoteId),
      fileName: `quotation-${opts.quoteId}.html`,
      notes: opts.notes,
    },
    localDb
  );
}

export async function syncWarrantyCertificateDocumentVault(
  opts: { customerId: string; documentId: string },
  localDb?: Database
) {
  const customerId = String(opts.customerId || "").trim();
  if (!customerId) return null;
  return upsertVaultCustomerDocument(
    {
      customerId,
      documentType: "warranty_certificate",
      title: "Warranty Certificate",
      fileUrl: vaultWarrantyCertificateDocumentUrl(customerId),
      fileName: `warranty-certificate-${customerId}.html`,
      notes: `Document ID: ${opts.documentId}`,
      uploadedBy: "warranty-sync",
    },
    localDb
  );
}
