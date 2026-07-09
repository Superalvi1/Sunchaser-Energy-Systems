/**
 * Append-only stock ledger — every movement creates an immutable entry
 * with quantityBefore and quantityAfter.
 */

import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  isStockMovementType,
  safeNumber,
  stockBalanceKeyString,
  type StockBalanceKey,
  type StockMovementType,
  type ValuationMethod,
} from "./InventoryModels.ts";

export interface StockLedgerEntry {
  id: string;
  companyId: string;
  skuId: string;
  warehouseId: string;
  binId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost: number;
  valuationMethod: ValuationMethod;
  referenceType: string;
  referenceId: string;
  actorId: string;
  createdAt: string;
  note: string;
}

export type StockLedgerEntryInput = Omit<StockLedgerEntry, "createdAt"> & { createdAt?: string };

export interface LedgerAppendInput {
  key: StockBalanceKey;
  movementType: StockMovementType;
  quantityDelta: number;
  quantityBefore: number;
  unitCost: number;
  valuationMethod: ValuationMethod;
  referenceType: string;
  referenceId: string;
  actorId: string;
  entryId: string;
  note?: string;
  createdAt?: string;
}

export class StockLedger {
  private entries: StockLedgerEntry[] = [];
  private frozen = false;

  get length(): number {
    return this.entries.length;
  }

  /** Append-only — returns a new immutable entry. */
  append(input: LedgerAppendInput): StockLedgerEntry {
    if (this.frozen) {
      throw new Error("StockLedger is frozen and cannot accept new entries");
    }

    const quantityBefore = safeNumber(input.quantityBefore);
    const quantityDelta = safeNumber(input.quantityDelta);
    const quantityAfter = safeNumber(quantityBefore + quantityDelta);

    if (!isStockMovementType(input.movementType)) {
      throw new Error(`Invalid movement type: ${input.movementType}`);
    }
    if (!isNonEmptyString(input.entryId)) {
      throw new Error("entryId is required");
    }

    const entry: StockLedgerEntry = {
      id: input.entryId.trim(),
      companyId: input.key.companyId,
      skuId: input.key.skuId,
      warehouseId: input.key.warehouseId,
      binId: input.key.binId,
      movementType: input.movementType,
      quantityDelta,
      quantityBefore,
      quantityAfter,
      unitCost: safeNumber(input.unitCost),
      valuationMethod: input.valuationMethod,
      referenceType: String(input.referenceType || "movement").trim(),
      referenceId: String(input.referenceId || "").trim(),
      actorId: String(input.actorId || "system").trim(),
      createdAt: input.createdAt ?? INVENTORY_DEFAULT_TIMESTAMP,
      note: String(input.note ?? "").trim(),
    };

    this.entries.push(Object.freeze({ ...entry }));
    return entry;
  }

  list(): readonly StockLedgerEntry[] {
    return [...this.entries];
  }

  listByBalanceKey(key: StockBalanceKey): StockLedgerEntry[] {
    const target = stockBalanceKeyString(key);
    return this.entries.filter((e) => stockBalanceKeyString({
      companyId: e.companyId,
      warehouseId: e.warehouseId,
      binId: e.binId,
      skuId: e.skuId,
    }) === target);
  }

  getLatestQuantity(key: StockBalanceKey): number {
    const rows = this.listByBalanceKey(key);
    if (rows.length === 0) return 0;
    return rows[rows.length - 1].quantityAfter;
  }

  /** Verify append-only integrity: each entry's before matches prior after. */
  verifyChain(key: StockBalanceKey): boolean {
    const rows = this.listByBalanceKey(key);
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].quantityBefore !== rows[i - 1].quantityAfter) return false;
    }
    return true;
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }
}

export function createStockLedger(): StockLedger {
  return new StockLedger();
}
