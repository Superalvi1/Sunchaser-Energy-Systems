/** Manual quote PDF — template selection, page checklist, and debug mapping. */

import {
  getQuotePdfAppBaseUrl,
  OFFICIAL_QUOTE_LOGO_PATH,
  parseQuotePageExtendedSettings,
  resolvePageWatermark,
  resolvePdfAssetUrl,
  resolveQuotePdfAssetUrl,
  resolveQuotePdfLogoUrl,
} from "./quotePdfLayout";
import { hasTemplatePageBodyContent } from "./quoteTemplatePageRender";
import {
  resolveStoredGlobalWatermark,
  withResolvedGlobalWatermark,
  getSupabaseProjectUrlFromEnv,
} from "./quotePdfSettingsStore";

export { resolvePdfAssetUrl };

/** Checklist keys saved from Manual BOQ Builder. */
export const MANUAL_QUOTE_PAGE_CHECKLIST_KEYS = [
  "cover",
  "profile",
  "qr",
  "ceo",
  "structure",
  "boq",
  "terms",
  "signoff",
  "bank",
  "final",
] as const;

export const DEFAULT_MANUAL_QUOTE_INCLUDED_PAGES = [
  "cover",
  "profile",
  "qr",
  "ceo",
  "structure",
  "boq",
  "terms",
  "signoff",
  "bank",
  "final",
];

export function normalizeManualQuoteIncludedPages(
  pages?: string[] | null
): string[] {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [...DEFAULT_MANUAL_QUOTE_INCLUDED_PAGES];
  }
  const normalized = new Set<string>();
  for (const page of pages) {
    const key = String(page || "").trim();
    if (!key) continue;
    normalized.add(key);
    if (key === "terms") {
      normalized.add("terms1");
      normalized.add("terms2");
    }
    if (key === "structure") {
      normalized.add("structure_standard");
      normalized.add("structure_elevated");
      normalized.add("structure_girder");
      normalized.add("structure_custom");
    }
  }
  return Array.from(normalized);
}

export function isManualQuotePageIncluded(
  pageType: string,
  includedPages: string[]
): boolean {
  if (pageType === "terms1" || pageType === "terms2") {
    return includedPages.includes("terms") || includedPages.includes(pageType);
  }
  if (pageType.startsWith("structure_")) {
    return includedPages.includes("structure") || includedPages.includes(pageType);
  }
  return includedPages.includes(pageType);
}

export function getCompanyBrandingLogoUrl(activeState: { settings?: any[] }): string {
  const rows = activeState.settings || [];
  const row = rows.find((s: any) => s?.key === "companyLogo" || s?.key === "company_logo");
  const value = row?.value;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.url === "string") return value.url.trim();
  return "";
}

/** Logo resolution order for Playwright PDF export. */
export function resolvePdfLogoForExport(opts: {
  pageHeaderLogoUrl?: string | null;
  pageImageUrl?: string | null;
  globalPdfLogoUrl?: string | null;
  companyBrandingLogoUrl?: string | null;
  appBase?: string;
}): string {
  const base = opts.appBase || getQuotePdfAppBaseUrl();
  const candidates = [
    opts.pageHeaderLogoUrl,
    opts.pageImageUrl,
    opts.globalPdfLogoUrl,
    opts.companyBrandingLogoUrl,
    OFFICIAL_QUOTE_LOGO_PATH,
  ];
  for (const raw of candidates) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (/^data:image\//i.test(trimmed)) return trimmed;
    const resolved = resolveQuotePdfAssetUrl(trimmed, base);
    if (resolved) return resolved;
  }
  return resolveQuotePdfLogoUrl(OFFICIAL_QUOTE_LOGO_PATH, base);
}

export function resolveActiveStructurePageType(quoteObj: any): string {
  const selectedStructKey = String(
    quoteObj?.selectedStructure || quoteObj?.structureType || "standard"
  ).toLowerCase();
  if (selectedStructKey === "elevated") return "structure_elevated";
  if (selectedStructKey === "girder") return "structure_girder";
  if (selectedStructKey === "custom") return "structure_custom";
  return "structure_standard";
}

export function loadTemplatePagesForQuote(
  activeState: { quoteTemplatePages?: any[] },
  templateId: string
): any[] {
  const allDbPages = activeState.quoteTemplatePages || [];
  return allDbPages.filter(
    (p: any) => (p.templateId || p.template_id) === templateId
  );
}

