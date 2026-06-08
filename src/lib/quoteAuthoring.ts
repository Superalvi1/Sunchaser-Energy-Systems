/** Premium quotation authoring: page templates, content library, HTML rendering. */

import {
  renderRichTextBlock,
  escapeHtml,
  type QuoteTypography,
  type EnhancedSignatureBlock,
  type QuoteImageSection,
} from "./quotePdfLayout";

export type AuthoringPageType =
  | "cover"
  | "profile"
  | "vision_mission"
  | "ceo"
  | "qr"
  | "warranty"
  | "terms"
  | "bank"
  | "custom";

export type PdfQualityMode = "print" | "screen";

export type ContentLibraryBlock = {
  id: string;
  name: string;
  html: string;
};

export const QUOTE_CONTENT_LIBRARY_KEY = "quote_content_library";

export const AUTHORING_PAGE_TYPES: {
  value: AuthoringPageType;
  label: string;
  pageType: string;
  description: string;
}[] = [
  { value: "cover", label: "Cover Page", pageType: "cover", description: "Hero cover with client and proposal metadata" },
  { value: "profile", label: "Company Profile", pageType: "profile", description: "Consortium overview and group companies" },
  { value: "vision_mission", label: "Vision & Mission", pageType: "custom", description: "Corporate vision, mission, and values" },
  { value: "ceo", label: "CEO Message", pageType: "ceo", description: "Executive message and leadership assurances" },
  { value: "qr", label: "Why Choose Us / QR Contact", pageType: "qr", description: "Differentiators and digital contact channels" },
  { value: "warranty", label: "Warranty Information", pageType: "custom", description: "Warranty tiers and coverage summary" },
  { value: "terms", label: "Terms & Conditions", pageType: "terms1", description: "Legal terms and commercial conditions" },
  { value: "bank", label: "Bank Details", pageType: "bank", description: "Official payment channels" },
  { value: "custom", label: "Custom Page", pageType: "custom", description: "Free-form authored page" },
];

export const DEFAULT_CONTENT_LIBRARY: ContentLibraryBlock[] = [
  {
    id: "company_profile",
    name: "Company Profile",
    html: `<h2>Sunchaser Group Profile</h2><p>Sunchaser Energy operates under a unified consortium of specialized engineering, supply chain, and logistics enterprises. Together, we deliver structural reliability and direct import authorization unmatched in the local solar industry.</p><ul><li>Sunchaser Energy — installation &amp; commissioning</li><li>Helios Solar — design consultancy</li><li>AL ADAM Steel — mechanical fabrication</li><li>Signals Global — Tier-1 procurement</li></ul>`,
  },
  {
    id: "ceo_message",
    name: "CEO Message",
    html: `<h2>Executive Message</h2><p>At Sunchaser, our engineering philosophy is simple: we build systems that outlast a generation. We refuse to cut corners on material gauges, hot-dip zinc coating, wire thicknesses, or chemical earthing bores.</p>`,
  },
  {
    id: "why_choose_us",
    name: "Why Choose Us",
    html: `<h2>Why Partner with Sunchaser?</h2><ul><li>Direct imported Tier-1 hardware with customs trace certificates</li><li>Hot-dip galvanized structures engineered for 130 km/h wind shear</li><li>Complete NEPRA / LESCO net metering coordination</li><li>24/7 smart telemetry and after-sales support</li></ul>`,
  },
  {
    id: "vision",
    name: "Vision",
    html: `<h2>Our Vision</h2><p>Empowering Pakistan with generational clean energy independence, combining premium imports with superior local engineering.</p>`,
  },
  {
    id: "mission",
    name: "Mission",
    html: `<h2>Our Mission</h2><p>Deliver bankable solar infrastructure with transparent pricing, rigorous quality control, and lifetime client partnership.</p>`,
  },
  {
    id: "solar_benefits",
    name: "Solar Benefits",
    html: `<h2>Solar Benefits</h2><ul><li>Reduce electricity bills with net metering export credits</li><li>Protect against rising utility tariffs</li><li>Increase property asset value</li><li>Lower carbon footprint with clean generation</li></ul>`,
  },
];

