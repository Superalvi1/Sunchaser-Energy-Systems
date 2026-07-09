/**
 * Goods receipt (GRN) against purchase orders — no payment logic.
 */

import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  GOODS_RECEIPT_STATUSES,
  safeNumber,
  type GoodsReceiptStatus,
  type InventoryCompanyScope,
} from "./InventoryModels.ts";

export interface GoodsReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  skuId: string;
  quantityReceived: number;
  unitCost: number;
  batchNumber?: string;
  serialNumbers?: string[];
}

export interface GoodsReceipt extends InventoryCompanyScope {
  id: string;
  grnNumber: string;
  purchaseOrderId: string;
  warehouseId: string;
  binId: string;
  status: GoodsReceiptStatus;
  lines: GoodsReceiptLine[];
  receivedAt: string;
  actorId: string;
}

export function isGoodsReceiptStatus(value: string): value is GoodsReceiptStatus {
  return (GOODS_RECEIPT_STATUSES as readonly string[]).includes(value);
}

export function validateGoodsReceiptLine(line: GoodsReceiptLine): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(line.id)) errors.push("line.id is required");
  if (!isNonEmptyString(line.purchaseOrderLineId)) errors.push("purchaseOrderLineId is required");
  if (!isNonEmptyString(line.skuId)) errors.push("line.skuId is required");
  if (safeNumber(line.quantityReceived) <= 0) errors.push("quantityReceived must be positive");
  return errors;
}

export function validateGoodsReceipt(
  input: GoodsReceipt
): { ok: true; receipt: GoodsReceipt } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.grnNumber)) errors.push("grnNumber is required");
  if (!isNonEmptyString(input.purchaseOrderId)) errors.push("purchaseOrderId is required");
  if (!isNonEmptyString(input.warehouseId)) errors.push("warehouseId is required");
  if (!isNonEmptyString(input.binId)) errors.push("binId is required");
  if (!isGoodsReceiptStatus(input.status)) errors.push("status is invalid");
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push("lines required");

  for (const line of input.lines ?? []) {
    errors.push(...validateGoodsReceiptLine(line));
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    receipt: {
      ...input,
      grnNumber: input.grnNumber.trim().toUpperCase(),
      lines: input.lines.map((l) => ({
        ...l,
        quantityReceived: safeNumber(l.quantityReceived),
        unitCost: safeNumber(l.unitCost),
      })),
      receivedAt: input.receivedAt ?? INVENTORY_DEFAULT_TIMESTAMP,
    },
  };
}

export function createGoodsReceipt(input: GoodsReceipt): GoodsReceipt {
  const result = validateGoodsReceipt(input);
  if (!result.ok) throw new Error(`Invalid GRN: ${result.errors.join("; ")}`);
  return result.receipt;
}

export function goodsReceiptTotalQuantity(receipt: GoodsReceipt): number {
  return receipt.lines.reduce((sum, l) => sum + safeNumber(l.quantityReceived), 0);
}
