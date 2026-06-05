import type { CompanyBranding } from "./branding";
import { DEFAULT_BRANDING } from "./branding";

/** Official uploaded Sunchaser logo (PNG in /public/assets). */
export const OFFICIAL_SUNCHASER_LOGO = "/assets/sunchaser-logo.png";
export const OFFICIAL_INVOICE_LOGO = "/assets/sunchaser-logo.png";
/** Primary invoice authorized signature (upload to public/assets/signature.png). */
export const OFFICIAL_CEO_SIGNATURE = "/assets/signature.png";
/** Legacy path kept for backwards compatibility. */
export const LEGACY_CEO_SIGNATURE = "/sunchaser-ceo-signature.png";
export const OFFICIAL_BANK_ACCOUNTS_IMAGE = "/sunchaser-bank-accounts.png";

/** Always use the official uploaded asset (ignores legacy SVG, icons, and remote placeholders). */
export function resolveOfficialLogoUrl(_url?: string | null): string {
  return OFFICIAL_SUNCHASER_LOGO;
}

export function withOfficialBranding(raw?: Partial<CompanyBranding> | null): CompanyBranding {
  const merged = { ...DEFAULT_BRANDING, ...(raw || {}) };
  const logo = resolveOfficialLogoUrl(merged.logoUrl);
  return {
    ...merged,
    logoUrl: logo,
    invoiceLogoUrl: resolveOfficialLogoUrl(merged.invoiceLogoUrl || merged.logoUrl),
    appIconUrl: resolveOfficialLogoUrl(merged.appIconUrl),
    splashImageUrl: resolveOfficialLogoUrl(merged.splashImageUrl),
    signatureUrl:
      String(merged.signatureUrl || "").trim() ||
      OFFICIAL_CEO_SIGNATURE ||
      LEGACY_CEO_SIGNATURE,
    bankAccountsImageUrl:
      String(merged.bankAccountsImageUrl || "").trim() || OFFICIAL_BANK_ACCOUNTS_IMAGE,
  };
}
