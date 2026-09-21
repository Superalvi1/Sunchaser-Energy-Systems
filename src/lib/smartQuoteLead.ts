import type { Lead } from "../types";

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

