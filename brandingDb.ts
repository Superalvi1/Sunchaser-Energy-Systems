import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import { assertSuperAdminActor, UserAuthError } from "./userAuthDb.js";
import { mergeBranding, type CompanyBranding } from "./src/lib/branding.ts";

function brandingFromQuotePdfRow(row: Record<string, unknown> | null | undefined): CompanyBranding {
  return mergeBranding({
    companyName: (row?.company_name || row?.companyName) as string | undefined,
    officeAddress: (row?.office_address || row?.officeAddress) as string | undefined,
    phoneNumbers: (row?.hotline_phones || row?.hotlinePhones) as string | undefined,
    billingEmail: (row?.billing_email || row?.billingEmail) as string | undefined,
    websiteUrl: (row?.website_url || row?.websiteUrl) as string | undefined,
    logoUrl: (row?.logo_url || row?.logoUrl) as string | undefined,
  });
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
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("settings")
      .select("value")
      .eq("key", "company_branding")
      .maybeSingle();
    if (data?.value) return mergeBranding(data.value as Partial<CompanyBranding>);

    const pdfRow = await loadQuotePdfSettingsFromSupabase();
    if (pdfRow) return brandingFromQuotePdfRow(pdfRow);
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
  const current = await getCompanyBranding(localDb);
  const next = mergeBranding({ ...current, ...body });
  if (isSupabaseActive()) {
    await getSupabase()!
      .from("settings")
      .upsert({ key: "company_branding", value: next }, { onConflict: "key" });
  } else if (localDb) {
    (localDb as any).settings = { ...(localDb as any).settings, companyBranding: next };
  }
  return next;
}

export { UserAuthError };
