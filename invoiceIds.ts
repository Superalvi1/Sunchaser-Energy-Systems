import { randomUUID } from "crypto";

/**
 * Row ids for invoices, their line items and the customer an invoice creates. They used to be the clock alone (`inv-<ms>`, `item-<ms>-<n>`,
 * `cust-inv-<ms>`), so two requests in the same millisecond built the same id and the second insert failed with a duplicate-key error (HTTP 500).
 * A random 48-bit suffix makes a clash practically impossible (the odds for 20 000 ids in one millisecond are below one in a million); the readable prefix and the timestamp are kept.
 */
/** 12 hex characters (48 bits) of a random UUID, without its hyphens. */
const suffix = (): string => randomUUID().replace(/-/g, "").slice(0, 12);
export const newInvoiceId = (): string => `inv-${Date.now()}-${suffix()}`;
export const newInvoiceItemId = (index: number): string => `item-${Date.now()}-${index}-${suffix()}`;
export const newInvoiceCustomerId = (): string => `cust-inv-${Date.now()}-${suffix()}`;
