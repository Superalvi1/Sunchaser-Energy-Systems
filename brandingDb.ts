import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import { assertSuperAdminActor, UserAuthError } from "./userAuthDb.js";
import { mergeBranding, type CompanyBranding } from "./src/lib/branding.ts";
import { scopedSettingKey, usesNeutralIdentity } from "./server/saas/companyIdentity.ts";

function brandingFromQuotePdfRow(row: Record<string, unknown> | null | undefined): CompanyBranding {
  const neutral = usesNeutralIdentity();
  return mergeBranding({
    companyName: (row?.company_name || row?.companyName) as string | undefined,
    officeAddress: (row?.office_address || row?.officeAddress) as string | undefined,
    phoneNumbers: (row?.hotline_phones || row?.hotlinePhones) as string | undefined,
    billingEmail: (row?.billing_email || row?.billingEmail) as string | undefined,
    websiteUrl: (row?.website_url || row?.websiteUrl) as string | undefined,
    logoUrl: (row?.logo_url || row?.logoUrl) as string | undefined,
  }, { neutral });
}

async function loadQuotePdfSettingsFromSupabase() {
  const { data, error } = await getSupabase()!
    .from("quote_pdf_settings")
    .select("*")
    .order("id", { ascending: true })
    .limit(1);
  if (error || !data?.length) return null;
  return data[0] as Record<string, unknown>;
}

export async function loadInvoiceBankAccountsFromSupabase() {
  const { data, error } = await getSupabase()!
    .from("bank_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("show_on_invoice", true)
    .order("sort_order", { ascending: true });
  if (error || !data?.length) return [];
  return data.map((ba: any) => ({
    id: ba.id,
    bankName: ba.bank_name,
    bank_name: ba.bank_name,
    accountTitle: ba.account_title || ba.title,
    account_title: ba.account_title || ba.title,
    accountNumber: ba.account_number || ba.accountNo,
    account_number: ba.account_number || ba.accountNo,
    iban: ba.iban,
    branchCode: ba.branch_code,
    isActive: ba.is_active !== false,
    is_active: ba.is_active !== false,
    showOnInvoice: !!(ba.show_on_invoice ?? ba.showOnInvoice),
    show_on_invoice: !!(ba.show_on_invoice ?? ba.showOnInvoice),
    sortOrder: Number(ba.sort_order || 0),
    sort_order: Number(ba.sort_order || 0),
  }));
}

export async function getCompanyBranding(localDb?: Database): Promise<CompanyBranding> {
  const neutral = usesNeutralIdentity();
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("settings")
      .select("value")
      .eq("key", scopedSettingKey("company_branding"))
      .maybeSingle();
    if (data?.value) return mergeBranding(data.value as Partial<CompanyBranding>, { neutral });

    const pdfRow = await loadQuotePdfSettingsFromSupabase();
    if (pdfRow) return brandingFromQuotePdfRow(pdfRow);
    // Another company that has saved nothing yet: empty branding, never the shared local copy and never Sunchaser's.
    if (neutral) return mergeBranding({}, { neutral });
  }

  if (!isSupabaseActive()) {
    const local = (localDb as any)?.settings?.companyBranding;
    if (local) return mergeBranding(local);
    const pdf = (localDb as any)?.quotePdfSettings?.[0];
    return brandingFromQuotePdfRow(pdf);
  }

  return mergeBranding({
    companyName: (localDb as any)?.settings?.companyName,
  });
}

export async function saveCompanyBranding(
  actorId: string,
  actorUsername: string,
  body: Partial<CompanyBranding>,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  return saveCompanyBrandingChecked(body, localDb);
}

/**
 * Saves branding for the company of the current context. The caller has already checked that the actor may do so (a company
 * administrator is checked against the role held in THIS company, see server/saas/companySettingsApi.ts).
 */
export async function saveCompanyBrandingChecked(body: Partial<CompanyBranding>, localDb?: Database) {
  const neutral = usesNeutralIdentity();
  const current = await getCompanyBranding(localDb);
  const { legacyDefaults: _ignored, ...incoming } = body as any;
  const next = mergeBranding({ ...current, ...incoming }, { neutral });
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!
      .from("settings")
      .upsert({ key: scopedSettingKey("company_branding"), value: next }, { onConflict: "key" });
    if (error) throw new Error(`Branding could not be saved: ${error.message}`);
  } else if (localDb) {
    (localDb as any).settings = { ...(localDb as any).settings, companyBranding: next };
  }
  return next;
}

export { UserAuthError };
