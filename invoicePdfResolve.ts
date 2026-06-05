import type { Database } from "./dbManager.js";
import { getCompanyBranding, loadInvoiceBankAccountsFromSupabase } from "./brandingDb.js";
import { withOfficialBranding } from "./src/lib/brandingAssets.ts";
import {
  OFFICIAL_CEO_SIGNATURE,
  LEGACY_CEO_SIGNATURE,
  OFFICIAL_INVOICE_LOGO,
} from "./src/lib/brandingAssets.ts";
import type { InvoiceRecord } from "./src/lib/invoices.ts";
import {
  decodeInvoiceMeta,
  type InvoicePdfMeta,
  type InvoiceProjectInfo,
} from "./src/lib/invoicePdfMeta.ts";
import { normalizeInvoiceBankAccounts, type BrandingConfig } from "./invoicePdf.ts";
import { isSupabaseActive, getSupabase } from "./dbManager.js";

export type InvoicePdfOptions = {
  project?: InvoiceProjectInfo;
  clientPhotoUrl?: string;
};

function fmtKw(n: unknown): string {
  const v = Number(n);
  if (!v || Number.isNaN(v)) return "";
  return `${v} kW`;
}

async function loadCustomerSystem(customerId: string, localDb?: Database) {
  if (!customerId) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customer_systems")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    return data;
  }
  return (localDb as any)?.customerSystems?.find(
    (s: any) => (s.customer_id || s.customerId) === customerId
  );
}

function projectFromSystem(row: any, projectId?: string | null): InvoiceProjectInfo {
  if (!row) {
    return { projectNumber: projectId || undefined };
  }
  return {
    projectNumber: projectId || row.project_id || row.projectId || undefined,
    systemSize: fmtKw(row.system_size_kw ?? row.systemSizeKw) || undefined,
    systemType: row.system_type || row.systemType || undefined,
    panelBrand: row.panel_brand || row.panelBrand || undefined,
    inverterBrand: row.inverter_brand || row.inverterBrand || undefined,
    batteryBrand: row.battery_brand || row.batteryBrand || undefined,
    structureType: row.structure_type || row.structureType || undefined,
    netMeteringStatus: row.net_metering_status || row.netMeteringStatus || undefined,
  };
}

function projectFromLead(lead: any): InvoiceProjectInfo {
  const q = lead?.quotes?.[lead.quotes.length - 1] || lead?.quotes?.[0];
  return {
    projectNumber: lead?.id,
    systemSize: fmtKw(q?.systemSizekW ?? q?.system_size_kw),
    systemType: q?.systemType || lead?.systemType,
    panelBrand: q?.panelBrand || q?.panelType,
    inverterBrand: q?.inverterBrand || q?.inverterType,
    batteryBrand: q?.batteryCapacity || q?.batteryBrand,
    structureType: q?.structureType,
    netMeteringStatus: lead?.netMeteringStatus,
  };
}

async function resolveCeoSignature(branding: BrandingConfig, localDb?: Database): Promise<string> {
  if (branding.signatureUrl?.trim()) return branding.signatureUrl.trim();
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("ceo_messages")
      .select("signature_url")
      .order("id", { ascending: true })
      .limit(1);
    const fromCeo = data?.[0]?.signature_url;
    if (fromCeo && String(fromCeo).trim()) return String(fromCeo).trim();
  }
  const ceo = (localDb as any)?.ceoMessages?.[0];
  const fromLocal = ceo?.signature_url || ceo?.signatureUrl;
  if (fromLocal && String(fromLocal).trim()) return String(fromLocal).trim();
  return OFFICIAL_CEO_SIGNATURE || LEGACY_CEO_SIGNATURE;
}

async function loadInvoiceBankAccounts(localDb?: Database) {
  if (isSupabaseActive()) {
    const rows = await loadInvoiceBankAccountsFromSupabase();
    if (rows.length) return rows;
  }
  return (localDb as any)?.bankAccounts || [];
}

export async function buildInvoicePdfPayload(
  invoice: InvoiceRecord,
  localDb?: Database
): Promise<{ invoice: InvoiceRecord; branding: BrandingConfig; options: InvoicePdfOptions }> {
  const rawBranding = await getCompanyBranding(localDb);
  const official = withOfficialBranding(rawBranding);
  const banks = normalizeInvoiceBankAccounts(await loadInvoiceBankAccounts(localDb));
  const signatureUrl = await resolveCeoSignature(official, localDb);

  const branding: BrandingConfig = {
    ...official,
    logoUrl: official.invoiceLogoUrl || official.logoUrl || OFFICIAL_INVOICE_LOGO,
    signatureUrl,
    signatureConfigured: !!signatureUrl?.trim(),
    bankAccounts: banks,
  };

  const meta = decodeInvoiceMeta(invoice.notes);
  let project = meta?.project;
  let clientPhotoUrl = meta?.clientPhotoUrl;

  if (!project || Object.values(project).every((v) => !v)) {
    const sysRow = invoice.customerId
      ? await loadCustomerSystem(invoice.customerId, localDb)
      : null;
    if (sysRow) {
      project = { ...projectFromSystem(sysRow, invoice.projectId), ...project };
    } else if (invoice.leadId && localDb) {
      const lead = (localDb as any).leads?.find((l: any) => l.id === invoice.leadId);
      if (lead) project = { ...projectFromLead(lead), ...project };
    } else if (invoice.projectId) {
      project = { projectNumber: invoice.projectId, ...project };
    }
  }

  return {
    invoice: {
      ...invoice,
      notes: invoice.notes,
    },
    branding,
    options: { project, clientPhotoUrl },
  };
}
