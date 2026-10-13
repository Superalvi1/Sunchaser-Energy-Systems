import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.js";
import { getCompanyBranding, saveCompanyBrandingChecked } from "../../brandingDb.ts";
import { getCompanyContext } from "./companyContext.ts";
import { scopedSettingKey, usesNeutralIdentity } from "./companyIdentity.ts";
import { FOUNDING_COMPANY_ID } from "./multiCompany.ts";

/**
 * Company settings for the pilot: branding, bank accounts, quotation terms and price settings, saved per company by the company's own
 * administrators. Everything goes through the tenant database role, so the database itself keeps one company out of another's rows.
 *
 *   GET /api/company/settings                    every staff member of the company
 *   PUT /api/company/settings/branding           Super Admin / Admin / Director of this company
 *   PUT /api/company/settings/bank-accounts      same
 *   PUT /api/company/settings/terms              same
 *   PUT /api/company/settings/prices             same (currency, tax note, quotation validity; equipment prices are the company's products)
 *
 * Quotations that were already saved keep the settings they were saved with (server/saas/settingsSnapshot.ts); changing a value here
 * changes later quotations only.
 */
const WRITE_ROLES = new Set(["Super Admin", "Admin", "Director"]);

const BRANDING_TEXT_FIELDS = ["companyName", "officeAddress", "phoneNumbers", "billingEmail", "websiteUrl", "terms", "googleReviewUrl"] as const;
const BRANDING_URL_FIELDS = ["logoUrl", "invoiceLogoUrl", "signatureUrl", "bankAccountsImageUrl", "appIconUrl", "splashImageUrl"] as const;
const BRANDING_COLOR_FIELDS = ["primaryColor", "secondaryColor", "accentColor"] as const;

export class SettingsInputError extends Error {
  readonly status = 400;
}

const clip = (v: unknown, max: number, field: string): string => {
  if (v == null) return "";
  if (typeof v !== "string") throw new SettingsInputError(`${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new SettingsInputError(`${field} is too long (limit ${max}).`);
  return t;
};

/** A link a document may show: this server's own paths, https links, or an embedded image. Nothing that can run script. */
function cleanUrl(v: unknown, field: string): string {
  const t = clip(v, 2048, field);
  if (!t) return "";
  if (/^\/(?!\/)/.test(t) || /^https:\/\//i.test(t) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(t)) return t;
  throw new SettingsInputError(`${field} must be an https link or a path on this server.`);
}

export function cleanBrandingInput(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") throw new SettingsInputError("Send the branding fields as a JSON object.");
  for (const f of BRANDING_TEXT_FIELDS) if (f in body) out[f] = clip(body[f], f === "terms" ? 4000 : 500, f);
  for (const f of BRANDING_URL_FIELDS) if (f in body) out[f] = cleanUrl(body[f], f);
  for (const f of BRANDING_COLOR_FIELDS) {
    if (!(f in body)) continue;
    const c = clip(body[f], 9, f);
    if (c && !/^#[0-9a-fA-F]{3,8}$/.test(c)) throw new SettingsInputError(`${f} must be a colour such as #1a2b4c.`);
    out[f] = c;
  }
  if ("officeLocations" in body) {
    if (!Array.isArray(body.officeLocations) || body.officeLocations.length > 20) throw new SettingsInputError("officeLocations must be a list of at most 20 addresses.");
    out.officeLocations = body.officeLocations.map((o: unknown) => clip(o, 300, "officeLocations")).filter(Boolean);
  }
  return out;
}

export type CleanBank = { id?: string; bankName: string; accountTitle: string; accountNumber: string; iban: string; branchCode: string; isActive: boolean; showOnInvoice: boolean; sortOrder: number };

