/** Shared quote template page rendering — used by live preview and PDF export. */

import {
  parseQuotePageExtendedSettings,
  resolveTypography,
  typographyStyleAttr,
  type QuoteGlobalTypography,
  type QuotePageExtendedSettings,
  type QuoteTypography,
} from "./quotePdfLayout";
import { renderPageBodyHtml } from "./quoteAuthoring";

export const QUOTE_PAGE_SAFE_PADDING = "18mm 18mm 16mm 18mm";

export type TemplatePageAuthoringState = {
  title?: string;
  body_text?: string;
  body_html?: string;
  imageSections?: QuotePageExtendedSettings["imageSections"];
  layoutMode?: string;
  densityMode?: QuoteTypography["densityMode"];
  fontSize?: string;
  lineHeight?: string;
  paragraphSpacing?: string;
  paddingTop?: string;
  paddingBottom?: string;
  contentWidth?: string;
  textAlign?: string;
  fontFamily?: string;
  headingColor?: string;
  bodyColor?: string;
};

export function hasTemplatePageBodyContent(
  ext: Pick<QuotePageExtendedSettings, "bodyHtml" | "bodyText" | "imageSections">
): boolean {
  if (ext.bodyHtml && String(ext.bodyHtml).trim()) return true;
  if (ext.bodyText && String(ext.bodyText).trim()) return true;
  if (Array.isArray(ext.imageSections) && ext.imageSections.some((s) => s?.imageUrl)) return true;
  return false;
}

export function pageStateToExtendedSettings(
  pageState: TemplatePageAuthoringState,
  globalTypography: QuoteGlobalTypography = {}
): QuotePageExtendedSettings {
  return {
    bodyText: pageState.body_text || "",
    bodyHtml: pageState.body_html || "",
    authoringPageType: "custom",
    layoutMode: pageState.layoutMode || "standard",
    coverLayoutMode: "classic",
    header: { mode: "inherit" },
    footer: { mode: "inherit" },
    bodyImages: [],
    imageSections: pageState.imageSections || [],
    typography: {
      densityMode: pageState.densityMode || globalTypography.densityMode || "normal",
      fontSize: pageState.fontSize || globalTypography.fontSize,
      lineHeight: pageState.lineHeight || globalTypography.lineHeight,
      paragraphSpacing: pageState.paragraphSpacing || globalTypography.paragraphSpacing,
      paddingTop: pageState.paddingTop || globalTypography.paddingTop,
      paddingBottom: pageState.paddingBottom || globalTypography.paddingBottom,
      contentWidth: pageState.contentWidth || globalTypography.contentWidth,
      textAlign: pageState.textAlign || globalTypography.textAlign,
      fontFamily: pageState.fontFamily || globalTypography.fontFamily,
      headingColor: pageState.headingColor || globalTypography.headingColor,
      bodyColor: pageState.bodyColor || globalTypography.bodyColor,
    },
    watermark: {},
  };
}

export function extendedSettingsFromDbBody(bodyTextContent: string): QuotePageExtendedSettings {
  return parseQuotePageExtendedSettings(bodyTextContent);
}

export function renderQuoteTemplatePage(
  ext: QuotePageExtendedSettings,
  globalTypography: QuoteGlobalTypography = {}
): {
  bodyHtml: string;
  typoStyle: string;
  typography: QuoteTypography & { fontFamily?: string; headingColor?: string; bodyColor?: string };
} {
  const typo = resolveTypography(ext, globalTypography);
  const typoStyle = typographyStyleAttr(typo);
  const mergedTypography = { ...globalTypography, ...ext.typography };
  const bodyHtml = renderPageBodyHtml(ext, {
    align: typo.textAlign,
    typography: mergedTypography,
  });
  return { bodyHtml, typoStyle, typography: typo };
}

export function typographyInlineStyle(
  typo: QuoteTypography & { fontFamily?: string; headingColor?: string; bodyColor?: string }
): Record<string, string> {
  return {
    fontFamily: typo.fontFamily || "Inter, 'Segoe UI', sans-serif",
    color: typo.bodyColor || "#475569",
    textAlign: typo.textAlign || "left",
    paddingTop: typo.paddingTop,
    paddingBottom: typo.paddingBottom,
    maxWidth: typo.contentWidth,
    "--quote-font-size": typo.fontSize,
    "--quote-line-height": typo.lineHeight,
    "--quote-para-gap": typo.paragraphSpacing,
    "--quote-heading-color": typo.headingColor || "#d97706",
  } as Record<string, string>;
}

export function buildLivePreviewPageStyle(
  typo: QuoteTypography & { fontFamily?: string; headingColor?: string; bodyColor?: string }
): Record<string, string> {
  return {
    width: "210mm",
    minHeight: "297mm",
    maxWidth: "100%",
    padding: QUOTE_PAGE_SAFE_PADDING,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    ...typographyInlineStyle(typo),
  };
}

export function sanitizeTemplatePdfFilename(title: string): string {
  return (
    String(title || "page")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 48) || "page"
  );
}