const ALLOWED_TAGS =
  /^(p|h1|h2|h3|h4|strong|b|em|i|u|ul|ol|li|table|thead|tbody|tr|th|td|img|hr|div|span|br|a)$/i;

/** Lightweight HTML sanitizer for stored editor content. */
export function sanitizeQuoteHtml(html: string): string {
  if (!html || !String(html).trim()) return "";
  let out = String(html);
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/javascript:/gi, "");
  out = out.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tag, attrs) => {
    if (!ALLOWED_TAGS.test(tag)) return "";
    if (tag.toLowerCase() === "img") {
      const src = String(attrs).match(/src\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const url = src?.[2] || src?.[3] || src?.[4] || "";
      const w = String(attrs).match(/width\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const width = w?.[2] || w?.[3] || w?.[4] || "";
      return `<img src="${escapeHtml(url)}"${width ? ` width="${escapeHtml(width)}"` : ""} style="max-width:100%;height:auto;" alt="" />`;
    }
    return `<${tag.toLowerCase()}${attrs}>`;
  });
  return out;
}

export function resolveAuthoringPageType(value: unknown): AuthoringPageType {
  const v = String(value || "custom") as AuthoringPageType;
  return AUTHORING_PAGE_TYPES.some((t) => t.value === v) ? v : "custom";
}

export function getAuthoringTemplateMeta(type: AuthoringPageType) {
  return AUTHORING_PAGE_TYPES.find((t) => t.value === type) || AUTHORING_PAGE_TYPES[AUTHORING_PAGE_TYPES.length - 1];
}

export function getDefaultBodyHtmlForPageType(type: AuthoringPageType): string {
  const blockId =
    type === "profile"
      ? "company_profile"
      : type === "ceo"
        ? "ceo_message"
        : type === "qr"
          ? "why_choose_us"
          : type === "vision_mission"
            ? "vision"
            : type === "warranty"
              ? "solar_benefits"
              : "";
  const block = DEFAULT_CONTENT_LIBRARY.find((b) => b.id === blockId);
  return block?.html || "";
}

export function renderImageSectionsHtml(sections: QuoteImageSection[] = []): string {
  if (!sections.length) return "";
  return sections
    .map((sec) => {
      const url = escapeHtml(sec.imageUrl || "");
      if (!url) return "";
      const width = Math.min(100, Math.max(20, Number(sec.widthPercent) || 100));
      const text = sec.textHtml ? sanitizeQuoteHtml(sec.textHtml) : "";
      const img = `<img src="${url}" style="width:${width}%;max-width:100%;height:auto;display:block;object-fit:contain;" alt="" />`;
      if (sec.layout === "full_width") {
        return `<div class="quote-image-row quote-image-full">${img}${text ? `<div class="quote-image-caption">${text}</div>` : ""}</div>`;
      }
      if (sec.layout === "center") {
        return `<div class="quote-image-row quote-image-center" style="text-align:center;">${img}${text ? `<div>${text}</div>` : ""}</div>`;
      }
      if (sec.layout === "left_image") {
        return `<div class="quote-image-row quote-image-left-right" style="display:grid;grid-template-columns:42% 1fr;gap:12px;align-items:start;"><div>${img}</div><div>${text}</div></div>`;
      }
      if (sec.layout === "right_image") {
        return `<div class="quote-image-row quote-image-right-left" style="display:grid;grid-template-columns:1fr 42%;gap:12px;align-items:start;"><div>${text}</div><div>${img}</div></div>`;
      }
      return `<div class="quote-image-row">${img}</div>`;
    })
    .join("");
}

