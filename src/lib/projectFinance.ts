export const PAYMENT_STATUSES = [
  "Unpaid",
  "Advance Received",
  "Partially Paid",
  "Fully Paid",
  "Overdue",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ProjectFinanceRecord = {
  id: string;
  customerId: string;
  projectDeliveryId: string | null;
  leadId: string | null;
  quotationId: string | null;
  saleValue: number;
  advanceReceived: number;
  balanceRemaining: number;
  supplierCost: number;
  installationCost: number;
  transportCost: number;
  miscExpense: number;
  totalExpense: number;
  grossProfit: number;
  profitMarginPercent: number;
  paymentStatus: PaymentStatus;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function canViewProjectProfit(role: string, username: string): boolean {
  return role === "Super Admin" && String(username || "").trim().toLowerCase() === "allauddin";
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function computeFinanceNumbers(input: {
  saleValue?: unknown;
  advanceReceived?: unknown;
  supplierCost?: unknown;
  installationCost?: unknown;
  transportCost?: unknown;
  miscExpense?: unknown;
  paymentStatus?: string | null;
  forceOverdue?: boolean;
}) {
  const saleValue = Math.max(0, num(input.saleValue));
  const advanceReceived = Math.max(0, num(input.advanceReceived));
  const supplierCost = Math.max(0, num(input.supplierCost));
  const installationCost = Math.max(0, num(input.installationCost));
  const transportCost = Math.max(0, num(input.transportCost));
  const miscExpense = Math.max(0, num(input.miscExpense));
  const balanceRemaining = Math.max(0, saleValue - advanceReceived);
  const totalExpense = supplierCost + installationCost + transportCost + miscExpense;
  const grossProfit = saleValue - totalExpense;
  const profitMarginPercent =
    saleValue > 0 ? Number(((grossProfit / saleValue) * 100).toFixed(2)) : 0;

  let paymentStatus: PaymentStatus =
    input.paymentStatus && PAYMENT_STATUSES.includes(input.paymentStatus as PaymentStatus)
      ? (input.paymentStatus as PaymentStatus)
      : "Unpaid";

  if (input.forceOverdue) {
    paymentStatus = "Overdue";
  } else if (paymentStatus !== "Overdue") {
    if (balanceRemaining <= 0 && saleValue > 0) paymentStatus = "Fully Paid";
    else if (advanceReceived <= 0) paymentStatus = "Unpaid";
    else if (advanceReceived > 0 && balanceRemaining > 0) {
      const ratio = saleValue > 0 ? advanceReceived / saleValue : 0;
      paymentStatus = ratio < 0.5 ? "Advance Received" : "Partially Paid";
    }
  }

  return {
    saleValue,
    advanceReceived,
    balanceRemaining,
    supplierCost,
    installationCost,
    transportCost,
    miscExpense,
    totalExpense,
    grossProfit,
    profitMarginPercent,
    paymentStatus,
  };
}

const STAFF_SAFE_KEYS = [
  "id",
  "customerId",
  "projectDeliveryId",
  "leadId",
  "quotationId",
  "saleValue",
  "advanceReceived",
  "balanceRemaining",
  "paymentStatus",
  "notes",
  "createdAt",
  "updatedAt",
] as const;

const PROFIT_KEYS = [
  "supplierCost",
  "installationCost",
  "transportCost",
  "miscExpense",
  "totalExpense",
  "grossProfit",
  "profitMarginPercent",
] as const;

export function toStaffSafeFinance(record: ProjectFinanceRecord) {
  const out: Record<string, unknown> = {};
  for (const k of STAFF_SAFE_KEYS) out[k] = record[k];
  return out;
}

export function toCustomerPaymentView(
  record: ProjectFinanceRecord,
  receipts: { id: string; title: string; fileUrl: string; documentType?: string }[]
) {
  return {
    projectFinanceId: record.id,
    projectDeliveryId: record.projectDeliveryId,
    invoiceAmount: record.saleValue,
    amountPaid: record.advanceReceived,
    balanceRemaining: record.balanceRemaining,
    paymentStatus: record.paymentStatus,
    receipts,
  };
}

export function stripProfitFields<T extends Record<string, unknown>>(record: T): T {
  const copy = { ...record };
  for (const k of PROFIT_KEYS) delete copy[k];
  return copy;
}
