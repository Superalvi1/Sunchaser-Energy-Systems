import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import { assertSuperAdminActor, UserAuthError } from "./userAuthDb.js";
import { DEFAULT_BRANDING, mergeBranding, type CompanyBranding } from "./src/lib/branding.ts";

export async function getCompanyBranding(localDb?: Database): Promise<CompanyBranding> {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("settings")
      .select("value")
      .eq("key", "company_branding")
      .maybeSingle();
    if (data?.value) return mergeBranding(data.value as Partial<CompanyBranding>);
  }
  const local = (localDb as any)?.settings?.companyBranding;
  if (local) return mergeBranding(local);
  const pdf = (localDb as any)?.quotePdfSettings?.[0];
  return mergeBranding({
    companyName: pdf?.company_name || (localDb as any)?.settings?.companyName,
    officeAddress: pdf?.office_address,
    phoneNumbers: pdf?.hotline_phones,
    billingEmail: pdf?.billing_email,
    websiteUrl: pdf?.website_url,
    logoUrl: pdf?.logo_url || undefined,
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
