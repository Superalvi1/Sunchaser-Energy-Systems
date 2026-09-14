import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileTransfer } from "@capacitor/file-transfer";
import { FileViewer } from "@capacitor/file-viewer";
import { API_BASE_URL, authorizedFetch, getStoredAuthToken } from "../services/api";
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

function safePdfFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "Sunchaser-Quotation"}.pdf`;
}


function absoluteApiUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE_URL}${pathOrUrl}`;
}

function nativeAuthHeaders(): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function nativeDownloadAndOpenPdf(url: string, filename: string): Promise<void> {
  const safeName = safePdfFilename(filename);
  const uniqueName = `${Date.now()}-${safeName}`;
  let targetUri: string;

  try {
    await Filesystem.mkdir({
      path: "Sunchaser",
      directory: Directory.Documents,
      recursive: true,
    });
    const target = await Filesystem.getUri({
      path: `Sunchaser/${uniqueName}`,
      directory: Directory.Documents,
    });
    targetUri = target.uri;
  } catch {
    const target = await Filesystem.getUri({
      path: uniqueName,
      directory: Directory.Cache,
    });
    targetUri = target.uri;
  }

  let localPath = targetUri;
  try {
    const result = await FileTransfer.downloadFile({
      url: absoluteApiUrl(url),
      path: targetUri,
      headers: nativeAuthHeaders(),
      progress: false,
      method: "GET",
      readTimeout: 120000,
      connectTimeout: 60000,
    });
    localPath = result.path || targetUri;
  } catch (error: any) {
    console.error("Native PDF transfer failed", error);
    throw new Error(error?.message || "Could not download the generated PDF to this device.");
  }

  try {
    await FileViewer.openDocumentFromLocalPath({ path: localPath });
  } catch (error: any) {
    console.error("Native PDF viewer failed", error);
    throw new Error(
      "PDF downloaded successfully, but Android could not open it. Check the Sunchaser folder in Documents."
    );
  }
}

async function triggerBlobDownload(res: Response): Promise<void> {
  const blob = await res.blob();
  const filename = safePdfFilename(
    parseContentDispositionFilename(res.headers.get("Content-Disposition")) ||
      "Sunchaser-Quotation.pdf"
  );

  if (Capacitor.isNativePlatform()) {
    throw new Error("This Android PDF export must use the native downloader.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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

export function ephemeralManualQuotePdfDownloadUrl(): string {
  return `${API_BASE_URL}/api/export/pdf/manual-quote?download=1`;
}

/** Full Manual BOQ PDF generated from current editor state without creating a CRM lead/quote. */
export async function downloadEphemeralManualQuotePdf(payload: unknown): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const stageRes = await authorizedFetch(`${API_BASE_URL}/api/export/pdf/manual-quote?stage=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!stageRes.ok) {
      const text = await stageRes.text().catch(() => "");
      throw new Error(friendlyPdfError(stageRes.status, text));
    }
    const staged = await stageRes.json() as { downloadUrl?: string; filename?: string };
    if (!staged.downloadUrl) throw new Error("PDF staging did not return a download URL.");
    await nativeDownloadAndOpenPdf(
      staged.downloadUrl,
      staged.filename || "Sunchaser-Quotation.pdf"
    );
    return;
  }

  const res = await authorizedFetch(ephemeralManualQuotePdfDownloadUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

/** Direct PDF file download — no new tab, no print dialog. */
export async function downloadManualQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const url = manualQuotePdfDownloadUrl(leadId, quoteId);
  if (Capacitor.isNativePlatform()) {
    await nativeDownloadAndOpenPdf(url, "Sunchaser-Quotation.pdf");
    return;
  }
  const res = await authorizedFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

/** Direct AutoSizer PDF file download — authenticated fetch, never window.location. */
export async function downloadAutoSizerQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const url = autoSizerQuotePdfDownloadUrl(leadId, quoteId);
  if (Capacitor.isNativePlatform()) {
    await nativeDownloadAndOpenPdf(url, "Sunchaser-AutoSizer-Quotation.pdf");
    return;
  }
  const res = await authorizedFetch(url);
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
