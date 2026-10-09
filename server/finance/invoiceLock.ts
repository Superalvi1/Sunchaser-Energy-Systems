/**
 * Per-invoice lock for work that reads the payment ledger and then writes it or the invoice header.
 *
 * Several PostgREST calls make up one payment (read ledger, check balance, insert, re-sum, update header), so two
 * concurrent requests can both pass the balance check. Queuing them per invoice inside this Node process closes that
 * race for a single app instance. It cannot see other instances: the database guard
 * (scripts: invoice-payments-integrity.sql) is what makes the rule hold across processes.
 *
 * Fail-open: a request waits at most `maxWaitMs` for the previous holder, so one hung upload cannot freeze an invoice.
 */
const tails = new Map<string, Promise<void>>();

export const INVOICE_LOCK_MAX_WAIT_MS = 45_000;

export async function withInvoiceLock<T>(key: string, fn: () => Promise<T>, maxWaitMs = INVOICE_LOCK_MAX_WAIT_MS): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(key, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs);
      }),
    ]);
    return await fn();
  } finally {
    if (timer) clearTimeout(timer);
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Number of invoices currently holding or queueing on a lock (for tests and diagnostics). */
export function invoiceLockCount(): number {
  return tails.size;
}
