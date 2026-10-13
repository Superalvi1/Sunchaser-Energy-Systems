import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSavedQuoteTermsSnapshot } from "../../src/lib/quoteTermsSnapshot.ts";
import { unscopeSettingRows, usesNeutralIdentity } from "./companyIdentity.ts";
import { isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * What a quotation keeps of the company's settings at the moment it is first saved, so that changing the company's name, address,
 * contact details, logo, bank accounts, terms or price defaults later does not change a quotation that was already issued.
 * Prices of the quoted equipment are already stored on the quotation itself (its BOQ rows and totals); the snapshot adds the settings.
 *
 * Stored in quotations.extended_data.settingsSnapshot. Terms are frozen through the existing termsSnapshot mechanism.
 */
export type SettingsSnapshot = {
  version: 1;
  capturedAt: string;
  company: {
    companyName: string;
    officeAddress: string;
    phoneNumbers: string;
    billingEmail: string;
    websiteUrl: string;
    logoUrl: string;
  };
  bankAccounts: Array<{ bankName: string; accountTitle: string; accountNumber: string; iban: string }>;
  priceSettings: { currency: string; taxNote: string; validityDays: number | null };
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

async function rows(supabase: SupabaseClient, table: string): Promise<any[]> {
  const { data, error } = await supabase.from(table).select("*");
  return error || !data ? [] : data;
}

/** Reads the snapshot already stored on a quotation, if any. */
export async function readStoredSettingsSnapshot(supabase: SupabaseClient, quoteId: string): Promise<{ settingsSnapshot?: SettingsSnapshot; termsSnapshot?: unknown } | null> {
  if (!quoteId) return null;
  const { data, error } = await supabase.from("quotations").select("extended_data").eq("id", quoteId).maybeSingle();
  if (error || !data) return null;
  let ext: any = (data as any).extended_data;
  if (typeof ext === "string") {
    try { ext = JSON.parse(ext); } catch { ext = null; }
  }
  if (!ext || typeof ext !== "object") return null;
  return { settingsSnapshot: ext.settingsSnapshot || undefined, termsSnapshot: ext.termsSnapshot || undefined };
}

export async function captureSettingsSnapshot(
  supabase: SupabaseClient,
  quote: any,
  now: Date = new Date()
): Promise<{ settingsSnapshot: SettingsSnapshot; termsSnapshot: unknown }> {
  const neutral = usesNeutralIdentity();
  const [settingsRows, pdfRows, bankRows, termRows, templateRows, templatePageRows] = await Promise.all([
    rows(supabase, "settings"),
    rows(supabase, "quote_pdf_settings"),
    rows(supabase, "bank_accounts"),
    rows(supabase, "company_terms"),
    rows(supabase, "quote_templates"),
    rows(supabase, "quote_template_pages"),
  ]);
  const unscoped = unscopeSettingRows(settingsRows);
  const global = (unscoped.find((r: any) => r.key === "global") as any)?.value || {};
  const branding = (unscoped.find((r: any) => r.key === "company_branding") as any)?.value || {};
  const pdf = [...pdfRows].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || {};

  // Same precedence the renderer uses: the PDF settings row, then the branding, nothing else (no Sunchaser default for another company).
  const pick = (a: unknown, b: unknown) => str(a) || str(b);
  const company = {
    companyName: pick(pdf.company_name, branding.companyName),
    officeAddress: pick(pdf.office_address, branding.officeAddress),
    phoneNumbers: pick(pdf.hotline_phones, branding.phoneNumbers),
    billingEmail: pick(pdf.billing_email, branding.billingEmail),
    websiteUrl: pick(pdf.website_url, branding.websiteUrl),
    logoUrl: pick(pdf.logo_url, branding.logoUrl),
  };
  const bankAccounts = bankRows
    .filter((b: any) => b.is_active !== false)
    .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((b: any) => ({ bankName: str(b.bank_name), accountTitle: str(b.account_title), accountNumber: str(b.account_number), iban: str(b.iban) }));
  const validity = Number(global.quoteValidityDays ?? global.validityDays);
  const settingsSnapshot: SettingsSnapshot = {
    version: 1,
    capturedAt: now.toISOString(),
    company,
    bankAccounts,
    priceSettings: {
      currency: str(global.currencySettings),
      taxNote: str(global.taxSettings),
      validityDays: Number.isFinite(validity) && validity > 0 ? Math.floor(validity) : null,
    },
  };

  const miniState = {
    documentIdentity: { neutral },
    companyTerms: termRows,
    quoteTemplates: templateRows,
    quoteTemplatePages: templatePageRows,
    settings: global,
  };
  const termsSnapshot = buildSavedQuoteTermsSnapshot({
    existingSnapshot: quote?.termsSnapshot,
    selectedTemplateId: quote?.templateId || quote?.template_id,
    quoteDraft: quote,
    activeState: miniState,
    now,
  });
  return { settingsSnapshot, termsSnapshot };
}

/**
 * Called when a quotation is saved. A quotation that already has a snapshot (in the request or stored) keeps it untouched;
 * otherwise the current settings are frozen on it. Never throws: a failure to read the settings must not block saving a quotation,
 * and the quotation then simply has no snapshot yet (it is captured at its next save).
 */
export async function ensureSettingsSnapshot(supabase: SupabaseClient, quote: any, mode: "insert" | "upsert"): Promise<void> {
  // Single-company mode behaves exactly as before: nothing is added to a quotation.
  if (!isMultiCompanyEnabled()) return;
  if (!quote || quote.settingsSnapshot) return;
  try {
    if (mode === "upsert") {
      const stored = await readStoredSettingsSnapshot(supabase, String(quote.id || ""));
      if (stored?.settingsSnapshot) {
        quote.settingsSnapshot = stored.settingsSnapshot;
        if (!quote.termsSnapshot && stored.termsSnapshot) quote.termsSnapshot = stored.termsSnapshot;
        return;
      }
    }
    const captured = await captureSettingsSnapshot(supabase, quote);
    quote.settingsSnapshot = captured.settingsSnapshot;
    if (!quote.termsSnapshot) quote.termsSnapshot = captured.termsSnapshot;
  } catch (err) {
    console.warn("[settings-snapshot] not captured:", err instanceof Error ? err.message : err);
  }
}

