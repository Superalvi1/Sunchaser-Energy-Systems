/** Quotation PDF layout, rich text, typography, and proposal data helpers. */

import {
  type WatermarkPlacement,
  type WatermarkStyleInput,
  watermarkLayerStyleAttr,
} from "./watermarkStyles";
import {
  resolveStoredGlobalWatermark,
  withResolvedGlobalWatermark,
  type GlobalWatermarkValue,
} from "./quotePdfSettingsStore";

export type QuoteTypography = {
  fontSize: string;
  lineHeight: string;
  paragraphSpacing: string;
  paddingTop: string;
  paddingBottom: string;
  contentWidth: string;
  textAlign: string;
  densityMode: "compact" | "normal" | "spacious";
};

export type QuoteWatermark = WatermarkStyleInput & {
  imageUrl?: string;
  position?: WatermarkPlacement;
  repeat?: "no-repeat" | "repeat";
};

export type CeoSignatureBlock = {
  leftName?: string;
  leftTitle?: string;
  leftSignatureUrl?: string;
  rightName?: string;
  rightTitle?: string;
  rightSignatureUrl?: string;
};

export const DEFAULT_CEO_SIGNATURE_BLOCK: CeoSignatureBlock = {
  leftName: "Muhammad Allauddin",
  leftTitle: "CEO",
  leftSignatureUrl: "",
  rightName: "Barrister Raza Khan Niazi",
  rightTitle: "CEO Strategy & Innovation",
  rightSignatureUrl: "",
};

export type SignatureRoleSettings = {
  enabled?: boolean;
  name?: string;
  title?: string;
  signatureUrl?: string;
  signatureFile?: string;
};

export type EnhancedSignatureBlock = CeoSignatureBlock & {
  ceo?: SignatureRoleSettings;
  technicalDirector?: SignatureRoleSettings;
  salesAdvisor?: SignatureRoleSettings;
};

export type QuoteImageSection = {
  id: string;
  layout: "full_width" | "left_image" | "right_image" | "center";
  imageUrl: string;
  widthPercent?: number;
  textHtml?: string;
};

export type QuoteGlobalTypography = {
  fontFamily?: string;
  fontSize?: string;
  headingColor?: string;
  bodyColor?: string;
  lineHeight?: string;
  densityMode?: QuoteTypography["densityMode"];
  paragraphSpacing?: string;
  paddingTop?: string;
  paddingBottom?: string;
  contentWidth?: string;
  textAlign?: string;
};

export const DEFAULT_TEMPLATE_TYPOGRAPHY: Required<
  Pick<QuoteGlobalTypography, "fontFamily" | "fontSize" | "lineHeight" | "bodyColor" | "headingColor">
> = {
  fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
  fontSize: "13px",
  lineHeight: "1.55",
  bodyColor: "#1f2937",
  headingColor: "#d97706",
};

export type QuotePageExtendedSettings = {
  bodyText: string;
  bodyHtml?: string;
  authoringPageType?: string;
  layoutMode: string;
  coverLayoutMode: "classic" | "modern";
  header: Record<string, unknown>;
  footer: Record<string, unknown>;
  bodyImages: any[];
  imageSections?: QuoteImageSection[];
  typography: Partial<QuoteTypography & QuoteGlobalTypography> & {
    densityMode?: QuoteTypography["densityMode"];
  };
  watermark: QuoteWatermark;
  signatureBlock?: EnhancedSignatureBlock;
};

const DENSITY_PRESETS: Record<QuoteTypography["densityMode"], Omit<QuoteTypography, "densityMode">> = {
  compact: {
    fontSize: "10px",
    lineHeight: "1.45",
    paragraphSpacing: "8px",
    paddingTop: "10mm",
    paddingBottom: "12mm",
    contentWidth: "100%",
    textAlign: "left",
  },
  normal: {
    fontSize: "13px",
    lineHeight: "1.55",
    paragraphSpacing: "12px",
    paddingTop: "12mm",
    paddingBottom: "14mm",
    contentWidth: "100%",
    textAlign: "left",
  },
  spacious: {
    fontSize: "12px",
    lineHeight: "1.75",
    paragraphSpacing: "16px",
    paddingTop: "14mm",
    paddingBottom: "16mm",
    contentWidth: "92%",
    textAlign: "left",
  },
};

