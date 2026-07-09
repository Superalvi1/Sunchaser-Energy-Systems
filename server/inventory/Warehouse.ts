/**
 * Warehouse and zone hierarchy.
 */

import { INVENTORY_DEFAULT_TIMESTAMP, isNonEmptyString, type InventoryCompanyScope } from "./InventoryModels.ts";

export interface WarehouseZone extends InventoryCompanyScope {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Warehouse extends InventoryCompanyScope {
  id: string;
  code: string;
  name: string;
  address: string;
  active: boolean;
  zones: WarehouseZone[];
  createdAt: string;
  updatedAt: string;
}

export type WarehouseInput = Omit<Warehouse, "zones" | "createdAt" | "updatedAt"> & {
  zones?: WarehouseZone[];
  createdAt?: string;
  updatedAt?: string;
};

export function validateWarehouseZone(zone: WarehouseZone, warehouseId: string, companyId: string): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(zone.id)) errors.push("zone.id is required");
  if (zone.warehouseId !== warehouseId) errors.push("zone.warehouseId must match warehouse");
  if (zone.companyId !== companyId) errors.push("zone.companyId must match warehouse company");
  if (!isNonEmptyString(zone.code)) errors.push("zone.code is required");
  if (!isNonEmptyString(zone.name)) errors.push("zone.name is required");
  return errors;
}

export function validateWarehouse(input: WarehouseInput): { ok: true; warehouse: Warehouse } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.code)) errors.push("code is required");
  if (!isNonEmptyString(input.name)) errors.push("name is required");

  const zones = input.zones ?? [];
  for (const zone of zones) {
    errors.push(...validateWarehouseZone(zone, input.id, input.companyId));
  }

  if (errors.length > 0) return { ok: false, errors };

  const ts = input.createdAt ?? input.updatedAt ?? INVENTORY_DEFAULT_TIMESTAMP;
  return {
    ok: true,
    warehouse: {
      id: input.id.trim(),
      companyId: input.companyId.trim(),
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      address: String(input.address ?? "").trim(),
      active: input.active !== false,
      zones: zones.map((z) => ({ ...z, code: z.code.trim().toUpperCase(), name: z.name.trim() })),
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    },
  };
}

export function createWarehouse(input: WarehouseInput): Warehouse {
  const result = validateWarehouse(input);
  if (!result.ok) throw new Error(`Invalid warehouse: ${result.errors.join("; ")}`);
  return result.warehouse;
}