export function buildManualQuoteTemplateDebugMap(
  activeState: any,
  quote: any,
  options: { templateId?: string; includedPages?: string[] } = {}
) {
  const quoteTemplateIdFromQuote = quote?.templateId || quote?.template_id || null;
  const selectedTemplateId = options.templateId || quoteTemplateIdFromQuote || "tmpl-1";
  const loadedTemplateId = selectedTemplateId;
  const includedPagesFromQuoteChecklist = normalizeManualQuoteIncludedPages(
    quote?.includedPages || options.includedPages
  );
  const dbPages = loadTemplatePagesForQuote(activeState, loadedTemplateId);
  const activeStructurePageType = resolveActiveStructurePageType(quote);
  const pdfRow = (activeState.quotePdfSettings || [])[0] || {};
  const appBase = getQuotePdfAppBaseUrl();
  const globalPdfLogo = resolveQuotePdfLogoUrl(
    pdfRow.logoUrl || pdfRow.logo_url,
    appBase
  );
  const companyLogo = getCompanyBrandingLogoUrl(activeState);
  const globalWatermark =
    resolveStoredGlobalWatermark(
      pdfRow as Record<string, unknown>,
      activeState.settings,
      getSupabaseProjectUrlFromEnv()
    ) ||
    withResolvedGlobalWatermark(
      (pdfRow.globalWatermark ||
        pdfRow.global_watermark ||
        pdfRow.globalPdfHeader?.watermark ||
        null) as any,
      getSupabaseProjectUrlFromEnv()
    );
  const globalWatermarkUrl = globalWatermark?.imageUrl
    ? resolveQuotePdfAssetUrl(String(globalWatermark.imageUrl), appBase)
    : null;

  const enabledDbPages = dbPages.filter((p: any) => {
    if (p.isEnabled === false || p.is_enabled === false) return false;
    const type = p.pageType || p.page_type || "";
    if (!isManualQuotePageIncluded(type, includedPagesFromQuoteChecklist)) return false;
    if (type.startsWith("structure_") && type !== activeStructurePageType) return false;
    return true;
  });

  const pagesList = [...enabledDbPages].sort(
    (a, b) =>
      Number(a.sortOrder || a.sort_order || 0) -
      Number(b.sortOrder || b.sort_order || 0)
  );

  const defaultProfileSnippet = "Sunchaser Energy operates under a unified consortium";
  const finalRenderedPages = pagesList.map((dbPage: any, index: number) => {
    const pageType = dbPage.pageType || dbPage.page_type || "";
    const rawBody = dbPage.bodyText || dbPage.body_text || "";
    const ext = parseQuotePageExtendedSettings(rawBody);
    const hasBodyHtml = !!(ext.bodyHtml && String(ext.bodyHtml).trim());
    const hasSavedBody = hasTemplatePageBodyContent(ext);
    const usedFallback =
      !hasSavedBody &&
      (pageType === "profile" || pageType === "qr") &&
      String(ext.bodyText || rawBody).includes(defaultProfileSnippet);
    const pageWm = resolvePageWatermark(ext.watermark, globalWatermark as any, {
      pdfRow,
      settingsRows: activeState.settings,
      baseUrl: getSupabaseProjectUrlFromEnv(),
    });
    const headerLogo =
      ext.header?.mode === "custom" ? String(ext.header.logoUrl || "") : "";
    const pageImage = dbPage.imageUrl || dbPage.image_url || "";
    const logoResolvedUrl = resolvePdfLogoForExport({
      pageHeaderLogoUrl: headerLogo,
      pageImageUrl: pageImage,
      globalPdfLogoUrl: globalPdfLogo,
      companyBrandingLogoUrl: companyLogo,
      appBase,
    });
    return {
      pageNumber: index + 1,
      sourcePageId: dbPage.id,
      pageType,
      title: dbPage.title || "",
      usedFallback,
      hasBodyHtml,
      hasSavedBody,
      hasLogo: !!logoResolvedUrl,
      hasWatermark: !!(pageWm?.imageUrl || globalWatermarkUrl),
    };
  });

  return {
    quoteId: quote?.id || null,
    quoteTemplateIdFromQuote,
    selectedTemplateId,
    loadedTemplateId,
    loadedPagesCount: dbPages.length,
    enabledPages: pagesList.map((p: any) => p.pageType || p.page_type),
    includedPagesFromQuoteChecklist,
    finalRenderedPages,
    logoResolvedUrl: resolvePdfLogoForExport({
      globalPdfLogoUrl: globalPdfLogo,
      companyBrandingLogoUrl: companyLogo,
      appBase,
    }),
    watermarkResolvedUrl: globalWatermarkUrl,
  };
}
