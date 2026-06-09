import type { Lead, Quote } from "../types";
import type { InvoiceLineItem } from "./invoices";
import { getLatestSavedQuote, getQuoteSortTime } from "./quoteSelection";

export function resolveLeadCustomerId(lead: Lead): string {
  return `cust-${lead.id.replace(/^lead-/, "")}`;
}

/** Accepted quote first, else most recently saved quote with BOQ, else last quote on lead. */
export function pickQuoteForInvoice(lead: Lead): Quote | null {
  const quotes = lead.quotes || [];
  if (!quotes.length) return null;

  const accepted = quotes.filter((q) => q?.id && q.status === "Accepted");
  if (accepted.length) {
    return [...accepted].sort((a, b) => getQuoteSortTime(b) - getQuoteSortTime(a))[0];
  }

  const latest = getLatestSavedQuote(lead);
  if (latest) return latest;

  return quotes[quotes.length - 1] || null;
}

function boqRowsFromQuote(quote: Quote | null): any[] {
  if (!quote) return [];
  return quote.boqRows || quote.boqItems || [];
}

export function quoteBoqToInvoiceItems(quote: Quote | null): InvoiceLineItem[] {
  const rows = boqRowsFromQuote(quote);
  const itemRows = rows.filter(
    (r) => r && (r.type === "item" || (!r.type && (r.name || r.description)))
  );
  if (itemRows.length) {
    return itemRows.map((r) => ({
      itemName: r.name || r.description || "Item",
      description: r.description || "",
      qty: Number(r.qty || 1),
      unit: r.unit || "NONE",
      rate: Number(r.rate || 0),
      taxPercent: 0,
      discountAmount: 0,
      lineTotal: Number(r.total ?? Number(r.qty || 1) * Number(r.rate || 0)),
    }));
  }

  if (quote?.totalCost) {
    return [
      {
        itemName: "Solar system package",
        description: quote.systemSizekW ? `${quote.systemSizekW} kW system` : "",
        qty: 1,
        unit: "NONE",
        rate: Number(quote.totalCost || 0),
        taxPercent: 0,
        discountAmount: 0,
        lineTotal: Number(quote.totalCost || 0),
      },
    ];
  }

  return [];
}

export type InvoiceDraftFromLead = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  leadId: string;
  quotationId: string;
  projectNumber: string;
  systemSize: string;
  systemType: string;
  panelBrand: string;
  inverterBrand: string;
  batteryBrand: string;
  structureType: string;
  netMeteringStatus: string;
  discountAmount: number;
  paidAmount: number;
  items: InvoiceLineItem[];
  quoteAmount: number;
  quoteStatus: string;
};

export function buildInvoiceDraftFromLead(lead: Lead, quoteOverride?: Quote | null): InvoiceDraftFromLead {
  const q = quoteOverride ?? pickQuoteForInvoice(lead);
  const items = quoteBoqToInvoiceItems(q);
  const quoteAmount = Number(q?.totalCost ?? q?.netCost ?? 0);

  return {
    customerId: resolveLeadCustomerId(lead),
    customerName: lead.name,
    customerPhone: lead.phone || q?.clientPhone || "",
    customerAddress: lead.address || q?.clientAddress || lead.location || "",
    leadId: lead.id,
    quotationId: q?.id || "",
    projectNumber: lead.id,
    systemSize: q?.systemSizekW ? `${q.systemSizekW} kW` : "",
    systemType: q?.systemType || "",
    panelBrand: q?.panelBrand || q?.panelType || "",
    inverterBrand: q?.inverterBrand || q?.inverterType || "",
    batteryBrand: q?.batteryCapacity || q?.batteryOption || "",
    structureType: q?.structureType || "",
    netMeteringStatus: q?.netMeteringRequired || "",
    discountAmount: Number(q?.discount ?? q?.discountValue ?? 0),
    paidAmount: 0,
    items: items.length ? items : [{ itemName: "", description: "", qty: 1, unit: "NONE", rate: 0, taxPercent: 0, discountAmount: 0, lineTotal: 0 }],
    quoteAmount,
    quoteStatus: q?.status || "Pending",
  };
}

export function isContractedLeadReady(lead: Lead): boolean {
  if (lead.deletedAt) return false;
  if (!["Contracted", "Installed"].includes(lead.status)) return false;
  const q = pickQuoteForInvoice(lead);
  return !!q?.id;
}