export function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BULLET_LINE =
  /^(\s*[-•*]\s+|\s*[✅🌞☀️🏗️🌐]\s*)/u;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.endsWith(":")) return true;
  if (t.length > 72) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  return t === t.toUpperCase() && !t.includes(".");
}

function parseMarkdownHeadingLine(line: string): { level: 2 | 3; text: string } | null {
  const t = line.trim();
  if (t.startsWith("### ")) return { level: 3, text: t.slice(4).trim() };
  if (t.startsWith("## ")) return { level: 2, text: t.slice(3).trim() };
  return null;
}

function renderSignatureColumn(name: string, title: string, signatureUrl: string): string {
  const sigImage = signatureUrl
    ? `<img src="${escapeHtml(signatureUrl)}" alt="" style="max-height:18mm;max-width:100%;object-fit:contain;margin:0 auto 6px;display:block;" />`
    : `<div style="height:14mm;border-bottom:1.5px solid #cbd5e1;margin-bottom:8px;"></div>`;
  return `
    <div style="text-align:center;padding:0 8mm;">
      ${sigImage}
      <div style="font-weight:800;font-size:12px;color:#0f172a;margin-bottom:2px;">${escapeHtml(name)}</div>
      <div style="font-size:9px;text-transform:uppercase;color:#d97706;font-weight:700;letter-spacing:0.06em;">${escapeHtml(title)}</div>
    </div>
  `;
}

export function buildCeoSignatureBlockHtml(
  block?: CeoSignatureBlock | null,
  ceoFallback?: Array<{ name?: string; designation?: string; signature_url?: string; signatureUrl?: string }>
): string {
  const fb = ceoFallback || [];
  const merged = {
    leftName: block?.leftName || fb[0]?.name || DEFAULT_CEO_SIGNATURE_BLOCK.leftName || "",
    leftTitle: block?.leftTitle || fb[0]?.designation || DEFAULT_CEO_SIGNATURE_BLOCK.leftTitle || "",
    leftSignatureUrl:
      block?.leftSignatureUrl || fb[0]?.signature_url || fb[0]?.signatureUrl || "",
    rightName: block?.rightName || fb[1]?.name || DEFAULT_CEO_SIGNATURE_BLOCK.rightName || "",
    rightTitle: block?.rightTitle || fb[1]?.designation || DEFAULT_CEO_SIGNATURE_BLOCK.rightTitle || "",
    rightSignatureUrl:
      block?.rightSignatureUrl || fb[1]?.signature_url || fb[1]?.signatureUrl || "",
  };

  return `
    <div class="ceo-signature-block" style="margin-top:18mm;padding-top:12mm;border-top:1.5px solid #e2e8f0;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16mm;align-items:end;">
        ${renderSignatureColumn(merged.leftName, merged.leftTitle, merged.leftSignatureUrl)}
        ${renderSignatureColumn(merged.rightName, merged.rightTitle, merged.rightSignatureUrl)}
      </div>
    </div>
  `;
}

/**
 * Convert plain textarea content into structured HTML blocks.
 * - ## Heading → H2 (gold, bold)
 * - ### Subheading → H3 (dark blue, bold)
 * - Single newline → line break within paragraph
 * - Blank line → new paragraph
 * - Bullet lines → ul/li
 * - ALL CAPS or trailing ":" → legacy section heading
 */
