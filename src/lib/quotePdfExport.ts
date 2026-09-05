import { API_BASE_URL, authorizedFetch } from "../services/api";
import { PDF_ENGINE_MISSING_MESSAGE } from "./quotePdfErrors";

function friendlyPdfError(status: number, text: string): string {
  const trimmed = (text || "").trim();
  if (trimmed.includes("PDF engine is not installed")) return PDF_ENGINE_MISSING_MESSAGE;
  if (/executable doesn't exist|playwright install/i.test(trimmed)) return PDF_ENGINE_MISSING_MESSAGE;
  return trimmed || `PDF download failed (${status})`;
}

export function manualQuotePdfPreviewUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}${q}`;
}

export function manualQuotePdfDownloadUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}/download${q}`;
}

export function autoSizerQuotePdfPreviewUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/auto-sizer/${encodeURIComponent(leadId)}${q}`;
}

export function autoSizerQuotePdfDownloadUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/auto-sizer/${encodeURIComponent(leadId)}/download${q}`;
}

export function isAutoSizerQuoteType(quoteType?: string | null): boolean {
  return quoteType === "auto_sizer";
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1].trim());
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

async function triggerBlobDownload(res: Response): Promise<void> {
  const blob = await res.blob();
  const filename =
    parseContentDispositionFilename(res.headers.get("Content-Disposition")) ||
    "Sunchaser-Quotation.pdf";
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Open a blank window during the user gesture, then fetch authenticated HTML.
 * window.open must run before the first await so the popup is not blocked.
 */
async function fetchAndWriteQuotePreview(url: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Allow pop-ups to print the quotation preview.");
  }
  try {
    win.opener = null;
    const res = await authorizedFetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(friendlyPdfError(res.status, text) || `Print preview failed (${res.status})`);
    }
    const html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
    const triggerPrint = () => {
      const fontReady = win.document.fonts?.ready ?? Promise.resolve();
      void fontReady.then(() => {
        setTimeout(() => win.print(), 200);
      });
    };
    if (win.document.readyState === "complete") {
      triggerPrint();
    } else {
      win.addEventListener("load", triggerPrint);
    }
  } catch (err) {
    try {
      win.close();
    } catch {
      /* ignore close failures on a blocked or already-closed window */
    }
    throw err;
  }
}

/** Direct PDF file download — no new tab, no print dialog. */
export async function downloadManualQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const res = await authorizedFetch(manualQuotePdfDownloadUrl(leadId, quoteId));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

/** Direct AutoSizer PDF file download — authenticated fetch, never window.location. */
export async function downloadAutoSizerQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const res = await authorizedFetch(autoSizerQuotePdfDownloadUrl(leadId, quoteId));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

export function manualQuotePdfDebugHtmlUrl(leadId: string, quoteId?: string, debugBox?: boolean): string {
  const params = new URLSearchParams();
  if (quoteId) params.set("quoteId", quoteId);
  if (debugBox) params.set("debugBox", "1");
  const q = params.toString();
  return `${API_BASE_URL}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}/debug-html${q ? `?${q}` : ""}`;
}

export function templateTestPdfDownloadUrl(
  templateId: string,
  options?: { pageId?: string; scope?: "page" | "full" }
): string {
  const scope = options?.scope || (options?.pageId ? "page" : "full");
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (options?.pageId) params.set("pageId", options.pageId);
  const q = params.toString();
  return `${API_BASE_URL}/api/export/pdf/template-preview/${encodeURIComponent(templateId)}/download${q ? `?${q}` : ""}`;
}

/** Download template test PDF (full deck or single page). Caller should save first. */
export async function downloadTemplateTestPdf(
  templateId: string,
  options?: { pageId?: string; scope?: "page" | "full" }
): Promise<void> {
  const res = await authorizedFetch(templateTestPdfDownloadUrl(templateId, options));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

/** Open printable HTML preview in a new window and trigger print after fonts load. */
export async function openManualQuotePrintPreview(leadId: string, quoteId?: string): Promise<void> {
  await fetchAndWriteQuotePreview(manualQuotePdfPreviewUrl(leadId, quoteId));
}

/** Open printable AutoSizer HTML preview fetched with the CRM auth header. */
export async function openAutoSizerQuotePrintPreview(leadId: string, quoteId?: string): Promise<void> {
  await fetchAndWriteQuotePreview(autoSizerQuotePdfPreviewUrl(leadId, quoteId));
}

export async function downloadQuotePdfByType(
  quoteType: string | null | undefined,
  leadId: string,
  quoteId?: string
): Promise<void> {
  if (isAutoSizerQuoteType(quoteType)) {
    return downloadAutoSizerQuotePdf(leadId, quoteId);
  }
  return downloadManualQuotePdf(leadId, quoteId);
}

export async function openQuotePrintPreviewByType(
  quoteType: string | null | undefined,
  leadId: string,
  quoteId?: string
): Promise<void> {
  if (isAutoSizerQuoteType(quoteType)) {
    return openAutoSizerQuotePrintPreview(leadId, quoteId);
  }
  return openManualQuotePrintPreview(leadId, quoteId);
}

/** Print from an iframe after content is loaded (Safari-safe delay). */
export function printProposalPreviewIframe(iframe: HTMLIFrameElement | null): void {
  if (!iframe?.contentWindow) return;
  const doc = iframe.contentDocument;
  const fontReady = doc?.fonts?.ready ?? Promise.resolve();
  void fontReady.then(() => {
    setTimeout(() => iframe.contentWindow?.print(), 200);
  });
}

/** Design Studio ephemeral proposal PDF — no CRM save. */
export function designStudioProposalPdfDownloadUrl(): string {
  return `${API_BASE_URL}/api/export/pdf/design-studio-proposal/download`;
}

export async function downloadDesignStudioProposalPdf(body: {
  payload: unknown;
  filename?: string;
}): Promise<void> {
  const res = await authorizedFetch(designStudioProposalPdfDownloadUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: body.payload,
      filename: body.filename || "Sunchaser-Proposal.pdf",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}
