import type { Lead } from "../types";

const PAKISTAN_PHONE_ALLOWED_RE = /^\\+?[\\d\\s().\\-‐‑‒–—−]+$/;
const PAKISTAN_PHONE_SEPARATORS_RE = /[\\s().\\-‐‑‒–—−]/g;

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Normalize accepted Pakistan mobile formats to the CRM canonical 923XXXXXXXXX form. */
export function normalizePakistanMobile(value: string): string | null {
  const text = toAsciiDigits(String(value || "").trim());
  if (!text || !PAKISTAN_PHONE_ALLOWED_RE.test(text)) return null;

  const compact = text.replace(PAKISTAN_PHONE_SEPARATORS_RE, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  let canonical: string;

  if (/^03\\d{9}$/.test(digits)) canonical = `92${digits.slice(1)}`;
  else if (/^3\\d{9}$/.test(digits)) canonical = `92${digits}`;
  else if (/^923\\d{9}$/.test(digits)) canonical = digits;
  else if (/^00923\\d{9}$/.test(digits)) canonical = digits.slice(2);
  else return null;

  // Reject obvious placeholder numbers such as 03000000000 or 03111111111.
  return /^923(\\d)\\1{8}$/.test(canonical) ? null : canonical;
}

export type SmartQuoteLeadSummary = {
  quoteNumber: string;
  system: string;
  estimatePkr: number;
  panel: string;
  inverter: string;
  battery: string;
  structure: string;
  generatedAt: string;
};

export function isSmartQuoteLead(lead: Pick<Lead, "leadSource">): boolean {
  return String(lead.leadSource || "").trim().toLowerCase() === "smart quote";
}

export function parseSmartQuoteLeadNotes(notes: string | null | undefined): SmartQuoteLeadSummary | null {
  const text = String(notes || "");
  if (!text.includes("SMART_QUOTE_V1")) return null;
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const estimatePkr = Number(values.get("Estimate")?.replace(/^PKR\s+/i, ""));
  return {
    quoteNumber: values.get("Quote") || "Unknown quote",
    system: values.get("System") || "Not specified",
    estimatePkr: Number.isFinite(estimatePkr) ? estimatePkr : 0,
    panel: values.get("Panel") || "Not specified",
    inverter: values.get("Inverter") || "Not specified",
    battery: values.get("Battery") || "Not specified",
    structure: values.get("Structure") || "Not specified",
    generatedAt: values.get("Generated") || "",
  };
}

