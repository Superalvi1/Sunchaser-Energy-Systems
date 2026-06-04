export type CompanyBranding = {
  companyName: string;
  officeAddress: string;
  phoneNumbers: string;
  billingEmail: string;
  websiteUrl: string;
  logoUrl: string;
  appIconUrl: string;
  splashImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  terms: string;
};

export const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "Sunchaser Energy Systems",
  officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
  phoneNumbers: "0309-0236666, 0330-7776444",
  billingEmail: "billing@sunchaser-energy.com",
  websiteUrl: "www.sunchaser-energy.com",
  logoUrl: "/sunchaser-logo.svg",
  appIconUrl: "/icon-192.png",
  splashImageUrl: "/sunchaser-logo.svg",
  primaryColor: "#f59e0b",
  secondaryColor: "#0f172a",
  terms:
    "Payment is due by the due date. Bank transfer details are shown on the invoice. Thank you for choosing Sunchaser.",
};

export function mergeBranding(raw?: Partial<CompanyBranding> | null): CompanyBranding {
  return { ...DEFAULT_BRANDING, ...(raw || {}) };
}
