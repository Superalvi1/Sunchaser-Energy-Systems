/**
 * SKU / inventory item master data.
 */

import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  isUnitOfMeasure,
  normalizeSkuCode,
  safeNumber,
  type InventoryCompanyScope,
  type UnitOfMeasure,
  type ValuationMethod,
} from "./InventoryModels.ts";

export interface InventorySku extends InventoryCompanyScope {
  id: string;
  skuCode: string;
  name: string;
  description: string;
  unitOfMeasure: UnitOfMeasure;
  barcode?: string;
  trackSerial: boolean;
  trackBatch: boolean;
  valuationMethod: ValuationMethod;
  reorderLevel: number;
  allowNegativeStock: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InventorySkuInput = Omit<InventorySku, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface SkuValidationResult {
  ok: true;
  sku: InventorySku;
}

export interface SkuValidationError {
  ok: false;
  errors: string[];
}

export type SkuValidation = SkuValidationResult | SkuValidationError;

export function validateInventorySku(input: InventorySkuInput): SkuValidation {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.skuCode)) errors.push("skuCode is required");
  if (!isNonEmptyString(input.name)) errors.push("name is required");
  if (!isUnitOfMeasure(input.unitOfMeasure)) errors.push("unitOfMeasure is invalid");
  if (input.valuationMethod !== "weighted_average" && input.valuationMethod !== "fifo") {
    errors.push("valuationMethod must be weighted_average or fifo");
  }
  if (safeNumber(input.reorderLevel) < 0) errors.push("reorderLevel must be non-negative");
  if (errors.length > 0) return { ok: false, errors };

  const ts = input.createdAt ?? input.updatedAt ?? INVENTORY_DEFAULT_TIMESTAMP;
  return {
    ok: true,
    sku: {
      id: input.id.trim(),
      companyId: input.companyId.trim(),
      skuCode: normalizeSkuCode(input.skuCode),
      name: input.name.trim(),
      description: String(input.description ?? "").trim(),
      unitOfMeasure: input.unitOfMeasure,
      barcode: input.barcode?.trim() || undefined,
      trackSerial: Boolean(input.trackSerial),
      trackBatch: Boolean(input.trackBatch),
      valuationMethod: input.valuationMethod,
      reorderLevel: safeNumber(input.reorderLevel),
      allowNegativeStock: Boolean(input.allowNegativeStock),
      active: input.active !== false,
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    },
  };
}

export function createInventorySku(input: InventorySkuInput): InventorySku {
  const result = validateInventorySku(input);
  if (!result.ok) throw new Error(`Invalid SKU: ${(result as any).errors.join("; ")}`);
  return result.sku;
}
