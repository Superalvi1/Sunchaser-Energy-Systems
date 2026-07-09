/**
 * Shelf and bin locations within warehouse zones.
 */

import { INVENTORY_DEFAULT_TIMESTAMP, isNonEmptyString, type InventoryCompanyScope } from "./InventoryModels.ts";

export interface Shelf extends InventoryCompanyScope {
  id: string;
  warehouseId: string;
  zoneId: string;
  code: string;
  name: string;
  active: boolean;
}

export interface BinLocation extends InventoryCompanyScope {
  id: string;
  warehouseId: string;
  zoneId: string;
  shelfId: string;
  code: string;
  name: string;
  barcode?: string;
  active: boolean;
  createdAt: string;
}

export type BinLocationInput = Omit<BinLocation, "createdAt"> & { createdAt?: string };

export function validateShelf(shelf: Shelf): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(shelf.id)) errors.push("shelf.id is required");
  if (!isNonEmptyString(shelf.companyId)) errors.push("shelf.companyId is required");
  if (!isNonEmptyString(shelf.warehouseId)) errors.push("shelf.warehouseId is required");
  if (!isNonEmptyString(shelf.zoneId)) errors.push("shelf.zoneId is required");
  if (!isNonEmptyString(shelf.code)) errors.push("shelf.code is required");
  return errors;
}

export function validateBinLocation(input: BinLocationInput): { ok: true; bin: BinLocation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.warehouseId)) errors.push("warehouseId is required");
  if (!isNonEmptyString(input.zoneId)) errors.push("zoneId is required");
  if (!isNonEmptyString(input.shelfId)) errors.push("shelfId is required");
  if (!isNonEmptyString(input.code)) errors.push("code is required");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    bin: {
      id: input.id.trim(),
      companyId: input.companyId.trim(),
      warehouseId: input.warehouseId.trim(),
      zoneId: input.zoneId.trim(),
      shelfId: input.shelfId.trim(),
      code: input.code.trim().toUpperCase(),
      name: String(input.name ?? input.code).trim(),
      barcode: input.barcode?.trim() || undefined,
      active: input.active !== false,
      createdAt: input.createdAt ?? INVENTORY_DEFAULT_TIMESTAMP,
    },
  };
}

export function createBinLocation(input: BinLocationInput): BinLocation {
  const result = validateBinLocation(input);
  if (!result.ok) throw new Error(`Invalid bin: ${result.errors.join("; ")}`);
  return result.bin;
}

export function binLocationPath(bin: BinLocation, zoneCode: string, shelfCode: string): string {
  return `${zoneCode}/${shelfCode}/${bin.code}`;
}
