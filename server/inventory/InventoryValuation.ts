/**
 * Inventory valuation — weighted average implemented; FIFO architecture ready.
 */

import { safeNumber, type StockBalanceKey, type ValuationMethod } from "./InventoryModels.ts";

export interface ValuationState {
  companyId: string;
  skuId: string;
  warehouseId: string;
  method: ValuationMethod;
  quantityOnHand: number;
  weightedAverageCost: number;
}

/** FIFO-ready cost layer — not consumed until FIFO is implemented. */
export interface FifoCostLayer {
  id: string;
  quantity: number;
  unitCost: number;
  receivedAt: string;
  warehouseId: string;
  binId: string;
}

export interface FifoLayerStore {
  layers: FifoCostLayer[];
}

export function createValuationState(
  key: Pick<StockBalanceKey, "companyId" | "skuId" | "warehouseId">,
  method: ValuationMethod
): ValuationState {
  return {
    companyId: key.companyId,
    skuId: key.skuId,
    warehouseId: key.warehouseId,
    method,
    quantityOnHand: 0,
    weightedAverageCost: 0,
  };
}

/**
 * Weighted average: newAvg = (oldQty * oldAvg + inQty * inCost) / (oldQty + inQty)
 */
export function applyWeightedAverageReceipt(
  state: ValuationState,
  quantityIn: number,
  unitCost: number
): ValuationState {
  const inQty = safeNumber(quantityIn);
  const cost = safeNumber(unitCost);
  if (inQty <= 0) return state;

  const oldQty = safeNumber(state.quantityOnHand);
  const oldAvg = safeNumber(state.weightedAverageCost);
  const newQty = oldQty + inQty;
  const newAvg = newQty > 0 ? (oldQty * oldAvg + inQty * cost) / newQty : 0;

  return {
    ...state,
    quantityOnHand: newQty,
    weightedAverageCost: Math.round(newAvg * 10000) / 10000,
  };
}

export function applyWeightedAverageIssue(
  state: ValuationState,
  quantityOut: number
): ValuationState {
  const outQty = safeNumber(quantityOut);
  if (outQty <= 0) return state;
  const newQty = Math.max(0, safeNumber(state.quantityOnHand) - outQty);
  return {
    ...state,
    quantityOnHand: newQty,
    weightedAverageCost: newQty === 0 ? 0 : state.weightedAverageCost,
  };
}

export function valuationKey(state: ValuationState): string {
  return `${state.companyId}|${state.warehouseId}|${state.skuId}`;
}

/** Append a FIFO layer without consuming (architecture only). */
export function appendFifoLayer(store: FifoLayerStore, layer: FifoCostLayer): FifoLayerStore {
  return {
    layers: [...store.layers, { ...layer, quantity: safeNumber(layer.quantity), unitCost: safeNumber(layer.unitCost) }],
  };
}

/** Placeholder — FIFO consumption not implemented in this phase. */
export function consumeFifoLayers(_store: FifoLayerStore, _quantity: number): never {
  throw new Error("FIFO consumption is not implemented — use weighted_average");
}

export function inventoryValue(state: ValuationState): number {
  return Math.round(safeNumber(state.quantityOnHand) * safeNumber(state.weightedAverageCost) * 100) / 100;
}