export function renderEnhancedSignatureBlockHtml(
  block?: EnhancedSignatureBlock | null,
  ceoFallback?: Array<{ name?: string; designation?: string; signature_url?: string; signatureUrl?: string }>
): string {
  const roles = [
    {
      key: "ceo" as const,
      label: "CEO",
      data: block?.ceo,
      fallback: ceoFallback?.[0],
      defaults: { name: "Muhammad Allauddin", title: "CEO" },
    },
    {
      key: "technicalDirector" as const,
      label: "Technical Director",
      data: block?.technicalDirector,
      fallback: undefined,
      defaults: { name: "Chief Technical Officer", title: "Technical Director" },
    },
    {
      key: "salesAdvisor" as const,
      label: "Sales Advisor",
      data: block?.salesAdvisor,
      fallback: ceoFallback?.[1],
      defaults: { name: "Barrister Raza Khan Niazi", title: "CEO Strategy & Innovation" },
    },
  ];

  const enabled = roles.filter((r) => r.data?.enabled !== false);
  const active = enabled.length ? enabled : roles.slice(0, 2);

  const cols = active
    .map((r) => {
      const name = r.data?.name || r.fallback?.name || r.defaults.name;
      const title = r.data?.title || r.fallback?.designation || r.defaults.title;
      const sigUrl =
        r.data?.signatureUrl ||
        r.data?.signatureFile ||
        r.fallback?.signature_url ||
        r.fallback?.signatureUrl ||
        "";
      const sigImage = sigUrl
        ? `<img src="${escapeHtml(sigUrl)}" alt="" style="max-height:16mm;max-width:100%;object-fit:contain;margin:0 auto 6px;display:block;" />`
        : `<div style="height:12mm;border-bottom:1.5px solid #cbd5e1;margin-bottom:8px;"></div>`;
      return `<div style="text-align:center;padding:0 4mm;"><div style="font-size:8px;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:4px;">${escapeHtml(r.label)}</div>${sigImage}<div style="font-weight:800;font-size:11px;color:#0f172a;">${escapeHtml(name)}</div><div style="font-size:8px;text-transform:uppercase;color:#d97706;font-weight:700;margin-top:2px;">${escapeHtml(title)}</div></div>`;
    })
    .join("");

  return `<div class="quote-signature-block" style="margin-top:auto;padding-top:14mm;border-top:1.5px solid #e2e8f0;"><div style="display:grid;grid-template-columns:repeat(${active.length},1fr);gap:10mm;align-items:end;">${cols}</div></div>`;
}

export function renderPageBodyHtml(
  ext: {
    bodyHtml?: string;
    bodyText?: string;
    imageSections?: QuoteImageSection[];
  },
  opts?: { align?: string; typography?: Partial<QuoteTypography & { fontFamily?: string; headingColor?: string; bodyColor?: string }> }
): string {
  const align = opts?.align || "left";
  const imageHtml = renderImageSectionsHtml(ext.imageSections || []);
  let inner = "";
  if (ext.bodyHtml && String(ext.bodyHtml).trim()) {
    inner = sanitizeQuoteHtml(ext.bodyHtml);
  } else if (ext.bodyText && String(ext.bodyText).trim()) {
    inner = renderRichTextBlock(ext.bodyText, { align }).replace(/^<div class="quote-rich-text"[^>]*>/, "").replace(/<\/div>$/, "");
  }
  if (!imageHtml && !inner) return "";
  const fontFamily = opts?.typography?.fontFamily || "Inter, 'Segoe UI', sans-serif";
  const bodyColor = opts?.typography?.bodyColor || "#475569";
  const headingColor = opts?.typography?.headingColor || "#d97706";
  return `<div class="quote-authoring-body quote-rich-text" style="text-align:${align};font-family:${fontFamily};color:${bodyColor};--quote-heading-color:${headingColor};">${imageHtml}${inner}</div>`;
}

