/**
 * Serial and batch number tracking.
 */

import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  safeNumber,
  type BatchStatus,
  type SerialStatus,
} from "./InventoryModels.ts";

export interface SerialNumberRecord {
  id: string;
  companyId: string;
  skuId: string;
  serialNumber: string;
  warehouseId: string;
  binId: string;
  status: SerialStatus;
  batchId?: string;
  createdAt: string;
}

export interface BatchRecord {
  id: string;
  companyId: string;
  skuId: string;
  batchNumber: string;
  quantityOnHand: number;
  expiryDate?: string;
  status: BatchStatus;
  warehouseId: string;
  binId: string;
  createdAt: string;
}

export function normalizeSerialNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_.]/g, "");
}

export function serialCompanyLookupKey(companyId: string, serialNumber: string): string {
  return `${companyId.trim()}|${normalizeSerialNumber(serialNumber)}`;
}

export class InventoryDuplicateSerialError extends Error {
  readonly companyId: string;
  readonly serialNumber: string;

  constructor(companyId: string, serialNumber: string) {
    const normalized = normalizeSerialNumber(serialNumber);
    super(`Duplicate serial for company ${companyId}: ${normalized}`);
    this.name = "InventoryDuplicateSerialError";
    this.companyId = companyId.trim();
    this.serialNumber = normalized;
  }
}

export function normalizeBatchNumber(value: string): string {
  return value.trim().toUpperCase();
}

export function validateSerialNumberRecord(
  input: SerialNumberRecord
): { ok: true; record: SerialNumberRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.skuId)) errors.push("skuId is required");
  if (!isNonEmptyString(input.serialNumber)) errors.push("serialNumber is required");
  if (!isNonEmptyString(input.warehouseId)) errors.push("warehouseId is required");
  if (!isNonEmptyString(input.binId)) errors.push("binId is required");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    record: {
      ...input,
      serialNumber: normalizeSerialNumber(input.serialNumber),
      createdAt: input.createdAt ?? INVENTORY_DEFAULT_TIMESTAMP,
    },
  };
}

export function validateBatchRecord(
  input: BatchRecord
): { ok: true; record: BatchRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.batchNumber)) errors.push("batchNumber is required");
  if (safeNumber(input.quantityOnHand) < 0) errors.push("quantityOnHand must be non-negative");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    record: {
      ...input,
      batchNumber: normalizeBatchNumber(input.batchNumber),
      quantityOnHand: safeNumber(input.quantityOnHand),
      createdAt: input.createdAt ?? INVENTORY_DEFAULT_TIMESTAMP,
    },
  };
}

export function issueSerial(record: SerialNumberRecord): SerialNumberRecord {
  return { ...record, status: "issued" };
}

export function reserveSerial(record: SerialNumberRecord): SerialNumberRecord {
  if (record.status !== "available") {
    throw new Error(`Cannot reserve serial in status ${record.status}`);
  }
  return { ...record, status: "reserved" };
}

export function releaseSerialReservation(record: SerialNumberRecord): SerialNumberRecord {
  if (record.status !== "reserved") {
    throw new Error(`Cannot release serial in status ${record.status}`);
  }
  return { ...record, status: "available" };
}

export function adjustBatchQuantity(batch: BatchRecord, delta: number): BatchRecord {
  const next = safeNumber(batch.quantityOnHand + delta);
  if (next < 0) throw new Error("Batch quantity cannot go negative");
  return {
    ...batch,
    quantityOnHand: next,
    status: next === 0 ? "depleted" : batch.status,
  };
}
