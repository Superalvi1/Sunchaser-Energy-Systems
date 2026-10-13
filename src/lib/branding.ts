export type CompanyBranding = {
  companyName: string;
  officeAddress: string;
  officeLocations?: string[];
  phoneNumbers: string;
  billingEmail: string;
  websiteUrl: string;
  logoUrl: string;
  appIconUrl: string;
  splashImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  terms: string;
  signatureUrl?: string;
  googleReviewUrl?: string;
  /** Gold logo for premium invoices (defaults to official PNG). */
  invoiceLogoUrl?: string;
  /** Full-width bank accounts reference image for invoice page 2. */
  bankAccountsImageUrl?: string;
  /** false = another company's branding: no Sunchaser value is ever filled in (src/lib/documentIdentity.ts). */
  legacyDefaults?: boolean;
};

export const DEFAULT_OFFICE_LOCATIONS = [
  "Lahore: Plaza No. 47-MB, 2nd Floor, DHA Phase 6",
  "Rawalpindi: Office address",
  "Multan: Office address",
  "Faisalabad: Office address",
];

const LEGACY_BILLING_EMAIL = "billing@sunchaser-energy.com";
const LEGACY_WEBSITE_HOSTS = ["www.sunchaser-energy.com", "sunchaser-energy.com"];

export const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "Sunchaser Energy Systems",
  officeAddress: DEFAULT_OFFICE_LOCATIONS.join(" | "),
  officeLocations: DEFAULT_OFFICE_LOCATIONS,
  phoneNumbers: "0321-8486752, 0309-0236666",
  billingEmail: "ceo.sunchaser@gmail.com",
  websiteUrl: "www.sunchaserenergy.co",
  logoUrl: "/assets/sunchaser-logo.png",
  appIconUrl: "/assets/sunchaser-logo.png",
  splashImageUrl: "/assets/sunchaser-logo.png",
  primaryColor: "#7c6cf0",
  secondaryColor: "#1a2b4c",
  accentColor: "#c5a028",
  terms:
    "Payment is due by the due date. Bank transfer details are shown on the invoice. Thank you for choosing Sunchaser Energy Systems.",
  googleReviewUrl: "",
  invoiceLogoUrl: "/assets/sunchaser-logo.png",
  bankAccountsImageUrl: "/sunchaser-bank-accounts.png",
  signatureUrl: "/sunchaser-ceo-signature.png",
};

function normalizeLegacyContact(raw: Partial<CompanyBranding>): Partial<CompanyBranding> {
  const next = { ...raw };
  const email = String(next.billingEmail || "").trim().toLowerCase();
  if (!email || email === LEGACY_BILLING_EMAIL) {
    next.billingEmail = DEFAULT_BRANDING.billingEmail;
  }
  const site = String(next.websiteUrl || "").trim().toLowerCase();
  if (!site || LEGACY_WEBSITE_HOSTS.some((h) => site.includes(h))) {
    next.websiteUrl = DEFAULT_BRANDING.websiteUrl;
  }
  return next;
}

/** What a company that has set nothing yet gets: no name, address, contact, logo, signature, terms or bank image of anyone else. */
export const NEUTRAL_BRANDING: CompanyBranding = {
  companyName: "",
  officeAddress: "",
  officeLocations: [],
  phoneNumbers: "",
  billingEmail: "",
  websiteUrl: "",
  logoUrl: "",
  appIconUrl: "",
  splashImageUrl: "",
  primaryColor: "#334155",
  secondaryColor: "#0f172a",
  accentColor: "#64748b",
  terms: "",
  googleReviewUrl: "",
  invoiceLogoUrl: "",
  bankAccountsImageUrl: "",
  signatureUrl: "",
  legacyDefaults: false,
};

export function mergeBranding(raw?: Partial<CompanyBranding> | null, options?: { neutral?: boolean }): CompanyBranding {
  if (options?.neutral) {
    const own: Partial<CompanyBranding> = {};
    for (const [k, v] of Object.entries(raw || {})) if (v !== undefined && v !== null) (own as any)[k] = v;
    return { ...NEUTRAL_BRANDING, ...own, legacyDefaults: false };
  }
  return { ...DEFAULT_BRANDING, ...normalizeLegacyContact(raw || {}) };
}
