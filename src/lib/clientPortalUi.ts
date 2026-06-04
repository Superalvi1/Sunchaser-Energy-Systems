import { DEFAULT_BRANDING } from "./branding";

/** Visible on live portal — premium shell + all legacy modules merged. */
export const CUSTOMER_PORTAL_VERSION = "Customer Portal v2.2 Premium Merged";

/** Premium dark mobile portal (banking / Tesla / SolarEdge style). */
export const portal = {
  shell: "min-h-screen flex flex-col bg-[#0a0e17] text-slate-100",
  header: "sticky top-0 z-40 bg-[#0a0e17]/90 backdrop-blur-xl border-b border-white/[0.06]",
  main: "flex-1 w-full max-w-lg md:max-w-2xl mx-auto px-5 md:px-8 pt-5",
  mainWithNav: "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]",
  card: "rounded-3xl bg-[#121a2b] border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
  cardPad: "p-5",
  cardMuted: "rounded-2xl bg-white/[0.04] border border-white/[0.05]",
  label: "text-xs font-medium text-slate-500 tracking-wide uppercase",
  title: "text-2xl font-semibold text-white tracking-tight",
  titleSm: "text-lg font-semibold text-white",
  subtitle: "text-sm text-slate-400 leading-relaxed",
  heroMetric: "text-3xl font-bold text-white tabular-nums tracking-tight",
  value: "text-base font-semibold text-slate-100",
  nav: "fixed bottom-0 left-0 right-0 z-50 bg-[#0d121c]/95 backdrop-blur-xl border-t border-white/[0.08]",
  navInner:
    "max-w-lg md:max-w-2xl mx-auto flex items-stretch justify-around px-1 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom))]",
  navBtn: "flex flex-1 flex-col items-center gap-1 py-1.5 min-w-0 transition-colors",
  navBtnActive: "text-amber-400",
  navBtnIdle: "text-slate-500",
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

export function resolveGoogleReviewUrl(branding?: { googleReviewUrl?: string | null } | null): string {
  const url = String(branding?.googleReviewUrl || "").trim();
  if (url.startsWith("http")) return url;
  return DEFAULT_BRANDING.googleReviewUrl || SUNCHASER_GOOGLE_REVIEW_FALLBACK;
}

export const SUNCHASER_GOOGLE_REVIEW_FALLBACK =
  "https://search.google.com/local/writereview?placeid=ChIJSunchaserPlaceholder";

export function supportPhoneFromBranding(phones?: string): string {
  const first = String(phones || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .find(Boolean);
  return first || "03090236666";
}

export function whatsAppHref(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  const num = digits.startsWith("92") ? digits : `92${digits.replace(/^0/, "")}`;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${num}${q}`;
}
