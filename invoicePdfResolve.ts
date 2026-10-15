import type { Database } from "./dbManager.js";
import { getCompanyBranding, loadInvoiceBankAccountsFromSupabase } from "./brandingDb.js";
import { withOfficialBranding } from "./src/lib/brandingAssets.ts";
import {
  OFFICIAL_CEO_SIGNATURE,
  LEGACY_CEO_SIGNATURE,
  OFFICIAL_INVOICE_LOGO,
} from "./src/lib/brandingAssets.ts";
import type { InvoiceIssuanceSnapshot, InvoiceRecord } from "./src/lib/invoices.ts";
import {
  decodeInvoiceMeta,
  type InvoicePdfMeta,
  type InvoiceProjectInfo,
} from "./src/lib/invoicePdfMeta.ts";
import { defaultInvoiceTerms, normalizeInvoiceBankAccounts, type BrandingConfig } from "./invoicePdf.ts";
import { isSupabaseActive, getSupabase } from "./dbManager.js";
import { usesNeutralIdentity } from "./server/saas/companyIdentity.ts";

export type InvoicePdfOptions = {
  project?: InvoiceProjectInfo;
  clientPhotoUrl?: string;
  /**
   * Where the bank accounts and company terms on this print come from. "snapshot": kept when the invoice was created.
   * "legacy_current_settings": the invoice predates snapshots, so they are the company's settings today (nothing is invented
   * for it); the staff API labels such invoices so nobody mistakes a reprint for a record of what was originally issued.
   */
  issuanceSource?: "snapshot" | "legacy_current_settings";
  issuanceCapturedAt?: string;
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
  // Another company signs with its own signature or not at all: never with the Sunchaser CEO's.
  if (usesNeutralIdentity()) {
    if (isSupabaseActive()) {
      const { data } = await getSupabase()!.from("ceo_messages").select("signature_url").order("id", { ascending: true }).limit(1);
      const own = data?.[0]?.signature_url;
      return own && String(own).trim() ? String(own).trim() : "";
    }
    return "";
  }
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
    // Another company without a visible account shows none; the shared local copy holds Sunchaser's accounts.
    if (usesNeutralIdentity()) return [];
  }
  if (usesNeutralIdentity()) return [];
  return (localDb as any)?.bankAccounts || [];
}

/**
 * What a new invoice keeps at creation: the bank accounts exactly as the template would print them now (including the existing
 * behaviour for the founding company) and the company-level terms. Never throws data away silently: a failure to read the settings
 * throws, and the caller decides (invoice creation then proceeds without a snapshot, i.e. as a legacy invoice).
 */
export async function captureInvoiceIssuanceSnapshot(localDb?: Database, now: Date = new Date()): Promise<InvoiceIssuanceSnapshot> {
  const official = withOfficialBranding(await getCompanyBranding(localDb));
  const neutral = official.legacyDefaults === false;
  const payloadBanks = normalizeInvoiceBankAccounts(await loadInvoiceBankAccounts(localDb), { neutral });
  const printed = normalizeInvoiceBankAccounts(payloadBanks, { neutral });
  return {
    version: 1,
    capturedAt: now.toISOString(),
    bankAccounts: printed.map((b) => ({
      bankName: b.bankName, accountTitle: b.accountTitle, accountNumber: b.accountNumber, iban: b.iban, sortOrder: b.sortOrder,
    })),
    companyTerms: String(official.terms || "").trim() || defaultInvoiceTerms(neutral),
  };
}

export async function buildInvoicePdfPayload(
  invoice: InvoiceRecord,
  localDb?: Database
): Promise<{ invoice: InvoiceRecord; branding: BrandingConfig; options: InvoicePdfOptions }> {
  const rawBranding = await getCompanyBranding(localDb);
  const official = withOfficialBranding(rawBranding);
  const banks = normalizeInvoiceBankAccounts(await loadInvoiceBankAccounts(localDb), { neutral: official.legacyDefaults === false });
  const signatureUrl = await resolveCeoSignature(official, localDb);

  const snapshot = invoice.issuanceSnapshot || null;
  const branding: BrandingConfig = {
    ...official,
    logoUrl: official.invoiceLogoUrl || official.logoUrl || (official.legacyDefaults === false ? "" : OFFICIAL_INVOICE_LOGO),
    signatureUrl,
    signatureConfigured: !!signatureUrl?.trim(),
    bankAccounts: banks,
    // An invoice created with a snapshot prints the accounts and terms it was issued with, not today's settings.
    ...(snapshot
      ? {
          bankAccounts: snapshot.bankAccounts.map((b) => ({ ...b, isActive: true, showOnInvoice: true })),
          terms: snapshot.companyTerms,
        }
      : {}),
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
    options: {
      project,
      clientPhotoUrl,
      issuanceSource: snapshot ? "snapshot" : "legacy_current_settings",
      ...(snapshot ? { issuanceCapturedAt: snapshot.capturedAt } : {}),
    },
  };
}
