import type { InvoiceRecord } from "./invoices.ts";

const VALID_METHODS = new Set(["Cash", "Bank transfer", "Cheque", "Online"]);

/** Map invoice paymentMode / method to DB-allowed payment_method. */
export function coercePaymentMethod(mode?: string | null): string {
  const m = String(mode || "").trim();
  if (VALID_METHODS.has(m)) return m;
  return "Cash";
}

/**
 * Primary: SUM(invoice_payments). Fallback: invoice.paid_amount when no rows.
 * Logs warning when header and payment sum disagree.
 */
export function resolveInvoiceReceivedAmount(inv: {
  paidAmount?: number;
  payments?: Array<{ amount?: number }> | null;
  invoiceNumber?: string;
  id?: string;
}): number {
  const headerPaid = Number(inv.paidAmount ?? 0);
  const payments = inv.payments || [];
  if (payments.length > 0) {
    const sum = Math.round(
      payments.reduce((s, p) => s + Number(p.amount || 0), 0) * 100
    ) / 100;
    if (Math.abs(sum - headerPaid) > 0.01) {
      console.warn(
        "[PartyLedger] paid_amount mismatch",
        JSON.stringify({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          headerPaid,
          paymentsSum: sum,
        })
      );
    }
    return sum;
  }
  return headerPaid;
}

export function resolveInvoiceBalanceDue(inv: InvoiceRecord): number {
  const received = resolveInvoiceReceivedAmount(inv);
  return Math.max(
    0,
    Math.round((Number(inv.grandTotal || 0) - received) * 100) / 100
  );
}