export function renderRichTextBlock(
  text: string,
  opts?: { align?: string; className?: string }
): string {
  if (!text || !String(text).trim()) return "";
  const normalized = String(text).replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const parts: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;

    const bulletLines = lines.filter((l) => BULLET_LINE.test(l.trim()) || /^[•✅🌞☀️🏗️🌐]/.test(l.trim()));
    if (bulletLines.length === lines.length) {
      parts.push(
        `<ul class="quote-bullet-list">${lines
          .map((line) => {
            const cleaned = line.trim().replace(BULLET_LINE, "").replace(/^[•]\s*/, "");
            return `<li>${escapeHtml(cleaned.trim())}</li>`;
          })
          .join("")}</ul>`
      );
      continue;
    }

    if (lines.length === 1) {
      const md = parseMarkdownHeadingLine(lines[0]);
      if (md?.level === 2) {
        parts.push(`<h2 class="quote-heading-h2">${escapeHtml(md.text)}</h2>`);
        continue;
      }
      if (md?.level === 3) {
        parts.push(`<h3 class="quote-heading-h3">${escapeHtml(md.text)}</h3>`);
        continue;
      }
      if (isHeadingLine(lines[0])) {
        const heading = lines[0].replace(/:$/, "").trim();
        parts.push(`<h3 class="quote-section-heading">${escapeHtml(heading)}</h3>`);
        continue;
      }
    }

    let paraLines: string[] = [];
    const flushPara = () => {
      if (!paraLines.length) return;
      parts.push(
        `<p class="quote-paragraph">${paraLines.map((l) => escapeHtml(l.trim())).join("<br/>")}</p>`
      );
      paraLines = [];
    };

    for (const line of lines) {
      const md = parseMarkdownHeadingLine(line);
      if (md?.level === 2) {
        flushPara();
        parts.push(`<h2 class="quote-heading-h2">${escapeHtml(md.text)}</h2>`);
        continue;
      }
      if (md?.level === 3) {
        flushPara();
        parts.push(`<h3 class="quote-heading-h3">${escapeHtml(md.text)}</h3>`);
        continue;
      }
      paraLines.push(line);
    }
    flushPara();
  }

  const align = opts?.align || "left";
  const cls = opts?.className ? ` ${opts.className}` : "";
  return `<div class="quote-rich-text${cls}" style="text-align:${align};">${parts.join("")}</div>`;
}

export function parseQuotePageExtendedSettings(bodyTextContent: string): QuotePageExtendedSettings {
  let bodyText = bodyTextContent || "";
  let bodyHtml = "";
  let authoringPageType = "custom";
  let layoutMode = "standard";
  let coverLayoutMode: "classic" | "modern" = "classic";
  let header: Record<string, unknown> = {
    mode: "inherit",
    enabled: true,
    text: "",
    logoUrl: "",
    logoSize: "25px",
    lineColor: "#f59e0b",
    alignment: "left",
    showPageNumber: true,
  };
  let footer: Record<string, unknown> = {
    mode: "inherit",
    enabled: true,
    text: "Sunchaser Energy Systems Proposal",
    lineColor: "#cbd5e1",
    alignment: "left",
    fontSize: "8.5px",
    showPageNumber: false,
  };
  let bodyImages: any[] = [];
  let imageSections: QuoteImageSection[] = [];
  let typography: QuotePageExtendedSettings["typography"] = {};
  let watermark: QuoteWatermark = {};
  let signatureBlock: EnhancedSignatureBlock = { ...DEFAULT_CEO_SIGNATURE_BLOCK };

  if (typeof bodyText === "string" && bodyText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(bodyText);
      bodyText = parsed.bodyText !== undefined ? parsed.bodyText : "";
      bodyHtml = parsed.bodyHtml || "";
      authoringPageType = parsed.authoringPageType || "custom";
      layoutMode = parsed.layoutMode || "standard";
      coverLayoutMode = parsed.coverLayoutMode === "modern" ? "modern" : "classic";
      if (parsed.header) header = { ...header, ...parsed.header };
      if (parsed.footer) footer = { ...footer, ...parsed.footer };
      if (Array.isArray(parsed.bodyImages)) bodyImages = parsed.bodyImages;
      if (Array.isArray(parsed.imageSections)) imageSections = parsed.imageSections;
      if (parsed.typography) typography = parsed.typography;
      if (parsed.watermark) watermark = parsed.watermark;
      if (parsed.signatureBlock) {
        signatureBlock = { ...signatureBlock, ...parsed.signatureBlock };
      }
    } catch {
      /* plain text */
    }
  }

  return {
    bodyText,
    bodyHtml,
    authoringPageType,
    layoutMode,
    coverLayoutMode,
    header,
    footer,
    bodyImages,
    imageSections,
    typography,
    watermark,
    signatureBlock,
  };
}