export function quoteAuthoringPrintCss(pdfQuality: PdfQualityMode = "print"): string {
  const imageSharp = pdfQuality === "print" ? "crisp-edges" : "auto";
  return `
    .quote-authoring-body h1 {
      color: var(--quote-heading-color, #d97706);
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 11px) + 8px);
      margin: calc(var(--quote-para-gap, 12px) * 1.5) 0 var(--quote-para-gap, 12px);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-authoring-body h2 {
      color: var(--quote-heading-color, #d97706);
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 11px) + 5px);
      margin: calc(var(--quote-para-gap, 12px) * 1.35) 0 var(--quote-para-gap, 12px);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-authoring-body h3 {
      color: #1e3a8a;
      font-weight: 800;
      font-size: calc(var(--quote-font-size, 11px) + 2px);
      margin: calc(var(--quote-para-gap, 12px) * 1.05) 0 calc(var(--quote-para-gap, 12px) * 0.75);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-authoring-body p,
    .quote-authoring-body li {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-authoring-body table {
      width: 100%;
      border-collapse: collapse;
      margin: calc(var(--quote-para-gap, 12px) * 1.1) 0;
      font-size: calc(var(--quote-font-size, 11px) - 0.5px);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-authoring-body th,
    .quote-authoring-body td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    .quote-authoring-body th {
      background: #f8fafc;
      font-weight: 700;
      color: #0f172a;
    }
    .quote-authoring-body hr {
      border: none;
      border-top: 1.5px solid #e2e8f0;
      margin: calc(var(--quote-para-gap, 12px) * 1.2) 0;
    }
    .quote-authoring-body img {
      image-rendering: ${imageSharp};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .quote-image-row {
      margin: calc(var(--quote-para-gap, 12px) * 1.1) 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .quote-page-body-flow {
      flex: 1;
      min-height: 0;
      overflow: visible;
    }
    .quote-page-body-flow > * {
      orphans: 3;
      widows: 3;
    }
    .page.authoring-page {
      display: flex;
      flex-direction: column;
      min-height: 257mm;
      box-sizing: border-box;
    }
    .page.authoring-page .page-footer-slot {
      margin-top: auto;
      flex-shrink: 0;
    }
    @media print {
      .quote-authoring-body h1,
      .quote-authoring-body h2,
      .quote-authoring-body h3,
      .quote-authoring-body p,
      .quote-authoring-body table,
      .quote-authoring-body .quote-image-row,
      .quote-authoring-body hr,
      .quote-signature-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .page.authoring-page {
        page-break-after: always;
      }
    }
  `;
}

export function mergeContentLibrary(
  stored: ContentLibraryBlock[] | null | undefined
): ContentLibraryBlock[] {
  const byId = new Map<string, ContentLibraryBlock>();
  DEFAULT_CONTENT_LIBRARY.forEach((b) => byId.set(b.id, b));
  (stored || []).forEach((b) => {
    if (b?.id && b?.name) byId.set(b.id, { ...byId.get(b.id), ...b });
  });
  return Array.from(byId.values());
}

export function appendHtmlToEditor(current: string, snippet: string): string {
  const clean = sanitizeQuoteHtml(snippet);
  if (!current?.trim()) return clean;
  return `${current.trim()}${current.trim().endsWith("</p>") ? "" : "<p></p>"}${clean}`;
}

export function createDefaultImageSection(): QuoteImageSection {
  return {
    id: `img-${Date.now()}`,
    layout: "full_width",
    imageUrl: "",
    widthPercent: 100,
    textHtml: "",
  };
}

export function createEmptyTableHtml(rows = 3, cols = 3): string {
  const head = Array.from({ length: cols })
    .map((_, i) => `<th>Column ${i + 1}</th>`)
    .join("");
  const body = Array.from({ length: rows })
    .map(
      () =>
        `<tr>${Array.from({ length: cols })
          .map(() => "<td>&nbsp;</td>")
          .join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
