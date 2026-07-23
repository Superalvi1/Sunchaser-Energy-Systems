/**
 * Stock movement commands — stock in/out, transfers, adjustments, reservations.
 */

import { safeNumber, type StockBalanceKey, type StockMovementType } from "./InventoryModels.ts";
import type { InventorySku } from "./InventoryItem.ts";
import type { LedgerAppendInput } from "./StockLedger.ts";

export interface StockMovementRequest {
  key: StockBalanceKey;
  movementType: StockMovementType;
  quantity: number;
  unitCost?: number;
  referenceType: string;
  referenceId: string;
  actorId: string;
  entryId: string;
  note?: string;
  allowNegativeOverride?: boolean;
}

export interface StockMovementResult {
  ok: true;
  ledgerInput: LedgerAppendInput;
  quantityBefore: number;
  quantityAfter: number;
}

export interface StockMovementError {
  ok: false;
  reason: string;
}

export type StockMovementOutcome = StockMovementResult | StockMovementError;

export function movementDelta(type: StockMovementType, quantity: number): number {
  const q = Math.abs(safeNumber(quantity));
  switch (type) {
    case "stock_in":
    case "transfer_in":
    case "opening_stock":
    case "goods_receipt":
    case "reservation_release":
      return q;
    case "stock_out":
    case "transfer_out":
    case "reservation":
      return -q;
    case "adjustment":
      return safeNumber(quantity);
    default:
      return safeNumber(quantity);
  }
}

export function validateStockMovement(
  sku: InventorySku,
  quantityBefore: number,
  request: StockMovementRequest
): StockMovementOutcome {
  const qty = safeNumber(request.quantity);
  if (qty === 0 && request.movementType !== "adjustment") {
    return { ok: false, reason: "quantity must be non-zero" };
  }

  const delta = movementDelta(request.movementType, qty);
  const after = safeNumber(quantityBefore + delta);
  const allowNegative = Boolean(request.allowNegativeOverride || sku.allowNegativeStock);

  if (after < 0 && !allowNegative) {
    return { ok: false, reason: "negative_stock_not_allowed" };
  }

  if (sku.trackSerial && Math.abs(delta) !== Math.floor(Math.abs(delta))) {
    return { ok: false, reason: "serial_tracked_sku_requires_whole_units" };
  }

  return {
    ok: true,
    quantityBefore,
    quantityAfter: after,
    ledgerInput: {
      key: request.key,
      movementType: request.movementType,
      quantityDelta: delta,
      quantityBefore,
      unitCost: safeNumber(request.unitCost),
      valuationMethod: sku.valuationMethod,
      referenceType: request.referenceType,
      referenceId: request.referenceId,
      actorId: request.actorId,
      entryId: request.entryId,
      note: request.note,
    },
  };
}

export interface TransferRequest {
  companyId: string;
  skuId: string;
  quantity: number;
  from: { warehouseId: string; binId: string };
  to: { warehouseId: string; binId: string };
  referenceId: string;
  actorId: string;
  outEntryId: string;
  inEntryId: string;
}

export function buildTransferMovements(
  sku: InventorySku,
  quantityBeforeSource: number,
  request: TransferRequest
): { out: StockMovementRequest; transferIn: StockMovementRequest } | StockMovementError {
  if (request.from.warehouseId === request.to.warehouseId && request.from.binId === request.to.binId) {
    return { ok: false, reason: "transfer_source_equals_destination" };
  }

  const qty = safeNumber(request.quantity);
  if (qty <= 0) return { ok: false, reason: "transfer_quantity_must_be_positive" };

  const out: StockMovementRequest = {
    key: {
      companyId: request.companyId,
      skuId: request.skuId,
      warehouseId: request.from.warehouseId,
      binId: request.from.binId,
    },
    movementType: "transfer_out",
    quantity: qty,
    referenceType: "transfer",
    referenceId: request.referenceId,
    actorId: request.actorId,
    entryId: request.outEntryId,
  };

  const outValidation = validateStockMovement(sku, quantityBeforeSource, out);
  if (!outValidation.ok) return outValidation as any;

  const transferIn: StockMovementRequest = {
    key: {
      companyId: request.companyId,
      skuId: request.skuId,
      warehouseId: request.to.warehouseId,
      binId: request.to.binId,
    },
    movementType: "transfer_in",
    quantity: qty,
    unitCost: outValidation.ledgerInput.unitCost,
    referenceType: "transfer",
    referenceId: request.referenceId,
    actorId: request.actorId,
    entryId: request.inEntryId,
  };

  return { out, transferIn };
}

export interface ReservationRequest {
  key: StockBalanceKey;
  quantity: number;
  referenceId: string;
  actorId: string;
  entryId: string;
}

export function buildReservationMovement(request: ReservationRequest): StockMovementRequest {
  return {
    key: request.key,
    movementType: "reservation",
    quantity: request.quantity,
    referenceType: "reservation",
    referenceId: request.referenceId,
    actorId: request.actorId,
    entryId: request.entryId,
  };
}

export function buildReservationReleaseMovement(request: ReservationRequest): StockMovementRequest {
  return {
    key: request.key,
    movementType: "reservation_release",
    quantity: request.quantity,
    referenceType: "reservation",
    referenceId: request.referenceId,
    actorId: request.actorId,
    entryId: request.entryId,
  };
}
