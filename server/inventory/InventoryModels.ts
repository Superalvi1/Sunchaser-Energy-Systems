/**
 * Enterprise Inventory — shared domain models (backend architecture only).
 * Pure TypeScript. No routes, UI, DB, or network.
 */

export const INVENTORY_DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const UNITS_OF_MEASURE = [
  "each",
  "piece",
  "box",
  "pack",
  "kg",
  "g",
  "liter",
  "meter",
  "roll",
  "pallet",
] as const;

export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const STOCK_MOVEMENT_TYPES = [
  "opening_stock",
  "stock_in",
  "stock_out",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "reservation",
  "reservation_release",
  "goods_receipt",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const VALUATION_METHODS = ["weighted_average", "fifo"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "partially_received",
  "received",
  "cancelled",
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const GOODS_RECEIPT_STATUSES = ["draft", "posted", "cancelled"] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

export const SERIAL_STATUSES = ["available", "reserved", "issued", "scrapped"] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const BATCH_STATUSES = ["available", "quarantine", "expired", "depleted"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface InventoryCompanyScope {
  companyId: string;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSkuCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isUnitOfMeasure(value: string): value is UnitOfMeasure {
  return (UNITS_OF_MEASURE as readonly string[]).includes(value);
}

export function isStockMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

export interface StockBalanceKey {
  companyId: string;
  warehouseId: string;
  binId: string;
  skuId: string;
}

export function stockBalanceKeyString(key: StockBalanceKey): string {
  return `${key.companyId}|${key.warehouseId}|${key.binId}|${key.skuId}`;
}
