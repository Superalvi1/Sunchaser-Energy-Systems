import { createHash, randomUUID } from "node:crypto";

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

/**
 * Rounds to whole paisa, half away from zero, without binary floating point surprises
 * (1.005 * 100 is 100.49999999999999, so the naive Math.round(x * 100) / 100 stores 1.00 instead of 1.01).
 */
export function roundMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 0 : n;
  const text = String(Math.abs(n));
  // Exponent notation (very large or tiny values) cannot be shifted as text; plain scaling is precise enough there.
  if (/e/i.test(text)) return Math.round(n * 100) / 100;
  const rounded = Number(`${Math.round(Number(`${text}e2`))}e-2`);
  return n < 0 ? -rounded : rounded;
}

/**
 * Strict payment amount parser. Accepts a finite number or a plain decimal string ("25000", "25000.50").
 * Booleans, arrays, hex ("0x10"), exponents ("1e3"), thousands separators and "Infinity" are rejected, because
 * Number() would otherwise turn them into real money. Returns whole paisa, or null when the input is not an amount.
 */
export function parsePaymentAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? roundMoney(raw) : null;
  if (typeof raw === "string" && /^\s*\d+(\.\d+)?\s*$/.test(raw)) return roundMoney(Number(raw.trim()));
  return null;
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

/** Id for a payment the user explicitly confirmed as a second identical payment (legacy clients without a request id). */
export function confirmedPaymentId(): string {
  return `pay-${createHash("sha256").update(`confirmed\n${randomUUID()}`).digest("hex").slice(0, 32)}`;
}

type RequestedPayment = {
  amount: number;
  /** Only fields the caller actually sent are compared, so a retry that omits optional fields is still a retry. */
  paymentMethod?: string;
  paymentDate?: string;
  referenceNumber?: string | null;
  notes?: string | null;
};

const norm = (v: unknown) => String(v ?? "").trim();

/**
 * A client request id names ONE payment. When it is reused for a payment that differs from the stored one,
 * returns a short description of the stored payment; the caller must answer with a conflict, never with a replay.
 */
export function paymentRequestConflict(stored: LedgerPayment, requested: RequestedPayment): string | null {
  const differs =
    roundMoney(stored.amount) !== roundMoney(requested.amount) ||
    (requested.paymentMethod !== undefined && norm(stored.paymentMethod) !== norm(requested.paymentMethod)) ||
    (requested.paymentDate !== undefined && norm(stored.paymentDate).slice(0, 10) !== norm(requested.paymentDate).slice(0, 10)) ||
    (requested.referenceNumber !== undefined && norm(stored.referenceNumber) !== norm(requested.referenceNumber)) ||
    (requested.notes !== undefined && norm(stored.notes) !== norm(requested.notes));
  if (!differs) return null;
  const pkr = `PKR ${roundMoney(stored.amount).toLocaleString("en-PK")}`;
  const when = norm(stored.paymentDate).slice(0, 10);
  return `${pkr}${stored.paymentMethod ? ` ${stored.paymentMethod}` : ""}${when ? ` on ${when}` : ""}`;
}

export type LedgerGuardKind =
  | "overpayment"
  | "total_below_payments"
  | "not_collectible"
  | "has_payments"
  | "invalid_payment"
  | "opening_balance_missing"
  | "busy";

/**
 * Recognises rejections raised by the optional database guard (scripts: invoice-payments-integrity.sql).
 * Matches the stable message tag, so it works whatever status PostgREST attaches. Returns null for any other error.
 */
export function ledgerGuardKind(err: unknown): LedgerGuardKind | null {
  const message = String((err as { message?: unknown } | null)?.message || "");
  if (message.startsWith("invoice_overpayment")) return "overpayment";
  if (message.startsWith("invoice_total_below_payments")) return "total_below_payments";
  if (message.startsWith("invoice_not_collectible")) return "not_collectible";
  if (message.startsWith("invoice_has_payments")) return "has_payments";
  if (message.startsWith("invoice_payment_invalid")) return "invalid_payment";
  if (message.startsWith("invoice_opening_balance_missing")) return "opening_balance_missing";
  if (message.startsWith("invoice_busy")) return "busy";
  return null;
}

/**
 * Failures that leave nothing behind and are worth repeating: a deadlock victim (40P01), a serialization failure (40001),
 * a lock wait that timed out (55P03) or the guard's own invoice_busy tag. Payment ids are deterministic, so repeating an
 * insert whose first attempt did commit ends in a duplicate-id replay, never in a second payment.
 */
export function isTransientDbError(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code || "");
  return code === "40001" || code === "40P01" || code === "55P03" || ledgerGuardKind(err) === "busy";
}

/** Invoice states that must not take new payments. 'archived' stays collectible: there is no restore path for invoices. */
export const NON_COLLECTIBLE_INVOICE_STATUSES = ["void", "duplicate", "test"] as const;

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