export function resolveTypography(
  ext: Pick<QuotePageExtendedSettings, "typography">,
  globalTypography?: Partial<QuoteTypography>
): QuoteTypography {
  const density = (ext.typography?.densityMode ||
    globalTypography?.densityMode ||
    "normal") as QuoteTypography["densityMode"];
  const base = DENSITY_PRESETS[density] || DENSITY_PRESETS.normal;
  return {
    fontSize:
      ext.typography?.fontSize || globalTypography?.fontSize || base.fontSize || DEFAULT_TEMPLATE_TYPOGRAPHY.fontSize,
    lineHeight:
      ext.typography?.lineHeight ||
      globalTypography?.lineHeight ||
      base.lineHeight ||
      DEFAULT_TEMPLATE_TYPOGRAPHY.lineHeight,
    paragraphSpacing:
      ext.typography?.paragraphSpacing || globalTypography?.paragraphSpacing || base.paragraphSpacing,
    paddingTop: ext.typography?.paddingTop || globalTypography?.paddingTop || base.paddingTop,
    paddingBottom:
      ext.typography?.paddingBottom || globalTypography?.paddingBottom || base.paddingBottom,
    contentWidth: ext.typography?.contentWidth || globalTypography?.contentWidth || base.contentWidth,
    textAlign: ext.typography?.textAlign || globalTypography?.textAlign || base.textAlign,
    densityMode: density,
    fontFamily:
      ext.typography?.fontFamily ||
      globalTypography?.fontFamily ||
      DEFAULT_TEMPLATE_TYPOGRAPHY.fontFamily,
    headingColor:
      ext.typography?.headingColor ||
      globalTypography?.headingColor ||
      DEFAULT_TEMPLATE_TYPOGRAPHY.headingColor,
    bodyColor:
      ext.typography?.bodyColor || globalTypography?.bodyColor || DEFAULT_TEMPLATE_TYPOGRAPHY.bodyColor,
  } as QuoteTypography & { fontFamily?: string; headingColor?: string; bodyColor?: string };
}

export function typographyStyleAttr(typo: QuoteTypography & { fontFamily?: string; bodyColor?: string; headingColor?: string }): string {
  const fontFamily = typo.fontFamily || DEFAULT_TEMPLATE_TYPOGRAPHY.fontFamily;
  const bodyColor = typo.bodyColor || DEFAULT_TEMPLATE_TYPOGRAPHY.bodyColor;
  const headingColor = typo.headingColor || DEFAULT_TEMPLATE_TYPOGRAPHY.headingColor;
  return [
    `--quote-font-family:${fontFamily}`,
    `--quote-font-size:${typo.fontSize}`,
    `--quote-line-height:${typo.lineHeight}`,
    `--quote-para-gap:${typo.paragraphSpacing}`,
    `--quote-body-color:${bodyColor}`,
    `--quote-heading-color:${headingColor}`,
    `padding-top:${typo.paddingTop}`,
    `padding-bottom:${typo.paddingBottom}`,
    `max-width:${typo.contentWidth}`,
    `text-align:${typo.textAlign}`,
    `font-family:${fontFamily}`,
    `color:${bodyColor}`,
  ].filter(Boolean).join(";");
}

export function resolvePageWatermark(
  pageWatermark: QuoteWatermark | undefined | null,
  globalWatermark: GlobalWatermarkValue | Record<string, unknown> | null | undefined,
  options?: {
    pdfRow?: Record<string, unknown> | null;
    settingsRows?: Array<{ key?: string; value?: unknown }> | unknown;
    baseUrl?: string;
  }
): { imageUrl: string; settings: QuoteWatermark } | null {
  const pageUrl = String(pageWatermark?.imageUrl || "").trim();
  if (pageUrl) {
    return { imageUrl: pageUrl, settings: { ...(pageWatermark || {}), imageUrl: pageUrl } };
  }

  const resolvedFromSettings =
    withResolvedGlobalWatermark(globalWatermark as GlobalWatermarkValue, options?.baseUrl) ||
    resolveStoredGlobalWatermark(options?.pdfRow, options?.settingsRows, options?.baseUrl);

  const globalUrl = String(resolvedFromSettings?.imageUrl || "").trim();
  if (!globalUrl) return null;

  return {
    imageUrl: globalUrl,
    settings: {
      opacity: pageWatermark?.opacity ?? resolvedFromSettings?.opacity,
      scale: pageWatermark?.scale ?? resolvedFromSettings?.scale,
      position: pageWatermark?.position ?? resolvedFromSettings?.position,
      repeat: pageWatermark?.repeat ?? resolvedFromSettings?.repeat,
      imageUrl: globalUrl,
    },
  };
}

