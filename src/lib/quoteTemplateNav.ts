/** Sidebar navigation for quote template workspace */

export const TEMPLATE_NAV_GLOBAL = "__global__";
export const TEMPLATE_NAV_BOQ = "__boq__";
export const TEMPLATE_NAV_STRUCTURE = "__structure__";

export type TemplateSidebarItem = {
  id: string;
  label: string;
  hint?: string;
  section?: string;
  indent?: boolean;
};

const PAGE_TYPE_LABELS: Record<string, string> = {
  cover: "Cover Page",
  profile: "Company Profile",
  qr: "Why Choose Us / QR",
  ceo: "CEO Message",
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
      return page.title.replace(/^Mounting Structure\s*-\s*/i, "").trim();
    }
    if (t === "terms1" || t === "terms2") return page.title || PAGE_TYPE_LABELS[t];
    return PAGE_TYPE_LABELS[t];
  }
  return page.title || t || "Custom Page";
}

export function isStructurePageType(pageType: string) {
  return pageType.startsWith("structure_");
}

function sortPages(pages: any[]) {
  return [...(pages || [])]
    .filter(Boolean)
    .sort((a, b) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0));
}

/** Ordered sidebar: Global → canonical pages → structure variants → BOQ */
export function buildTemplateSidebarItems(pages: any[]): TemplateSidebarItem[] {
  const sorted = sortPages(pages);
  const items: TemplateSidebarItem[] = [{ id: TEMPLATE_NAV_GLOBAL, label: "Global PDF Settings" }];

  const pick = (type: string) => sorted.find((p) => (p.page_type || p.pageType) === type);

  const singles: Array<{ type: string; label: string }> = [
    { type: "cover", label: "Cover Page" },
    { type: "profile", label: "Company Profile" },
    { type: "qr", label: "Why Choose Us / QR" },
    { type: "ceo", label: "CEO Message" },
  ];

  for (const { type, label } of singles) {
    const page = pick(type);
    if (page) {
      items.push({ id: page.id, label, hint: `#${page.sort_order || page.sortOrder || ""}` });
    }
  }

  const structurePages = sorted.filter((p) => isStructurePageType(String(p.page_type || p.pageType || "")));
  if (structurePages.length === 1) {
    items.push({
      id: structurePages[0].id,
      label: "Structure Config",
      hint: `#${structurePages[0].sort_order || structurePages[0].sortOrder || ""}`,
    });
  } else if (structurePages.length > 1) {
    for (const page of structurePages) {
      items.push({
        id: page.id,
        label: getTemplatePageNavLabel(page),
        hint: `#${page.sort_order || page.sortOrder || ""}`,
        section: "Structure Config",
        indent: true,
      });
    }
  }

  items.push({ id: TEMPLATE_NAV_BOQ, label: "BOQ Page" });

  for (const type of ["terms1", "terms2"] as const) {
    const page = pick(type);
    if (page) {
      items.push({
        id: page.id,
        label: type === "terms1" ? "Terms & Conditions" : "Terms & Conditions (cont.)",
        hint: `#${page.sort_order || page.sortOrder || ""}`,
      });
    }
  }

  const bank = pick("bank");
  if (bank) items.push({ id: bank.id, label: "Bank Details", hint: `#${bank.sort_order || bank.sortOrder || ""}` });

  const signoff = pick("signoff");
  if (signoff) {
    items.push({ id: signoff.id, label: "Client Sign-off", hint: `#${signoff.sort_order || signoff.sortOrder || ""}` });
  }

  const finalPage = pick("final");
  if (finalPage) {
    items.push({ id: finalPage.id, label: "Final Closing", hint: `#${finalPage.sort_order || finalPage.sortOrder || ""}` });
  }

  // Any custom pages not yet listed
  const listed = new Set(items.map((i) => i.id));
  for (const page of sorted) {
    if (listed.has(page.id)) continue;
    items.push({ id: page.id, label: getTemplatePageNavLabel(page), hint: `#${page.sort_order || page.sortOrder || ""}` });
  }

  return items;
}

export function isTemplateSpecialNav(id: string) {
  return id === TEMPLATE_NAV_GLOBAL || id === TEMPLATE_NAV_BOQ;
}
