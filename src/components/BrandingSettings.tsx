import React, { useEffect, useState } from "react";
import { Image, Loader2, Save } from "lucide-react";
import { User } from "../types";
import { fetchCompanyBranding, updateAdminBranding } from "../services/api";
import { DEFAULT_BRANDING, type CompanyBranding } from "../lib/branding";
import AppLogo from "./AppLogo";

export default function BrandingSettings({ staffUser }: { staffUser: User }) {
  const [draft, setDraft] = useState<CompanyBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchCompanyBranding()
      .then((b) => setDraft({ ...DEFAULT_BRANDING, ...b }))
      .catch(() => setDraft(DEFAULT_BRANDING))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setMsg(null);
    try {
      const res = await updateAdminBranding(staffUser, draft as unknown as Record<string, unknown>);
      setDraft({ ...DEFAULT_BRANDING, ...res.branding });
      setMsg("Branding saved. Refresh app to see icons everywhere.");
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const field = (key: keyof CompanyBranding, label: string, type = "text") => (
    <label className="block text-xs text-neutral-400">
      {label}
      <input
        type={type}
        className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
        value={String(draft[key] || "")}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );

  if (loading) return <Loader2 className="animate-spin h-6 w-6 text-amber-400 m-6" />;

  return (
    <div className="space-y-6 p-2 max-w-2xl">
      <div className="flex items-center gap-4">
        <AppLogo logoUrl={draft.logoUrl} className="h-14 w-auto" />
        <div>
          <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            <Image className="h-5 w-5 text-amber-400" />
            Admin Settings → Branding
          </h2>
          <p className="text-xs text-neutral-500">Logo, colors, and app icon URLs (upload to Storage, paste URL)</p>
        </div>
      </div>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
      <div className="grid gap-3">
        {field("companyName", "Company name")}
        {field("officeAddress", "Address")}
        {field("phoneNumbers", "Phone")}
        {field("billingEmail", "Billing email")}
        {field("websiteUrl", "Website")}
        {field(
          "googleReviewUrl",
          "Google Review URL (customer portal — shown when project is complete)"
        )}
        {field("logoUrl", "Logo URL (login, sidebar)")}
        {field("invoiceLogoUrl", "Invoice gold logo URL (Premium Invoice v3)")}
        {field("signatureUrl", "CEO signature image URL (invoice footer)")}
        {field("bankAccountsImageUrl", "Bank accounts image URL (invoice page 2)")}
        {field("appIconUrl", "App icon URL (PWA / Android)")}
        {field("splashImageUrl", "Splash screen image URL")}
        {field("primaryColor", "Primary color", "color")}
        {field("secondaryColor", "Secondary color", "color")}
        <label className="block text-xs text-neutral-400">
          Default invoice terms
          <textarea
            className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 min-h-[80px]"
            value={draft.terms}
            onChange={(e) => setDraft((d) => ({ ...d, terms: e.target.value }))}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={save}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
      >
        <Save className="h-4 w-4" /> Save branding
      </button>
    </div>
  );
}
