import { createHash } from "node:crypto";

/** Payment rows are the source of truth for what a client has paid. */
export type LedgerPayment = {
  id: string;
  amount: number;
  paymentMethod?: string | null;
  paymentDate?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  recordedBy?: string | null;
  createdAt?: string | null;
};

export const DUPLICATE_PAYMENT_WINDOW_MS = 2 * 60 * 1000;

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function ledgerTotal(payments: Pick<LedgerPayment, "amount">[]): number {
  return roundMoney(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));
}

export function normalizeClientRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

type PaymentIdentity = {
  invoiceId: string;
  clientRequestId: string | null;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
  recordedBy: string;
  nowMs: number;
};

/**
 * Deterministic payment id. With a client request id, every retry of one submission maps to
 * the same row. Older clients without one get a short time bucket, so a double tap collides
 * on the primary key instead of recording the money twice.
 */
export function paymentIdFor(identity: PaymentIdentity): string {
  const material = identity.clientRequestId
    ? `request\n${identity.invoiceId}\n${identity.clientRequestId}`
    : [
        "legacy",
        identity.invoiceId,
        roundMoney(identity.amount).toFixed(2),
        identity.paymentMethod,
        identity.paymentDate,
        identity.referenceNumber || "",
        identity.notes || "",
        identity.recordedBy,
        Math.floor(identity.nowMs / DUPLICATE_PAYMENT_WINDOW_MS),
      ].join("\n");
  return `pay-${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

/** An identical payment by the same user moments ago is almost always a double submit. */
export function findRecentDuplicatePayment(
  payments: LedgerPayment[],
  candidate: Omit<PaymentIdentity, "invoiceId" | "clientRequestId">,
  windowMs = DUPLICATE_PAYMENT_WINDOW_MS,
): LedgerPayment | null {
  return (
    payments.find((p) => {
      const created = Date.parse(String(p.createdAt || ""));
      return (
        Number.isFinite(created) &&
        candidate.nowMs - created >= 0 &&
        candidate.nowMs - created < windowMs &&
        roundMoney(p.amount) === roundMoney(candidate.amount) &&
        String(p.paymentMethod || "") === candidate.paymentMethod &&
        String(p.paymentDate || "").slice(0, 10) === candidate.paymentDate &&
        String(p.referenceNumber || "") === String(candidate.referenceNumber || "") &&
        String(p.notes || "") === String(candidate.notes || "") &&
        String(p.recordedBy || "") === candidate.recordedBy
      );
    }) || null
  );
}

export function balanceAfterLedger(grandTotal: number, paid: number): number {
  return Math.max(0, roundMoney(grandTotal - paid));
}

/** Returns an error message when a payment would take the ledger above the invoice total. */
export function overpaymentError(amount: number, grandTotal: number, alreadyPaid: number): string | null {
  const balance = roundMoney(grandTotal - alreadyPaid);
  if (roundMoney(amount) <= balance) return null;
  const pkr = (n: number) => `PKR ${roundMoney(n).toLocaleString("en-PK")}`;
  return balance <= 0
    ? `This invoice is already fully paid (${pkr(alreadyPaid)} of ${pkr(grandTotal)}). Edit the invoice total before recording more.`
    : `Payment of ${pkr(amount)} exceeds the balance due of ${pkr(balance)}.`;
}

type AuditableInvoice = {
  invoiceNumber?: string | null;
  grandTotal?: number | null;
  subtotal?: number | null;
  discountAmount?: number | null;
  paidAmount?: number | null;
  balanceDue?: number | null;
  paymentStatus?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  items?: { description?: string; itemName?: string; qty?: number; rate?: number; lineTotal?: number }[];
};

const AUDITED_FIELDS: [keyof AuditableInvoice, string][] = [
  ["grandTotal", "grand total"],
  ["subtotal", "subtotal"],
  ["discountAmount", "discount"],
  ["paidAmount", "paid"],
  ["balanceDue", "balance"],
  ["paymentStatus", "status"],
  ["customerName", "customer name"],
  ["customerPhone", "customer phone"],
  ["customerId", "customer id"],
  ["invoiceDate", "invoice date"],
  ["dueDate", "due date"],
];

function itemsSignature(items: AuditableInvoice["items"]): string {
  return (items || []).map((i) => `${i.itemName || i.description || "item"}×${Number(i.qty || 0)}@${Number(i.rate || 0)}`).join("; ");
}

/** Human-readable before→after list of financial fields, for the append-only activity log. */
export function describeInvoiceChange(before: AuditableInvoice, after: AuditableInvoice): string[] {
  const changes: string[] = [];
  for (const [key, label] of AUDITED_FIELDS) {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (String(a) !== String(b)) changes.push(`${label}: ${a ?? "—"} → ${b ?? "—"}`);
  }
  const itemsBefore = itemsSignature(before.items);
  const itemsAfter = itemsSignature(after.items);
  if (itemsBefore !== itemsAfter) changes.push(`items: [${itemsBefore || "none"}] → [${itemsAfter || "none"}]`);
  return changes;
}
