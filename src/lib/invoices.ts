import { roleHasPermission, isSuperAdmin, type PermissionKey } from "./roles";

export const INVOICE_PAYMENT_STATUSES = ["Unpaid", "Partial", "Paid", "Overdue"] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["Cash", "Bank transfer", "Cheque", "Online"] as const;
export type InvoicePaymentMethod = (typeof PAYMENT_METHODS)[number];

export type InvoiceLineItem = {
  id?: string;
  sortOrder?: number;
  itemName?: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  taxPercent: number;
  discountAmount: number;
  lineTotal: number;
  productId?: string | null;
  notes?: string | null;
};

export type PartyLedgerSummary = {
  partyKey: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  billingAddress: string | null;
  totalSales: number;
  receivedAmount: number;
  balanceDue: number;
  invoiceCount: number;
  hasOverdue?: boolean;
};

export type PartyLedgerPayment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string | null;
  amount: number;
  recordedBy: string | null;
  receiptUrl: string | null;
  notes: string | null;
  createdAt?: string;
};

export type PartyLedgerTransaction = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
};

export type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTime?: string | null;
  dueDate: string | null;
  poNumber?: string | null;
  poDate?: string | null;
  paymentTerms?: string | null;
  paymentMode?: string | null;
  amountInWords?: string | null;
  previousBalance?: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  cnicNtn: string | null;
  leadId: string | null;
  quotationId: string | null;
  projectId: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
  notes: string | null;
  terms: string | null;
  pdfUrl: string | null;
  items?: InvoiceLineItem[];
  payments?: InvoicePaymentRow[];
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type InvoicePaymentRow = {
  id: string;
  invoiceId: string;
  amount: number;
  paymentMethod: InvoicePaymentMethod;
  paymentDate: string;
  referenceNumber?: string | null;
  receiptUrl: string | null;
  notes: string | null;
  recordedBy: string | null;
  createdAt?: string;
};

export const INVOICES_PERMISSION: PermissionKey = "invoices";

export function canViewAllInvoices(username: string, role: string): boolean {
  if (isSuperAdmin(username, role)) return true;
  if (roleHasPermission(role, INVOICES_PERMISSION)) {
    return ["Director", "Accounts Manager", "Super Admin"].includes(role);
  }
  return false;
}

export function canCreateInvoice(username: string, role: string): boolean {
  if (isSuperAdmin(username, role)) return true;
  if (!roleHasPermission(role, INVOICES_PERMISSION)) return false;
  return [
    "Director",
    "Admin",
    "Accounts Manager",
    "Sales Manager",
    "Sales Executive",
    "Super Admin",
  ].includes(role);
}

export function computeLineTotal(item: {
  qty: number;
  rate: number;
  taxPercent?: number;
  discountAmount?: number;
}): number {
  const base = Number(item.qty || 0) * Number(item.rate || 0);
  const discount = Number(item.discountAmount || 0);
  return Math.round(Math.max(0, base - discount) * 100) / 100;
}

/** Total = sum(line qty × rate) − invoice discount. No tax. */
export function computeInvoiceTotals(items: InvoiceLineItem[], invoiceDiscount = 0) {
  const lines = items.map((it) => ({
    ...it,
    lineTotal: computeLineTotal(it),
  }));
  const subtotal = lines.reduce((s, it) => s + Number(it.qty || 0) * Number(it.rate || 0), 0);
  const discountAmount = Number(invoiceDiscount || 0);
  const grandTotal = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;
  return {
    items: lines,
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: 0,
    grandTotal,
  };
}

export function derivePaymentStatus(
  grandTotal: number,
  paidAmount: number,
  dueDate: string | null,
  forced?: InvoicePaymentStatus
): InvoicePaymentStatus {
  if (forced === "Overdue") return "Overdue";
  const balance = Math.round((grandTotal - paidAmount) * 100) / 100;
  if (balance <= 0 && grandTotal > 0) return "Paid";
  if (paidAmount > 0 && balance > 0) {
    if (dueDate) {
      const due = new Date(dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (due < today) return "Overdue";
    }
    return "Partial";
  }
  if (dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today && grandTotal > 0) return "Overdue";
  }
  return "Unpaid";
}