export function buildWatermarkLayer(
  imageUrl: string | undefined | null,
  wm?: QuoteWatermark | null,
  fallbackOpacity = 0.08
): string {
  const url = String(imageUrl || "").trim();
  if (!url) return "";
  const styleAttr = watermarkLayerStyleAttr(url, {
    ...wm,
    opacity: wm?.opacity ?? fallbackOpacity,
  });
  return `<div class="page-watermark" aria-hidden="true" style="${styleAttr}"></div>`;
}

export function mergeQuoteWithLead(quote: any, lead: any): Record<string, any> {
  const q = quote || {};
  const l = lead || {};
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "Not specified";
  };
  return {
    ...q,
    clientName: pick(q.clientName, q.client_name, l.name),
    clientPhone: pick(q.clientPhone, q.client_phone, l.phone),
    clientEmail: pick(q.clientEmail, q.client_email, l.email),
    clientAddress: pick(q.clientAddress, q.client_address, l.address),
    cityArea: pick(q.cityArea, q.city_area, l.location),
    bdmName: pick(q.bdmName, q.bdm_name, l.assignedSalesperson, l.assigned_salesperson),
    systemSizekW: q.systemSizekW ?? q.system_size_kw ?? l.systemSizekW,
    systemType: pick(q.systemType, q.system_type, l.systemType),
    quoteDate: q.quoteDate || q.quote_date || q.createdAt || q.created_at || l.createdAt,
    id: q.id || q.quoteId,
    leadId: q.leadId || l.id,
  };
}

export function formatSiteLocation(proposal: Record<string, any>): string {
  const address = String(proposal.clientAddress || "").trim();
  const area = String(proposal.cityArea || "").trim();
  if (address && address !== "Not specified" && area && area !== "Not specified") {
    if (address.toLowerCase().includes(area.toLowerCase())) return address;
    return `${area} — ${address}`;
  }
  if (address && address !== "Not specified") return address;
  if (area && area !== "Not specified") return area;
  return "Not specified";
}

/** A4 deck shell: page sizing, margins, footer slot, and print pagination. */
export function quotePdfShellCss(): string {
  return `
    @page {
      size: A4;
      margin: 0;
    }
    .pages-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 30px 0;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      background: #ffffff;
      box-sizing: border-box;
      padding: 18mm 18mm 16mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      position: relative;
      overflow: visible;
      break-after: page;
      page-break-after: always;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .page.cover {
      border: 2mm solid #f59e0b;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-height: auto;
    }
    .page.cover .cover-main {
      flex: 0 0 auto;
    }
    .page.cover .cover-footer-block {
      flex: 0 0 auto;
      margin-top: 20px;
      padding-top: 12px;
    }
    .page.boq-page {
      min-height: 297mm;
      height: auto;
      padding: 12mm 20mm 20mm;
      overflow: visible;
    }
    .page.full-page-image-only {
      width: 210mm;
      height: 297mm;
      min-height: 297mm;
      padding: 0 !important;
      margin: 0;
      display: block;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .page-watermark {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }
    .page-footer {
      flex: 0 0 auto;
      margin-top: auto;
      border-top: 1px solid #cbd5e1;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5px;
      color: #64748b;
      font-weight: 600;
      width: 100%;
      gap: 8px;
      position: static;
    }
    .section,
    .card,
    .grid-2,
    .cover-meta-grid,
    .ceo-signature-block,
    .quote-signature-block,
    .page-title,
    .page-header-logo {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    @media print {
      .pages-container {
        padding: 0 !important;
        gap: 0 !important;
        align-items: stretch;
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        height: auto;
        padding: 18mm 18mm 16mm 18mm;
        margin: 0 !important;
        box-shadow: none !important;
        overflow: visible !important;
        break-after: page;
        page-break-after: always;
      }
      .page:last-child {
        break-after: auto;
        page-break-after: auto;
      }
      .page.cover {
        border: none;
        min-height: 297mm;
      }
      .page.cover .cover-footer-block {
        margin-top: auto;
      }
      .page.boq-page {
        min-height: 297mm;
        padding: 12mm 18mm 16mm 18mm;
      }
      .page.full-page-image-only {
        width: 210mm;
        height: 297mm;
        min-height: 297mm;
        padding: 0 !important;
      }
    }
  `;
}