export function cleanBankAccountsInput(body: any): CleanBank[] {
  const list = body?.accounts;
  if (!Array.isArray(list) || list.length > 30) throw new SettingsInputError("Send { accounts: [...] } with at most 30 accounts.");
  return list.map((a: any, i: number) => {
    const bankName = clip(a?.bankName, 120, "bankName");
    const accountTitle = clip(a?.accountTitle, 160, "accountTitle");
    const accountNumber = clip(a?.accountNumber, 64, "accountNumber");
    if (!bankName || !accountTitle || !accountNumber) throw new SettingsInputError(`Account ${i + 1}: bank name, account title and account number are required.`);
    const iban = clip(a?.iban, 64, "iban") || "N/A";
    return {
      bankName, accountTitle, accountNumber, iban,
      branchCode: clip(a?.branchCode, 32, "branchCode"),
      isActive: a?.isActive !== false,
      showOnInvoice: a?.showOnInvoice !== false,
      sortOrder: Number.isFinite(Number(a?.sortOrder)) ? Math.trunc(Number(a.sortOrder)) : i + 1,
    };
  });
}

export function cleanTermsInput(body: any): string[] {
  const list = body?.terms;
  if (!Array.isArray(list) || list.length > 60) throw new SettingsInputError("Send { terms: [...] } with at most 60 clauses.");
  return list.map((t: unknown) => clip(t, 1500, "term")).filter(Boolean);
}

export function cleanPriceSettingsInput(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") throw new SettingsInputError("Send the price settings as a JSON object.");
  if ("currencySettings" in body) out.currencySettings = clip(body.currencySettings, 60, "currencySettings");
  if ("taxSettings" in body) out.taxSettings = clip(body.taxSettings, 300, "taxSettings");
  if ("quoteValidityDays" in body) {
    const n = Number(body.quoteValidityDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new SettingsInputError("quoteValidityDays must be a whole number from 1 to 365.");
    out.quoteValidityDays = n;
  }
  return out;
}

function companyIdOf(): string {
  const ctx = getCompanyContext();
  return ctx?.kind === "company" ? ctx.companyId : FOUNDING_COMPANY_ID;
}

function requireWriter(req: Request, res: Response): boolean {
  const role = String((req as any).actor?.role || "");
  if (!WRITE_ROLES.has(role)) {
    res.status(403).json({ error: "Only a company administrator can change company settings." });
    return false;
  }
  return true;
}

async function readSettingsValue(supabase: SupabaseClient, key: string): Promise<Record<string, any>> {
  const { data } = await supabase.from("settings").select("value").eq("key", scopedSettingKey(key)).maybeSingle();
  return (data?.value as Record<string, any>) || {};
}

/** The company's PDF settings row (what quotations read for name, address, phones, e-mail, website, logo). One per company. */
function pdfSettingsId(): string {
  const id = companyIdOf();
  return id === FOUNDING_COMPANY_ID ? "settings-1" : `${id}_pdf_settings`;
}

async function mirrorBrandingToPdfSettings(supabase: SupabaseClient, b: Record<string, any>): Promise<void> {
  // The founding company's existing PDF settings row is edited in the admin screen as before; only other companies are mirrored here.
  if (!usesNeutralIdentity()) return;
  const row = {
    id: pdfSettingsId(),
    company_name: b.companyName || "",
    office_address: b.officeAddress || "",
    hotline_phones: b.phoneNumbers || "",
    billing_email: b.billingEmail || "",
    website_url: b.websiteUrl || "",
    logo_url: b.logoUrl || "",
    use_default_company_content: false,
  };
  const { error } = await supabase.from("quote_pdf_settings").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`PDF settings could not be saved: ${error.message}`);
}

async function listBankAccounts(supabase: SupabaseClient) {
  const { data } = await supabase.from("bank_accounts").select("*").order("sort_order", { ascending: true });
  return (data || []).map((b: any) => ({
    id: b.id, bankName: b.bank_name, accountTitle: b.account_title, accountNumber: b.account_number, iban: b.iban,
    branchCode: b.branch_code || "", isActive: b.is_active !== false, showOnInvoice: !!b.show_on_invoice, sortOrder: Number(b.sort_order || 0),
  }));
}

async function listTerms(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("company_terms").select("term_text, sort_order").order("sort_order", { ascending: true });
  return (data || []).map((t: any) => String(t.term_text || "")).filter(Boolean);
}

