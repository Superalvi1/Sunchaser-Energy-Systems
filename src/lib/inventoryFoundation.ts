export const INVENTORY_MOVEMENT_TYPES = [
  "stock_in",
  "stock_out",
  "adjustment",
  "reserve",
  "release",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const RESERVATION_STATUSES = ["reserved", "released", "consumed"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface InventoryFoundationItem {
  id: string;
  productId: string | null;
  category: string;
  brand: string;
  model: string;
  sku: string;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  costPrice: number;
  salePrice: number;
  supplier: string;
  warehouseLocation: string;
  serialRequired: boolean;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovementRecord {
  id: string;
  inventoryItemId: string;
  movementType: InventoryMovementType;
  qty: number;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ProjectInventoryReservation {
  id: string;
  projectId: string;
  deliveryId: string | null;
  inventoryItemId: string;
  qtyReserved: number;
  status: ReservationStatus;
  createdBy: string | null;
  createdAt: string;
}

export function computeAvailableQty(stockQty: number, reservedQty: number): number {
  return Math.max(0, Number(stockQty || 0) - Number(reservedQty || 0));
}

export function isLowStock(item: Pick<InventoryFoundationItem, "availableQty" | "lowStockThreshold">): boolean {
  return item.availableQty <= Number(item.lowStockThreshold || 0);
}

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  stock_in: "Stock In",
  stock_out: "Stock Out",
  adjustment: "Adjustment",
  reserve: "Reserve",
  release: "Release",
};
