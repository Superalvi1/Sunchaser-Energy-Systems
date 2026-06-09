/** Embedded in invoice `notes` — no DB schema change. */
export type InvoiceProjectInfo = {
  projectNumber?: string;
  systemSize?: string;
  systemType?: string;
  panelBrand?: string;
  inverterBrand?: string;
  batteryBrand?: string;
  structureType?: string;
  netMeteringStatus?: string;
  salesAdvisor?: string;
};

export type InvoicePdfMeta = {
  project?: InvoiceProjectInfo;
  clientPhotoUrl?: string;
};

const MARKER_START = "<!--SUNCHASER_INVOICE_V3:";
const MARKER_END = "-->";

export function stripInvoiceMeta(notes: string | null | undefined): string {
  if (!notes) return "";
  const start = notes.indexOf(MARKER_START);
  if (start < 0) return notes.trim();
  const end = notes.indexOf(MARKER_END, start);
  if (end < 0) return notes.slice(0, start).trim();
  return (notes.slice(0, start) + notes.slice(end + MARKER_END.length)).trim();
}

export function decodeInvoiceMeta(notes: string | null | undefined): InvoicePdfMeta | null {
  if (!notes) return null;
  const start = notes.indexOf(MARKER_START);
  if (start < 0) return null;
  const jsonStart = start + MARKER_START.length;
  const end = notes.indexOf(MARKER_END, jsonStart);
  if (end < 0) return null;
  try {
    return JSON.parse(notes.slice(jsonStart, end)) as InvoicePdfMeta;
  } catch {
    return null;
  }
}

export function encodeInvoiceNotes(
  userNotes: string | null | undefined,
  meta: InvoicePdfMeta | null | undefined
): string | null {
  const base = stripInvoiceMeta(userNotes);
  if (!meta || (!meta.project && !meta.clientPhotoUrl)) {
    return base || null;
  }
  const payload = JSON.stringify(meta);
  const combined = `${base ? base + "\n\n" : ""}${MARKER_START}${payload}${MARKER_END}`;
  return combined.trim() || null;
}
