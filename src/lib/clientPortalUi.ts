import { DEFAULT_BRANDING } from "./branding";

/** Visible on live portal — premium shell + all legacy modules merged. */
export const CUSTOMER_PORTAL_VERSION = "Customer Portal v2.2 Premium Merged";

/** Premium dark mobile portal (banking / Tesla / SolarEdge style). */
export const portal = {
  shell: "min-h-screen flex flex-col bg-[#0a0e17] text-slate-100",
  header: "safe-area-top sticky top-0 z-40 bg-[#0a0e17]/90 backdrop-blur-xl border-b border-white/[0.06]",
  main: "flex-1 w-full max-w-lg md:max-w-2xl mx-auto px-5 md:px-8 pt-5",
  mainWithNav: "pb-[calc(3.75rem+env(safe-area-inset-bottom,0px)+1rem)]",
  card: "rounded-3xl bg-[#121a2b] border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
  cardPad: "p-5",
  cardMuted: "rounded-2xl bg-white/[0.04] border border-white/[0.05]",
  label: "text-xs font-medium text-slate-500 tracking-wide uppercase",
  title: "text-2xl font-semibold text-white tracking-tight",
  titleSm: "text-lg font-semibold text-white",
  subtitle: "text-sm text-slate-400 leading-relaxed",
  heroMetric: "text-3xl font-bold text-white tabular-nums tracking-tight",
  value: "text-base font-semibold text-slate-100",
  nav: "fixed bottom-0 left-0 right-0 z-50 bg-[#0a0e17]/95 backdrop-blur-xl border-t border-white/[0.06] h-14",
  navInner:
    "max-w-lg md:max-w-2xl mx-auto h-14 flex items-center justify-around px-1 pb-[env(safe-area-inset-bottom,0px)]",
  navBtn: "flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 h-full transition-colors",
  navBtnActive: "text-[#f5a623]",
  navBtnIdle: "text-white/35",
  btnPrimary:
    "inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-sm px-5 py-3.5 shadow-lg shadow-amber-500/20 active:scale-[0.98] transition",
  btnSecondary:
    "inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.08] border border-white/[0.08] text-slate-100 font-semibold text-sm px-5 py-3.5 active:scale-[0.98] transition",
  btnGhost:
    "inline-flex items-center justify-center gap-2 rounded-2xl text-amber-400 font-semibold text-sm py-2",
  input:
    "w-full rounded-2xl bg-[#0a0e17] border border-white/[0.08] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30",
  divider: "border-t border-white/[0.06]",
} as const;

type PortalBrandLike = { legacyDefaults?: boolean; companyName?: string | null; googleReviewUrl?: string | null; phoneNumbers?: string | null } | null | undefined;

/** True for a company other than the founding one: nothing of Sunchaser's is ever shown to its customers. */
export function isNeutralPortal(branding?: PortalBrandLike): boolean {
  return branding?.legacyDefaults === false;
}

/** The company's own name; Sunchaser's only for Sunchaser. Empty when a company has not set one. */
export function portalCompanyName(branding?: PortalBrandLike): string {
  const own = String(branding?.companyName || "").trim();
  if (own) return own;
  return isNeutralPortal(branding) ? "" : "Sunchaser Energy Systems";
}

/** A short form for sentences ("Hello X"): the company name, or a neutral phrase for a company that set none. */
export function portalCompanyLabel(branding?: PortalBrandLike): string {
  return portalCompanyName(branding) || "your solar company";
}

/**
 * The review link. Sunchaser falls back to its own placeholder as before; any other company has a review link only if it set one, and
 * with none the review prompt is not shown (an empty string).
 */
export function resolveGoogleReviewUrl(branding?: PortalBrandLike): string {
  const url = String(branding?.googleReviewUrl || "").trim();
  if (url.startsWith("http")) return url;
  if (isNeutralPortal(branding)) return "";
  return DEFAULT_BRANDING.googleReviewUrl || SUNCHASER_GOOGLE_REVIEW_FALLBACK;
}

export const SUNCHASER_GOOGLE_REVIEW_FALLBACK =
  "https://search.google.com/local/writereview?placeid=ChIJSunchaserPlaceholder";

/** The company's first support number. Sunchaser's own number is the fallback for Sunchaser only; another company with none gets "" (no call or WhatsApp button). */
export function supportPhoneFromBranding(phones?: string, branding?: PortalBrandLike): string {
  const first = String(phones || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .find(Boolean);
  if (first) return first;
  return isNeutralPortal(branding) ? "" : "03090236666";
}

export function whatsAppHref(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  const num = digits.startsWith("92") ? digits : `92${digits.replace(/^0/, "")}`;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${num}${q}`;
}
