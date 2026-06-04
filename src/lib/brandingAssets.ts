import type { CompanyBranding } from "./branding";
import { DEFAULT_BRANDING } from "./branding";

/** Official uploaded Sunchaser logo (PNG in /public). */
export const OFFICIAL_SUNCHASER_LOGO = "/sunchaser-logo.png";

const LEGACY_LOGO_PATHS = ["/sunchaser-logo.svg", "", "icon-192.png", "icon-512.png"];

export function resolveOfficialLogoUrl(url?: string | null): string {
  const u = String(url || "").trim();
  if (u && !LEGACY_LOGO_PATHS.includes(u) && !/placeholder/i.test(u)) return u;
  return OFFICIAL_SUNCHASER_LOGO;
}

export function withOfficialBranding(raw?: Partial<CompanyBranding> | null): CompanyBranding {
  const merged = { ...DEFAULT_BRANDING, ...(raw || {}) };
  const logo = resolveOfficialLogoUrl(merged.logoUrl);
  return {
    ...merged,
    logoUrl: logo,
    appIconUrl: resolveOfficialLogoUrl(merged.appIconUrl),
    splashImageUrl: resolveOfficialLogoUrl(merged.splashImageUrl),
  };
}
