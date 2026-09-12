export type VyaparImportItem = {
  itemName: string;
  description?: string;
  qty: number;
  unit?: string;
  rate: number;
  taxPercent?: number;
  discountAmount?: number;
  notes?: string;
};

export type VyaparImportPayment = {
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber?: string;
  notes?: string;
};

export type VyaparImportInvoice = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  poNumber?: string;
  paymentTerms?: string;
  paymentMode?: string;
  discountAmount?: number;
  paidAmount?: number;
  notes?: string;
  terms?: string;
  items: VyaparImportItem[];
  payments: VyaparImportPayment[];
};

export type VyaparImportPayload = {
  generatedAt?: string;
  sourceFiles?: string[];
  invoices: VyaparImportInvoice[];
  unresolvedReceipts?: unknown[];
  cancelledInvoicesSkipped?: unknown[];
};

export type VyaparImportSummary = {
  invoiceCount: number;
  partyCount: number;
  itemCount: number;
  paymentCount: number;
  salesTotal: number;
  paymentTotal: number;
  balanceTotal: number;
  unresolvedReceiptCount: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INVOICES = 150;
const MAX_ITEMS = 500;
const MAX_PAYMENTS = 500;

function finiteNonNegative(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number.`);
  return number;
}

function requiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function validDate(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
  return text;
}

function normalizedParty(value: string): string {
  return value.toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(mr|mrs|miss|sb|sahib|sir|dr|col|colonel|wing commander)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function invoiceTotal(invoice: VyaparImportInvoice): number {
  const subtotal = invoice.items.reduce((sum, item) => {
    const gross = Number(item.qty) * Number(item.rate);
    const tax = gross * (Number(item.taxPercent || 0) / 100);
    return sum + gross + tax - Number(item.discountAmount || 0);
  }, 0);
  return Math.round((subtotal - Number(invoice.discountAmount || 0)) * 100) / 100;
}

export function parseVyaparImportPayload(raw: string): {
  payload: VyaparImportPayload;
  summary: VyaparImportSummary;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).invoices)) {
    throw new Error("The file must contain an invoices array.");
  }

  const payload = parsed as VyaparImportPayload;
  if (!payload.invoices.length || payload.invoices.length > MAX_INVOICES) {
    throw new Error(`Invoice count must be between 1 and ${MAX_INVOICES}.`);
  }

  const seen = new Set<string>();
  let itemCount = 0;
  let paymentCount = 0;
  let salesTotal = 0;
  let paymentTotal = 0;
  const parties = new Set<string>();

  payload.invoices.forEach((invoice, invoiceIndex) => {
    const prefix = `Invoice ${invoiceIndex + 1}`;
    invoice.invoiceNumber = requiredText(invoice.invoiceNumber, `${prefix} number`);
    invoice.invoiceDate = validDate(invoice.invoiceDate, `${prefix} date`);
    invoice.customerName = requiredText(invoice.customerName, `${prefix} customer`);
    if (seen.has(invoice.invoiceNumber)) throw new Error(`Duplicate invoice number: ${invoice.invoiceNumber}.`);
    seen.add(invoice.invoiceNumber);
    parties.add(normalizedParty(invoice.customerName));

    if (!Array.isArray(invoice.items) || !invoice.items.length) {
      throw new Error(`${prefix} must contain at least one item.`);
    }
    if (!Array.isArray(invoice.payments)) throw new Error(`${prefix} payments must be an array.`);

    invoice.items.forEach((item, itemIndex) => {
      item.itemName = requiredText(item.itemName, `${prefix} item ${itemIndex + 1} name`);
      item.qty = finiteNonNegative(item.qty, `${prefix} item ${itemIndex + 1} quantity`);
      item.rate = finiteNonNegative(item.rate, `${prefix} item ${itemIndex + 1} rate`);
      item.taxPercent = finiteNonNegative(item.taxPercent || 0, `${prefix} item ${itemIndex + 1} tax`);
      item.discountAmount = finiteNonNegative(item.discountAmount || 0, `${prefix} item ${itemIndex + 1} discount`);
    });

    invoice.discountAmount = finiteNonNegative(invoice.discountAmount || 0, `${prefix} discount`);
    invoice.paidAmount = 0;
    invoice.payments.forEach((payment, paymentIndex) => {
      payment.amount = finiteNonNegative(payment.amount, `${prefix} payment ${paymentIndex + 1} amount`);
      if (payment.amount <= 0) throw new Error(`${prefix} payment ${paymentIndex + 1} must be greater than zero.`);
      payment.paymentDate = validDate(payment.paymentDate, `${prefix} payment ${paymentIndex + 1} date`);
      payment.paymentMethod = requiredText(payment.paymentMethod, `${prefix} payment ${paymentIndex + 1} method`);
      paymentTotal += payment.amount;
    });

    itemCount += invoice.items.length;
    paymentCount += invoice.payments.length;
    salesTotal += invoiceTotal(invoice);
  });

  if (itemCount > MAX_ITEMS) throw new Error(`Item count exceeds the ${MAX_ITEMS} row safety limit.`);
  if (paymentCount > MAX_PAYMENTS) throw new Error(`Payment count exceeds the ${MAX_PAYMENTS} row safety limit.`);

  salesTotal = Math.round(salesTotal * 100) / 100;
  paymentTotal = Math.round(paymentTotal * 100) / 100;
  return {
    payload,
    summary: {
      invoiceCount: payload.invoices.length,
      partyCount: parties.size,
      itemCount,
      paymentCount,
      salesTotal,
      paymentTotal,
      balanceTotal: Math.round((salesTotal - paymentTotal) * 100) / 100,
      unresolvedReceiptCount: Array.isArray(payload.unresolvedReceipts) ? payload.unresolvedReceipts.length : 0,
    },
  };
}

export function paymentSignature(payment: {
  amount?: unknown;
  paymentDate?: unknown;
  referenceNumber?: unknown;
}): string {
  const amount = Math.round(Number(payment.amount || 0) * 100);
  const date = String(payment.paymentDate || "").slice(0, 10);
  const reference = String(payment.referenceNumber || "").trim().toLowerCase();
  return `${amount}|${date}|${reference}`;
}

/** Multiset comparison preserves legitimate duplicate receipts with identical fields. */
export function findMissingPayments(
  desired: VyaparImportPayment[],
  existing: Array<{ amount?: unknown; paymentDate?: unknown; referenceNumber?: unknown }>
): VyaparImportPayment[] {
  const counts = new Map<string, number>();
  existing.forEach((payment) => {
    const key = paymentSignature(payment);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return desired.filter((payment) => {
    const key = paymentSignature(payment);
    const remaining = counts.get(key) || 0;
    if (!remaining) return true;
    counts.set(key, remaining - 1);
    return false;
  });
}