export async function loadCompanySettings() {
  const supabase = getSupabase()!;
  const branding = await getCompanyBranding();
  const global = await readSettingsValue(supabase, "global");
  return {
    companyId: companyIdOf(),
    branding,
    bankAccounts: await listBankAccounts(supabase),
    terms: await listTerms(supabase),
    priceSettings: {
      currencySettings: global.currencySettings ?? "",
      taxSettings: global.taxSettings ?? "",
      quoteValidityDays: global.quoteValidityDays ?? null,
    },
  };
}

function fail(res: Response, err: unknown) {
  if (err instanceof SettingsInputError) return res.status(400).json({ error: err.message });
  console.error("[company-settings]", err instanceof Error ? err.message : err);
  return res.status(500).json({ error: "Company settings could not be saved." });
}

export function registerCompanySettingsRoutes(app: Express): void {
  app.get("/api/company/settings", async (_req, res) => {
    try {
      if (!isSupabaseActive()) return res.status(503).json({ error: "Company settings need the database." });
      return res.json(await loadCompanySettings());
    } catch (err) { return fail(res, err); }
  });

  app.put("/api/company/settings/branding", async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
      if (!isSupabaseActive()) return res.status(503).json({ error: "Company settings need the database." });
      const saved = await saveCompanyBrandingChecked(cleanBrandingInput(req.body) as any);
      await mirrorBrandingToPdfSettings(getSupabase()!, saved as any);
      return res.json({ branding: saved });
    } catch (err) { return fail(res, err); }
  });

  app.put("/api/company/settings/bank-accounts", async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
      if (!isSupabaseActive()) return res.status(503).json({ error: "Company settings need the database." });
      const accounts = cleanBankAccountsInput(req.body);
      const supabase = getSupabase()!;
      const { data: existing } = await supabase.from("bank_accounts").select("id");
      const rows = accounts.map((a) => ({
        id: a.id || `bank_${randomUUID()}`,
        bank_name: a.bankName, account_title: a.accountTitle, account_number: a.accountNumber, iban: a.iban,
        branch_code: a.branchCode, is_active: a.isActive, show_on_invoice: a.showOnInvoice, sort_order: a.sortOrder,
      }));
      // Replace the list: write the new set first, then remove the rows that are no longer in it (a failure never leaves the company without accounts).
      if (rows.length) {
        const { error } = await supabase.from("bank_accounts").insert(rows);
        if (error) throw new Error(error.message);
      }
      const stale = (existing || []).map((r: any) => r.id);
      if (stale.length) {
        const { error } = await supabase.from("bank_accounts").delete().in("id", stale);
        if (error) throw new Error(error.message);
      }
      return res.json({ bankAccounts: await listBankAccounts(supabase) });
    } catch (err) { return fail(res, err); }
  });

  app.put("/api/company/settings/terms", async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
      if (!isSupabaseActive()) return res.status(503).json({ error: "Company settings need the database." });
      const terms = cleanTermsInput(req.body);
      const supabase = getSupabase()!;
      const { data: existing } = await supabase.from("company_terms").select("id");
      const rows = terms.map((t, i) => ({ id: `term_${randomUUID()}`, term_text: t, sort_order: i + 1 }));
      if (rows.length) {
        const { error } = await supabase.from("company_terms").insert(rows);
        if (error) throw new Error(error.message);
      }
      const stale = (existing || []).map((r: any) => r.id);
      if (stale.length) {
        const { error } = await supabase.from("company_terms").delete().in("id", stale);
        if (error) throw new Error(error.message);
      }
      return res.json({ terms: await listTerms(supabase) });
    } catch (err) { return fail(res, err); }
  });

  app.put("/api/company/settings/prices", async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
      if (!isSupabaseActive()) return res.status(503).json({ error: "Company settings need the database." });
      const patch = cleanPriceSettingsInput(req.body);
      const supabase = getSupabase()!;
      const current = await readSettingsValue(supabase, "global");
      const next = { ...current, ...patch };
      const { error } = await supabase.from("settings").upsert({ key: scopedSettingKey("global"), value: next }, { onConflict: "key" });
      if (error) throw new Error(error.message);
      return res.json({ priceSettings: { currencySettings: next.currencySettings ?? "", taxSettings: next.taxSettings ?? "", quoteValidityDays: next.quoteValidityDays ?? null } });
    } catch (err) { return fail(res, err); }
  });
}

