import { API_BASE_URL } from "../services/api";

export function manualQuotePdfPreviewUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}${q}`;
}

export function manualQuotePdfDownloadUrl(leadId: string, quoteId?: string): string {
  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  return `${API_BASE_URL}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}/download${q}`;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1].trim());
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

/** Direct PDF file download — no new tab, no print dialog. */
export async function downloadManualQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const res = await fetch(manualQuotePdfDownloadUrl(leadId, quoteId));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `PDF download failed (${res.status})`);
  }
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

/** Open printable HTML preview in a new window and trigger print after fonts load. */
export async function openManualQuotePrintPreview(leadId: string, quoteId?: string): Promise<void> {
  const res = await fetch(manualQuotePdfPreviewUrl(leadId, quoteId));
  if (!res.ok) {
    throw new Error(`Print preview failed (${res.status})`);
  }
  const html = await res.text();
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    throw new Error("Allow pop-ups to print the quotation preview.");
  }
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
