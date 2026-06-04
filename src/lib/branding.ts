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
};

export const DEFAULT_OFFICE_LOCATIONS = [
  "Lahore: Plaza No. 47-MB, 2nd Floor, DHA Phase 6",
  "Rawalpindi: Office address",
  "Multan: Office address",
  "Faisalabad: Office address",
];

export const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "Sunchaser Energy Systems",
  officeAddress: DEFAULT_OFFICE_LOCATIONS.join(" | "),
  officeLocations: DEFAULT_OFFICE_LOCATIONS,
  phoneNumbers: "0321-8486752, 0309-0236666",
  billingEmail: "ceo.sunchaser@gmail.com",
  websiteUrl: "www.sunchaser-energy.com",
  logoUrl: "/sunchaser-logo.png",
  appIconUrl: "/sunchaser-logo.png",
  splashImageUrl: "/sunchaser-logo.png",
  primaryColor: "#7c6cf0",
  secondaryColor: "#1a2b4c",
  accentColor: "#c5a028",
  terms:
    "Payment is due by the due date. Bank transfer details are shown on the invoice. Thank you for choosing Sunchaser Energy Systems.",
  googleReviewUrl: "",
  invoiceLogoUrl: "/sunchaser-logo.png",
  bankAccountsImageUrl: "/sunchaser-bank-accounts.png",
  signatureUrl: "/sunchaser-ceo-signature.png",
};

export function mergeBranding(raw?: Partial<CompanyBranding> | null): CompanyBranding {
  return { ...DEFAULT_BRANDING, ...(raw || {}) };
}
