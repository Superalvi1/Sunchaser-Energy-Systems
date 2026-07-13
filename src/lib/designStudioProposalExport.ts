/**
 * Design Studio proposal export — Preview → Generate → Download PDF.
 * Reuses existing Playwright PDF generator. No CRM save. No new PDF engine.
 */

import type { ProposalPreviewPage } from "./solarDesignStudio.ts";
import {
  escapeHtml,
  OFFICIAL_QUOTE_LOGO_PATH,
  quotePdfPrintCss,
  quotePdfShellCss,
  resolveQuotePdfLogoUrl,
  getQuotePdfAppBaseUrl,
} from "./quotePdfLayout.ts";
import type {
  DesignStudioProposalCustomer,
  DesignStudioProposalIntegration,
} from "./designStudioProposalIntegration.ts";

export type ProposalExportProgress =
  | "idle"
  | "generating"
  | "ready"
  | "downloading"
  | "done"
  | "error";

export interface DesignStudioProposalBrand {
  companyName: string;
  officeAddress: string;
  phoneNumbers: string;
  billingEmail: string;
  logoUrl: string;
}

export interface DesignStudioProposalExportPayload {
  pages: ProposalPreviewPage[];
  customer: DesignStudioProposalCustomer;
  roofImageDataUrl: string | null;
  roofImageFileName: string | null;
  warnings: string[];
  generatedAt: string;
}

export const DEFAULT_DESIGN_STUDIO_PROPOSAL_BRAND: DesignStudioProposalBrand = {
  companyName: "Sunchaser Energy Systems",
  officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
  phoneNumbers: "0309-0236666, 0330-7776444",
  billingEmail: "billing@sunchaser-energy.com",
  logoUrl: OFFICIAL_QUOTE_LOGO_PATH,
};

export function resolveDesignStudioProposalBrand(
  override?: Partial<DesignStudioProposalBrand>
): DesignStudioProposalBrand {
  let logoUrl = DEFAULT_DESIGN_STUDIO_PROPOSAL_BRAND.logoUrl;
  try {
    logoUrl = resolveQuotePdfLogoUrl(OFFICIAL_QUOTE_LOGO_PATH, getQuotePdfAppBaseUrl());
  } catch {
    logoUrl = OFFICIAL_QUOTE_LOGO_PATH;
  }
  return {
    ...DEFAULT_DESIGN_STUDIO_PROPOSAL_BRAND,
    logoUrl,
    ...override,
  };
}

export function buildProposalExportFilename(customer: DesignStudioProposalCustomer): string {
  const safe = String(customer.name || "Customer")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48) || "Customer";
  return `Sunchaser-Proposal-${safe}.pdf`;
}

export function buildDesignStudioProposalExportPayload(
  integration: DesignStudioProposalIntegration,
  options?: { roofImageDataUrl?: string | null; generatedAt?: string }
): DesignStudioProposalExportPayload {
  if (!integration.ready) {
    throw new Error(integration.gatedReason || "Proposal is not ready for export.");
  }
  if (!integration.pages.length) {
    throw new Error("Proposal has no pages to export.");
  }
  return {
    pages: integration.pages,
    customer: integration.customer,
    roofImageDataUrl: options?.roofImageDataUrl ?? null,
    roofImageFileName: integration.roofImageFileName,
    warnings: integration.warnings,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
  };
}

