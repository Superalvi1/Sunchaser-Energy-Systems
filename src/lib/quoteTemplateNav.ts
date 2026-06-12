/** Sidebar labels for quote template pages */

export const TEMPLATE_NAV_GLOBAL = "__global__";
export const TEMPLATE_NAV_BOQ = "__boq__";

const PAGE_TYPE_LABELS: Record<string, string> = {
  cover: "Cover Page",
  profile: "Company Profile",
  qr: "Why Choose Us / QR",
  ceo: "CEO Message",
  structure_standard: "Structure",
  structure_elevated: "Structure",
  structure_girder: "Structure",
  structure_custom: "Structure",
  terms1: "Terms & Conditions",
  terms2: "Terms & Conditions",
  signoff: "Client Sign-off",
  bank: "Bank Details",
  final: "Final Closing",
};

export function getTemplatePageNavLabel(page: {
  page_type?: string;
  pageType?: string;
  title?: string;
}): string {
  const t = String(page.page_type || page.pageType || "").trim();
  if (PAGE_TYPE_LABELS[t]) {
    if (t.startsWith("structure_") && page.title) {
      return `Structure — ${page.title.replace(/^Mounting Structure\s*-\s*/i, "").trim()}`;
    }
    if (t === "terms1" || t === "terms2") return page.title || PAGE_TYPE_LABELS[t];
    return PAGE_TYPE_LABELS[t];
  }
  return page.title || t || "Custom Page";
}

export function isStructurePageType(pageType: string) {
  return pageType.startsWith("structure_");
}
