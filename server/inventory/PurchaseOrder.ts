/**
 * Purchase order entity — no supplier payments or accounting.
 */

import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  PURCHASE_ORDER_STATUSES,
  safeNumber,
  type InventoryCompanyScope,
  type PurchaseOrderStatus,
} from "./InventoryModels.ts";

function isNonNegativeNumber(value: unknown): boolean {
  return safeNumber(value) >= 0;
}

export interface PurchaseOrderLine {
  id: string;
  skuId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
}

export interface PurchaseOrder extends InventoryCompanyScope {
  id: string;
  poNumber: string;
  supplierName: string;
  warehouseId: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
}

export type PurchaseOrderInput = Omit<PurchaseOrder, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export function isPurchaseOrderStatus(value: string): value is PurchaseOrderStatus {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function validatePurchaseOrderLine(line: PurchaseOrderLine): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(line.id)) errors.push("line.id is required");
  if (!isNonEmptyString(line.skuId)) errors.push("line.skuId is required");
  if (!isNonNegativeNumber(line.quantityOrdered)) errors.push("quantityOrdered must be non-negative");
  if (!isNonNegativeNumber(line.quantityReceived)) errors.push("quantityReceived must be non-negative");
  if (safeNumber(line.quantityReceived) > safeNumber(line.quantityOrdered)) {
    errors.push("quantityReceived cannot exceed quantityOrdered");
  }
  return errors;
}

export function validatePurchaseOrder(
  input: PurchaseOrderInput
): { ok: true; order: PurchaseOrder } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.poNumber)) errors.push("poNumber is required");
  if (!isNonEmptyString(input.warehouseId)) errors.push("warehouseId is required");
  if (!isPurchaseOrderStatus(input.status)) errors.push("status is invalid");
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push("lines must be non-empty");

  for (const line of input.lines ?? []) {
    errors.push(...validatePurchaseOrderLine(line));
  }

  if (errors.length > 0) return { ok: false, errors };

  const ts = input.createdAt ?? input.updatedAt ?? INVENTORY_DEFAULT_TIMESTAMP;
  return {
    ok: true,
    order: {
      id: input.id.trim(),
      companyId: input.companyId.trim(),
      poNumber: input.poNumber.trim().toUpperCase(),
      supplierName: String(input.supplierName ?? "").trim(),
      warehouseId: input.warehouseId.trim(),
      status: input.status,
      lines: input.lines.map((l) => ({
        ...l,
        quantityOrdered: safeNumber(l.quantityOrdered),
        quantityReceived: safeNumber(l.quantityReceived),
        unitCost: safeNumber(l.unitCost),
      })),
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    },
  };
}

export function createPurchaseOrder(input: PurchaseOrderInput): PurchaseOrder {
  const result = validatePurchaseOrder(input);
  if (!result.ok) throw new Error(`Invalid PO: ${result.errors.join("; ")}`);
  return result.order;
}

export function purchaseOrderOutstandingQty(line: PurchaseOrderLine): number {
  return Math.max(0, safeNumber(line.quantityOrdered) - safeNumber(line.quantityReceived));
}

export function purchaseOrderTotalOutstanding(order: PurchaseOrder): number {
  return order.lines.reduce((sum, line) => sum + purchaseOrderOutstandingQty(line), 0);
}