/** Convert blob:/http(s) roof preview URLs into an embeddable data URL for PDF. */
export async function resolveRoofImageDataUrl(imageUrl: string | null | undefined): Promise<string | null> {
  const url = String(imageUrl || "").trim();
  if (!url) return null;
  if (/^javascript:/i.test(url) || /^vbscript:/i.test(url)) return null;
  if (url.startsWith("data:image/")) {
    return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ? url : null;
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith("blob:")) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : null;
        if (!result || !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(result)) {
          resolve(null);
          return;
        }
        resolve(result);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function pageIncludesRoofImage(page: ProposalPreviewPage): boolean {
  return page.id === "site-design" || page.id === "cover";
}

function renderPageHtml(
  page: ProposalPreviewPage,
  payload: DesignStudioProposalExportPayload
): string {
  const sections = page.sections
    .map((section) => {
      const lines = section.lines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      return `
        <div class="section">
          <h3>${escapeHtml(section.heading)}</h3>
          <ul>${lines}</ul>
        </div>`;
    })
    .join("");

  const roofBlock =
    pageIncludesRoofImage(page) && payload.roofImageDataUrl
      ? `
        <div class="roof-layout">
          <img src="${escapeHtml(payload.roofImageDataUrl)}" alt="Roof layout" />
          <p class="roof-caption">${escapeHtml(payload.roofImageFileName || "Roof layout")}</p>
        </div>`
      : "";

  return `
    <section class="a4-page proposal-page" data-page-id="${escapeHtml(page.id)}">
      <header class="page-header">
        <p class="subtitle">${escapeHtml(page.subtitle)}</p>
        <h1>${escapeHtml(page.title)}</h1>
      </header>
      ${roofBlock}
      <div class="sections">${sections}</div>
    </section>`;
}

export function compileDesignStudioProposalHtml(
  payload: DesignStudioProposalExportPayload,
  brand: DesignStudioProposalBrand = resolveDesignStudioProposalBrand()
): string {
  const pagesHtml = payload.pages.map((p) => renderPageHtml(p, payload)).join("\n");
  const warnings =
    payload.warnings.length > 0
      ? `<div class="warnings"><strong>Notes:</strong> ${escapeHtml(payload.warnings.slice(0, 8).join(" · "))}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(brand.companyName)} — Design Proposal</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${quotePdfShellCss()}
    ${quotePdfPrintCss()}
    body {
      font-family: Inter, system-ui, sans-serif;
      color: #0f172a;
      background: #e2e8f0;
      margin: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 22px;
      border-bottom: 3px solid #f59e0b;
      background: #0f172a;
      color: #fff;
    }
    .brand-bar img { height: 36px; width: auto; object-fit: contain; }
    .brand-meta { font-size: 11px; opacity: 0.85; line-height: 1.45; }
    .brand-name { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
    .customer-strip {
      padding: 10px 22px;
      background: #fffbeb;
      border-bottom: 1px solid #fde68a;
      font-size: 12px;
      color: #92400e;
    }
    .proposal-page {
      background: #fff;
      margin: 16px auto;
      padding: 28px 32px 36px;
      max-width: 210mm;
      min-height: 260mm;
      box-sizing: border-box;
      page-break-after: always;
      break-after: page;
    }
    .proposal-page:last-child { page-break-after: auto; break-after: auto; }
    .page-header .subtitle {
      margin: 0;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #b45309;
    }
    .page-header h1 {
      margin: 4px 0 16px;
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
    }
    .section { margin-bottom: 14px; }
    .section h3 {
      margin: 0 0 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #64748b;
    }
    .section ul {
      margin: 0;
      padding-left: 16px;
    }
    .section li {
      font-size: 12px;
      line-height: 1.45;
      color: #334155;
      margin-bottom: 2px;
    }
    .roof-layout {
      margin: 0 0 16px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      overflow: hidden;
      background: #f8fafc;
    }
    .roof-layout img {
      display: block;
      width: 100%;
      max-height: 280px;
      object-fit: contain;
      background: #0f172a;
    }
    .roof-caption {
      margin: 0;
      padding: 6px 10px;
      font-size: 10px;
      color: #64748b;
    }
    .warnings {
      max-width: 210mm;
      margin: 0 auto 12px;
      padding: 8px 12px;
      font-size: 11px;
      background: #fff7ed;
      border: 1px solid #fdba74;
      color: #9a3412;
      border-radius: 8px;
    }
    .export-meta {
      max-width: 210mm;
      margin: 0 auto 8px;
      font-size: 10px;
      color: #64748b;
      text-align: right;
    }
    @media print {
      body { background: #fff; }
      .proposal-page { margin: 0; box-shadow: none; }
      .warnings, .export-meta { display: none; }
    }
  </style>
</head>
<body>
  <div class="brand-bar">
    <img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" />
    <div>
      <div class="brand-name">${escapeHtml(brand.companyName)}</div>
      <div class="brand-meta">${escapeHtml(brand.officeAddress)} · ${escapeHtml(brand.phoneNumbers)} · ${escapeHtml(brand.billingEmail)}</div>
    </div>
  </div>
  <div class="customer-strip">
    Prepared for <strong>${escapeHtml(payload.customer.name)}</strong>
    · ${escapeHtml(payload.customer.phone)}
    · ${escapeHtml(payload.customer.address || "Address not provided")}
  </div>
  <div class="export-meta">Generated ${escapeHtml(payload.generatedAt)} · Ephemeral export (not saved to CRM)</div>
  ${warnings}
  ${pagesHtml}
</body>
</html>`;
}

export function assertExportPayloadReady(payload: DesignStudioProposalExportPayload | null): asserts payload is DesignStudioProposalExportPayload {
  if (!payload) throw new Error("Generate the proposal before downloading the PDF.");
  if (!payload.pages.length) throw new Error("Generated proposal has no pages.");
}

export function payloadHasRequiredSections(payload: DesignStudioProposalExportPayload): {
  boq: boolean;
  electrical: boolean;
  production: boolean;
  roof: boolean;
} {
  const headings = payload.pages.flatMap((p) => p.sections.map((s) => s.heading.toLowerCase()));
  return {
    boq: headings.some((h) => h.includes("boq")),
    electrical: headings.some((h) => h.includes("electrical")),
    production: headings.some((h) => h.includes("production")),
    roof: Boolean(payload.roofImageDataUrl) || headings.some((h) => h.includes("roof layout")),
  };
}