export function quotePdfPrintCss(): string {
  return `
    .quote-rich-text {
      font-family: var(--quote-font-family, Inter, 'Segoe UI', Arial, sans-serif);
      font-size: var(--quote-font-size, 13px);
      line-height: var(--quote-line-height, 1.55);
      color: var(--quote-body-color, #1f2937);
      text-decoration: none;
    }
    .quote-section-heading {
      color: #d97706;
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 11px) + 2px);
      margin: calc(var(--quote-para-gap, 12px) * 1.1) 0 var(--quote-para-gap, 12px);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-left: 3px solid #f59e0b;
      padding-left: 8px;
    }
    .quote-heading-h2 {
      color: #d97706;
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 11px) + 5px);
      line-height: 1.25;
      margin: calc(var(--quote-para-gap, 12px) * 1.35) 0 var(--quote-para-gap, 12px);
      letter-spacing: 0.02em;
    }
    .quote-heading-h3 {
      color: var(--quote-heading-color, #d97706);
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 13px) + 2px);
      line-height: 1.35;
      margin: calc(var(--quote-para-gap, 12px) * 1.05) 0 calc(var(--quote-para-gap, 12px) * 0.75);
      letter-spacing: 0.01em;
    }
    .quote-paragraph {
      margin: 0 0 var(--quote-para-gap, 12px);
      font-weight: 500;
    }
    .quote-bullet-list {
      margin: 0 0 var(--quote-para-gap, 12px);
      padding-left: 1.25em;
    }
    .quote-bullet-list li {
      margin-bottom: calc(var(--quote-para-gap, 12px) * 0.6);
    }
    .quote-page-shell {
      position: relative;
      z-index: 1;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .page-flow {
      position: relative;
      z-index: 1;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .page.cover.classic-layout {
      text-align: center;
    }
    .page.cover.classic-layout .cover-meta-grid {
      text-align: left;
    }
    .page-title {
      color: #d97706 !important;
    }
    ${"" /* authoring CSS injected via quoteAuthoringPrintCss in server */}
  `;
}

export function serializeQuotePageBody(state: {
  bodyText: string;
  bodyHtml?: string;
  authoringPageType?: string;
  layoutMode?: string;
  coverLayoutMode?: string;
  header?: Record<string, unknown>;
  footer?: Record<string, unknown>;
  bodyImages?: any[];
  imageSections?: QuoteImageSection[];
  typography?: Record<string, unknown>;
  watermark?: QuoteWatermark;
  signatureBlock?: EnhancedSignatureBlock;
}): string {
  return JSON.stringify({
    bodyText: state.bodyText || "",
    bodyHtml: state.bodyHtml || "",
    authoringPageType: state.authoringPageType || "custom",
    layoutMode: state.layoutMode || "standard",
    coverLayoutMode: state.coverLayoutMode || "classic",
    header: state.header || { mode: "inherit" },
    footer: state.footer || { mode: "inherit" },
    bodyImages: state.bodyImages || [],
    imageSections: state.imageSections || [],
    typography: state.typography || {},
    watermark: state.watermark || {},
    signatureBlock: state.signatureBlock || DEFAULT_CEO_SIGNATURE_BLOCK,
  });
}
