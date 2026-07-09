/**
 * In-memory inventory repository — architecture stub, no DB.
 */

import type { RequestActor } from "../middleware/actor.ts";
import type { BinLocation, Shelf } from "./BinLocation.ts";
import { createBinLocation, type BinLocationInput } from "./BinLocation.ts";
import { createInventoryEvent, assertUniqueEventId, type InventoryEvent } from "./InventoryEvents.ts";
import { assertInventoryReadAccess, assertInventoryWriteAccess } from "./InventoryPermissions.ts";
import { createInventorySku, validateInventorySku, type InventorySku, type InventorySkuInput } from "./InventoryItem.ts";
import { createGoodsReceipt, type GoodsReceipt } from "./GoodsReceipt.ts";
import { createPurchaseOrder, type PurchaseOrder } from "./PurchaseOrder.ts";
import {
  serialCompanyLookupKey,
  validateBatchRecord,
  validateSerialNumberRecord,
  InventoryDuplicateSerialError,
  type BatchRecord,
  type SerialNumberRecord,
} from "./SerialBatchTracking.ts";
import { createStockLedger, type StockLedger, type StockLedgerEntry } from "./StockLedger.ts";
import { createValuationState, type ValuationState } from "./InventoryValuation.ts";
import { createWarehouse, type Warehouse, type WarehouseInput } from "./Warehouse.ts";
import { stockBalanceKeyString, type StockBalanceKey } from "./InventoryModels.ts";

export interface InventoryRepository {
  saveSku(input: InventorySkuInput, actor: RequestActor): InventorySku;
  getSku(id: string, actor: RequestActor): InventorySku | null;
  listSkus(companyId: string, actor: RequestActor): InventorySku[];

  saveWarehouse(input: WarehouseInput, actor: RequestActor): Warehouse;
  getWarehouse(id: string, actor: RequestActor): Warehouse | null;
  listWarehouses(companyId: string, actor: RequestActor): Warehouse[];

  saveShelf(shelf: Shelf, actor: RequestActor): Shelf;
  listShelves(warehouseId: string, actor: RequestActor): Shelf[];

  saveBin(input: BinLocationInput, actor: RequestActor): BinLocation;
  getBin(id: string, actor: RequestActor): BinLocation | null;
  listBins(warehouseId: string, actor: RequestActor): BinLocation[];

  savePurchaseOrder(order: PurchaseOrder, actor: RequestActor): PurchaseOrder;
  getPurchaseOrder(id: string, actor: RequestActor): PurchaseOrder | null;

  saveGoodsReceipt(receipt: GoodsReceipt, actor: RequestActor): GoodsReceipt;
  getGoodsReceipt(id: string, actor: RequestActor): GoodsReceipt | null;

  saveSerial(record: SerialNumberRecord, actor: RequestActor): SerialNumberRecord;
  findSerialByCompanyAndNumber(companyId: string, serialNumber: string, actor: RequestActor): SerialNumberRecord | null;
  listSerials(skuId: string, actor: RequestActor): SerialNumberRecord[];

  saveBatch(record: BatchRecord, actor: RequestActor): BatchRecord;
  listBatches(skuId: string, actor: RequestActor): BatchRecord[];

  getLedger(): StockLedger;
  appendLedgerEntry(entry: StockLedgerEntry): StockLedgerEntry;

  getValuation(companyId: string, warehouseId: string, skuId: string): ValuationState | null;
  setValuation(state: ValuationState): ValuationState;

  getBalance(key: StockBalanceKey): number;
  setBalance(key: StockBalanceKey, quantity: number): number;

  listEvents(entityId?: string): InventoryEvent[];
  pushEvent(event: InventoryEvent): InventoryEvent;
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private skus = new Map<string, InventorySku>();
  private warehouses = new Map<string, Warehouse>();
  private shelves = new Map<string, Shelf>();
  private bins = new Map<string, BinLocation>();
  private purchaseOrders = new Map<string, PurchaseOrder>();
  private goodsReceipts = new Map<string, GoodsReceipt>();
  private serials = new Map<string, SerialNumberRecord>();
  private serialsByCompanyKey = new Map<string, string>();
  private batches = new Map<string, BatchRecord>();
  private valuations = new Map<string, ValuationState>();
  private balances = new Map<string, number>();
  private ledger = createStockLedger();
  private events: InventoryEvent[] = [];
  private seenEventIds = new Set<string>();

  saveSku(input: InventorySkuInput, actor: RequestActor): InventorySku {
    assertInventoryWriteAccess(actor);
    const validated = validateInventorySku(input);
    if (!validated.ok) throw new Error(`Invalid SKU: ${validated.errors.join("; ")}`);
    this.skus.set(validated.sku.id, validated.sku);
    return validated.sku;
  }

  getSku(id: string, actor: RequestActor): InventorySku | null {
    assertInventoryReadAccess(actor);
    return this.skus.get(id) ?? null;
  }

  listSkus(companyId: string, actor: RequestActor): InventorySku[] {
    assertInventoryReadAccess(actor);
    return [...this.skus.values()].filter((s) => s.companyId === companyId);
  }

  saveWarehouse(input: WarehouseInput, actor: RequestActor): Warehouse {
    assertInventoryWriteAccess(actor);
    const warehouse = createWarehouse(input);
    this.warehouses.set(warehouse.id, warehouse);
    return warehouse;
  }

  getWarehouse(id: string, actor: RequestActor): Warehouse | null {
    assertInventoryReadAccess(actor);
    return this.warehouses.get(id) ?? null;
  }

  listWarehouses(companyId: string, actor: RequestActor): Warehouse[] {
    assertInventoryReadAccess(actor);
    return [...this.warehouses.values()].filter((w) => w.companyId === companyId);
  }

  saveShelf(shelf: Shelf, actor: RequestActor): Shelf {
    assertInventoryWriteAccess(actor);
    this.shelves.set(shelf.id, shelf);
    return shelf;
  }

  listShelves(warehouseId: string, actor: RequestActor): Shelf[] {
    assertInventoryReadAccess(actor);
    return [...this.shelves.values()].filter((s) => s.warehouseId === warehouseId);
  }

  saveBin(input: BinLocationInput, actor: RequestActor): BinLocation {
    assertInventoryWriteAccess(actor);
    const bin = createBinLocation(input);
    this.bins.set(bin.id, bin);
    return bin;
  }

  getBin(id: string, actor: RequestActor): BinLocation | null {
    assertInventoryReadAccess(actor);
    return this.bins.get(id) ?? null;
  }

  listBins(warehouseId: string, actor: RequestActor): BinLocation[] {
    assertInventoryReadAccess(actor);
    return [...this.bins.values()].filter((b) => b.warehouseId === warehouseId);
  }

  savePurchaseOrder(order: PurchaseOrder, actor: RequestActor): PurchaseOrder {
    assertInventoryWriteAccess(actor);
    const saved = createPurchaseOrder(order);
    this.purchaseOrders.set(saved.id, saved);
    return saved;
  }

  getPurchaseOrder(id: string, actor: RequestActor): PurchaseOrder | null {
    assertInventoryReadAccess(actor);
    return this.purchaseOrders.get(id) ?? null;
  }

  saveGoodsReceipt(receipt: GoodsReceipt, actor: RequestActor): GoodsReceipt {
    assertInventoryWriteAccess(actor);
    const saved = createGoodsReceipt(receipt);
    this.goodsReceipts.set(saved.id, saved);
    return saved;
  }

  getGoodsReceipt(id: string, actor: RequestActor): GoodsReceipt | null {
    assertInventoryReadAccess(actor);
    return this.goodsReceipts.get(id) ?? null;
  }

  saveSerial(record: SerialNumberRecord, actor: RequestActor): SerialNumberRecord {
    assertInventoryWriteAccess(actor);
    const validated = validateSerialNumberRecord(record);
    if (!validated.ok) throw new Error(`Invalid serial: ${validated.errors.join("; ")}`);

    const lookupKey = serialCompanyLookupKey(validated.record.companyId, validated.record.serialNumber);
    if (this.serialsByCompanyKey.has(lookupKey)) {
      throw new InventoryDuplicateSerialError(validated.record.companyId, validated.record.serialNumber);
    }

    this.serials.set(validated.record.id, validated.record);
    this.serialsByCompanyKey.set(lookupKey, validated.record.id);
    return validated.record;
  }

  findSerialByCompanyAndNumber(companyId: string, serialNumber: string, actor: RequestActor): SerialNumberRecord | null {
    assertInventoryReadAccess(actor);
    const recordId = this.serialsByCompanyKey.get(serialCompanyLookupKey(companyId, serialNumber));
    if (!recordId) return null;
    return this.serials.get(recordId) ?? null;
  }

  listSerials(skuId: string, actor: RequestActor): SerialNumberRecord[] {
    assertInventoryReadAccess(actor);
    return [...this.serials.values()].filter((s) => s.skuId === skuId);
  }

  saveBatch(record: BatchRecord, actor: RequestActor): BatchRecord {
    assertInventoryWriteAccess(actor);
    const validated = validateBatchRecord(record);
    if (!validated.ok) throw new Error(`Invalid batch: ${validated.errors.join("; ")}`);
    this.batches.set(validated.record.id, validated.record);
    return validated.record;
  }

  listBatches(skuId: string, actor: RequestActor): BatchRecord[] {
    assertInventoryReadAccess(actor);
    return [...this.batches.values()].filter((b) => b.skuId === skuId);
  }

  getLedger(): StockLedger {
    return this.ledger;
  }

  appendLedgerEntry(entry: StockLedgerEntry): StockLedgerEntry {
    return this.ledger.append({
      key: {
        companyId: entry.companyId,
        warehouseId: entry.warehouseId,
        binId: entry.binId,
        skuId: entry.skuId,
      },
      movementType: entry.movementType,
      quantityDelta: entry.quantityDelta,
      quantityBefore: entry.quantityBefore,
      unitCost: entry.unitCost,
      valuationMethod: entry.valuationMethod,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      actorId: entry.actorId,
      entryId: entry.id,
      note: entry.note,
      createdAt: entry.createdAt,
    });
  }

  getValuation(companyId: string, warehouseId: string, skuId: string): ValuationState | null {
    const key = `${companyId}|${warehouseId}|${skuId}`;
    return this.valuations.get(key) ?? null;
  }

  setValuation(state: ValuationState): ValuationState {
    const key = `${state.companyId}|${state.warehouseId}|${state.skuId}`;
    this.valuations.set(key, { ...state });
    return state;
  }

  getBalance(key: StockBalanceKey): number {
    return this.balances.get(stockBalanceKeyString(key)) ?? 0;
  }

  setBalance(key: StockBalanceKey, quantity: number): number {
    this.balances.set(stockBalanceKeyString(key), quantity);
    return quantity;
  }

  listEvents(entityId?: string): InventoryEvent[] {
    if (!entityId) return [...this.events];
    return this.events.filter((e) => e.entityId === entityId);
  }

  pushEvent(event: InventoryEvent): InventoryEvent {
    const sealed = createInventoryEvent(event);
    assertUniqueEventId(this.seenEventIds, sealed.id);
    this.seenEventIds.add(sealed.id);
    this.events.push(sealed);
    return sealed;
  }
}

export function createInventoryRepository(): InMemoryInventoryRepository {
  return new InMemoryInventoryRepository();
}
