/**
 * Inventory engine — orchestrates movements, ledger, valuation, and events.
 */

import type { RequestActor } from "../middleware/actor.ts";
import type { BinLocationInput } from "./BinLocation.ts";
import { createInventoryEvent } from "./InventoryEvents.ts";
import { assertInventoryWriteAccess } from "./InventoryPermissions.ts";
import type { InventorySkuInput } from "./InventoryItem.ts";
import type { GoodsReceipt } from "./GoodsReceipt.ts";
import type { PurchaseOrder, PurchaseOrderLine } from "./PurchaseOrder.ts";
import { purchaseOrderOutstandingQty } from "./PurchaseOrder.ts";
import {
  adjustBatchQuantity,
  InventoryDuplicateSerialError,
  normalizeBatchNumber,
  normalizeSerialNumber,
  type BatchRecord,
  type SerialNumberRecord,
} from "./SerialBatchTracking.ts";
import {
  applyWeightedAverageIssue,
  applyWeightedAverageReceipt,
  appendFifoLayer,
  createValuationState,
  type FifoLayerStore,
} from "./InventoryValuation.ts";
import type { WarehouseInput } from "./Warehouse.ts";
import { safeNumber, type StockBalanceKey } from "./InventoryModels.ts";
import type { StockLedgerEntry } from "./StockLedger.ts";
import {
  buildReservationMovement,
  buildReservationReleaseMovement,
  buildTransferMovements,
  validateStockMovement,
  type StockMovementRequest,
  type TransferRequest,
} from "./StockMovement.ts";
import { createInventoryRepository, type InMemoryInventoryRepository } from "./InventoryRepository.ts";

export interface InventoryEngineOptions {
  repository?: InMemoryInventoryRepository;
  eventIdPrefix?: string;
}

export interface MovementPostResult {
  ok: true;
  entry: StockLedgerEntry;
  quantityAfter: number;
}

export interface MovementPostError {
  ok: false;
  reason: string;
}

export type MovementPostOutcome = MovementPostResult | MovementPostError;

export interface TransferPostResult {
  ok: true;
  outEntry: StockLedgerEntry;
  inEntry: StockLedgerEntry;
}

export class InventoryEngine {
  private repo: InMemoryInventoryRepository;
  private eventCounter = 0;
  private eventIdPrefix: string;
  private fifoLayers: FifoLayerStore = { layers: [] };

  constructor(options: InventoryEngineOptions = {}) {
    this.repo = options.repository ?? createInventoryRepository();
    this.eventIdPrefix = options.eventIdPrefix ?? "ievt";
  }

  get repository(): InMemoryInventoryRepository {
    return this.repo;
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `${this.eventIdPrefix}-${this.eventCounter}`;
  }

  private emit(
    type: Parameters<typeof createInventoryEvent>[0]["type"],
    actor: RequestActor,
    entityType: string,
    entityId: string,
    companyId: string,
    payload: Record<string, string | number | boolean> = {}
  ): void {
    this.repo.pushEvent(
      createInventoryEvent({
        id: this.nextEventId(),
        type,
        companyId,
        actorId: actor.id,
        entityType,
        entityId,
        payload,
      })
    );
  }

  registerSku(input: InventorySkuInput, actor: RequestActor) {
    assertInventoryWriteAccess(actor);
    const sku = this.repo.saveSku(input, actor);
    this.emit("sku.created", actor, "sku", sku.id, sku.companyId, { skuCode: sku.skuCode });
    return sku;
  }

  registerWarehouse(input: WarehouseInput, actor: RequestActor) {
    assertInventoryWriteAccess(actor);
    const warehouse = this.repo.saveWarehouse(input, actor);
    this.emit("warehouse.created", actor, "warehouse", warehouse.id, warehouse.companyId, { code: warehouse.code });
    return warehouse;
  }

  registerBin(input: BinLocationInput, actor: RequestActor) {
    assertInventoryWriteAccess(actor);
    const bin = this.repo.saveBin(input, actor);
    this.emit("bin.created", actor, "bin", bin.id, bin.companyId, { code: bin.code });
    return bin;
  }

  private resolveSku(skuId: string, actor: RequestActor) {
    const sku = this.repo.getSku(skuId, actor);
    if (!sku) return { ok: false as const, reason: "sku_not_found" };
    if (!sku.active) return { ok: false as const, reason: "sku_inactive" };
    return { ok: true as const, sku };
  }

  private getOrCreateValuation(companyId: string, warehouseId: string, skuId: string, method: "weighted_average" | "fifo") {
    const existing = this.repo.getValuation(companyId, warehouseId, skuId);
    if (existing) return existing;
    const state = createValuationState({ companyId, warehouseId, skuId }, method);
    this.repo.setValuation(state);
    return state;
  }

  private postMovement(actor: RequestActor, request: StockMovementRequest): MovementPostOutcome {
    const skuResult = this.resolveSku(request.key.skuId, actor);
    if (!skuResult.ok) return skuResult;

    const before = this.repo.getBalance(request.key);
    const validation = validateStockMovement(skuResult.sku, before, request);
    if (!validation.ok) return validation;

    const entry = this.repo.getLedger().append(validation.ledgerInput);
    this.repo.setBalance(request.key, validation.quantityAfter);

    if (request.movementType === "stock_in" || request.movementType === "opening_stock" || request.movementType === "goods_receipt") {
      const state = this.getOrCreateValuation(
        request.key.companyId,
        request.key.warehouseId,
        request.key.skuId,
        skuResult.sku.valuationMethod
      );
      if (state.method === "weighted_average") {
        const updated = applyWeightedAverageReceipt(state, Math.abs(entry.quantityDelta), entry.unitCost);
        this.repo.setValuation(updated);
        this.emit("valuation.updated", actor, "sku", request.key.skuId, request.key.companyId, {
          weightedAverageCost: updated.weightedAverageCost,
        });
      } else {
        this.fifoLayers = appendFifoLayer(this.fifoLayers, {
          id: entry.id,
          quantity: Math.abs(entry.quantityDelta),
          unitCost: entry.unitCost,
          receivedAt: entry.createdAt,
          warehouseId: request.key.warehouseId,
          binId: request.key.binId,
        });
      }
    }

    if (request.movementType === "stock_out" || request.movementType === "transfer_out") {
      const state = this.repo.getValuation(request.key.companyId, request.key.warehouseId, request.key.skuId);
      if (state && state.method === "weighted_average") {
        this.repo.setValuation(applyWeightedAverageIssue(state, Math.abs(entry.quantityDelta)));
      }
    }

    this.emit("movement.posted", actor, "ledger", entry.id, request.key.companyId, {
      movementType: request.movementType,
      quantityDelta: entry.quantityDelta,
    });

    return { ok: true, entry, quantityAfter: validation.quantityAfter };
  }

  stockIn(
    key: StockBalanceKey,
    quantity: number,
    actor: RequestActor,
    options: { unitCost?: number; referenceId?: string; entryId: string; note?: string } 
  ): MovementPostOutcome {
    return this.postMovement(actor, {
      key,
      movementType: "stock_in",
      quantity,
      unitCost: options.unitCost ?? 0,
      referenceType: "stock_in",
      referenceId: options.referenceId ?? options.entryId,
      actorId: actor.id,
      entryId: options.entryId,
      note: options.note,
    });
  }

  stockOut(
    key: StockBalanceKey,
    quantity: number,
    actor: RequestActor,
    options: { referenceId?: string; entryId: string; allowNegativeOverride?: boolean; note?: string }
  ): MovementPostOutcome {
    return this.postMovement(actor, {
      key,
      movementType: "stock_out",
      quantity,
      referenceType: "stock_out",
      referenceId: options.referenceId ?? options.entryId,
      actorId: actor.id,
      entryId: options.entryId,
      allowNegativeOverride: options.allowNegativeOverride,
      note: options.note,
    });
  }

  openingStock(
    key: StockBalanceKey,
    quantity: number,
    unitCost: number,
    actor: RequestActor,
    entryId: string
  ): MovementPostOutcome {
    return this.postMovement(actor, {
      key,
      movementType: "opening_stock",
      quantity,
      unitCost,
      referenceType: "opening_stock",
      referenceId: entryId,
      actorId: actor.id,
      entryId,
    });
  }

  adjustStock(
    key: StockBalanceKey,
    quantityDelta: number,
    actor: RequestActor,
    entryId: string,
    note?: string
  ): MovementPostOutcome {
    return this.postMovement(actor, {
      key,
      movementType: "adjustment",
      quantity: quantityDelta,
      referenceType: "adjustment",
      referenceId: entryId,
      actorId: actor.id,
      entryId,
      note,
    });
  }

  transfer(request: TransferRequest, actor: RequestActor): TransferPostResult | MovementPostError {
    const skuResult = this.resolveSku(request.skuId, actor);
    if (!skuResult.ok) return skuResult;

    const beforeSource = this.repo.getBalance({
      companyId: request.companyId,
      warehouseId: request.from.warehouseId,
      binId: request.from.binId,
      skuId: request.skuId,
    });

    const built = buildTransferMovements(skuResult.sku, beforeSource, request);
    if ("ok" in built) return built;

    const outResult = this.postMovement(actor, built.out);
    if (!outResult.ok) return outResult;

    const valuation = this.repo.getValuation(request.companyId, request.from.warehouseId, request.skuId);
    const inResult = this.postMovement(actor, {
      ...built.transferIn,
      unitCost: outResult.entry.unitCost || (valuation?.weightedAverageCost ?? 0),
    });
    if (!inResult.ok) return inResult;

    this.emit("transfer.completed", actor, "transfer", request.referenceId, request.companyId, {
      quantity: request.quantity,
    });

    return { ok: true, outEntry: outResult.entry, inEntry: inResult.entry };
  }

  reserve(
    key: StockBalanceKey,
    quantity: number,
    actor: RequestActor,
    referenceId: string,
    entryId: string
  ): MovementPostOutcome {
    const result = this.postMovement(actor, buildReservationMovement({ key, quantity, referenceId, actorId: actor.id, entryId }));
    if (result.ok) {
      this.emit("reservation.created", actor, "reservation", referenceId, key.companyId, { quantity });
    }
    return result;
  }

  releaseReservation(
    key: StockBalanceKey,
    quantity: number,
    actor: RequestActor,
    referenceId: string,
    entryId: string
  ): MovementPostOutcome {
    const result = this.postMovement(
      actor,
      buildReservationReleaseMovement({ key, quantity, referenceId, actorId: actor.id, entryId })
    );
    if (result.ok) {
      this.emit("reservation.released", actor, "reservation", referenceId, key.companyId, { quantity });
    }
    return result;
  }

  createPurchaseOrder(order: PurchaseOrder, actor: RequestActor): PurchaseOrder {
    assertInventoryWriteAccess(actor);
    const saved = this.repo.savePurchaseOrder(order, actor);
    this.emit("purchase_order.created", actor, "purchase_order", saved.id, saved.companyId, { poNumber: saved.poNumber });
    return saved;
  }

  postGoodsReceipt(receipt: GoodsReceipt, actor: RequestActor): { ok: true; receipt: GoodsReceipt; entries: StockLedgerEntry[] } | MovementPostError {
    assertInventoryWriteAccess(actor);
    const po = this.repo.getPurchaseOrder(receipt.purchaseOrderId, actor);
    if (!po) return { ok: false, reason: "purchase_order_not_found" };

    const entries: StockLedgerEntry[] = [];
    let lineIndex = 0;

    for (const line of receipt.lines) {
      const poLine = po.lines.find((l) => l.id === line.purchaseOrderLineId);
      if (!poLine) return { ok: false, reason: `po_line_not_found:${line.purchaseOrderLineId}` };

      const outstanding = purchaseOrderOutstandingQty(poLine);
      if (safeNumber(line.quantityReceived) > outstanding) {
        return { ok: false, reason: "quantity_exceeds_po_outstanding" };
      }

      if (line.serialNumbers?.length) {
        const seenInLine = new Set<string>();
        for (const sn of line.serialNumbers) {
          const normalized = normalizeSerialNumber(sn);
          if (seenInLine.has(normalized)) {
            throw new InventoryDuplicateSerialError(receipt.companyId, sn);
          }
          seenInLine.add(normalized);
          if (this.repo.findSerialByCompanyAndNumber(receipt.companyId, sn, actor)) {
            throw new InventoryDuplicateSerialError(receipt.companyId, sn);
          }
        }
      }

      const key: StockBalanceKey = {
        companyId: receipt.companyId,
        warehouseId: receipt.warehouseId,
        binId: receipt.binId,
        skuId: line.skuId,
      };

      const entryId = `${receipt.id}-line-${lineIndex}`;
      const movement = this.postMovement(actor, {
        key,
        movementType: "goods_receipt",
        quantity: line.quantityReceived,
        unitCost: line.unitCost,
        referenceType: "goods_receipt",
        referenceId: receipt.id,
        actorId: actor.id,
        entryId,
      });

      if (!movement.ok) return movement;
      entries.push(movement.entry);

      if (line.serialNumbers?.length) {
        for (const sn of line.serialNumbers) {
          const serial: SerialNumberRecord = {
            id: `${entryId}-sn-${normalizeSerialNumber(sn)}`,
            companyId: receipt.companyId,
            skuId: line.skuId,
            serialNumber: sn,
            warehouseId: receipt.warehouseId,
            binId: receipt.binId,
            status: "available",
          };
          this.repo.saveSerial(serial, actor);
          this.emit("serial.registered", actor, "serial", serial.id, receipt.companyId, { serialNumber: serial.serialNumber });
        }
      }

      if (line.batchNumber) {
        const batchId = `${entryId}-batch-${normalizeBatchNumber(line.batchNumber)}`;
        const existing = this.repo.listBatches(line.skuId, actor).find((b) => b.batchNumber === normalizeBatchNumber(line.batchNumber));
        if (existing) {
          const updated = adjustBatchQuantity(existing, line.quantityReceived);
          this.repo.saveBatch(updated, actor);
        } else {
          const batch: BatchRecord = {
            id: batchId,
            companyId: receipt.companyId,
            skuId: line.skuId,
            batchNumber: line.batchNumber,
            quantityOnHand: line.quantityReceived,
            status: "available",
            warehouseId: receipt.warehouseId,
            binId: receipt.binId,
          };
          this.repo.saveBatch(batch, actor);
          this.emit("batch.registered", actor, "batch", batch.id, receipt.companyId, { batchNumber: batch.batchNumber });
        }
      }

      poLine.quantityReceived = safeNumber(poLine.quantityReceived) + safeNumber(line.quantityReceived);
      lineIndex += 1;
    }

    const updatedPo = this.updatePoStatus(po);
    this.repo.savePurchaseOrder(updatedPo, actor);

    const savedReceipt = this.repo.saveGoodsReceipt({ ...receipt, status: "posted" }, actor);
    this.emit("goods_receipt.posted", actor, "goods_receipt", savedReceipt.id, savedReceipt.companyId, {
      grnNumber: savedReceipt.grnNumber,
    });

    return { ok: true, receipt: savedReceipt, entries };
  }

  private updatePoStatus(po: PurchaseOrder): PurchaseOrder {
    const totalOutstanding = po.lines.reduce((sum, line) => sum + purchaseOrderOutstandingQty(line), 0);
    let status = po.status;
    if (totalOutstanding === 0) status = "received";
    else if (po.lines.some((l) => safeNumber(l.quantityReceived) > 0)) status = "partially_received";
    return { ...po, status };
  }

  getBalance(key: StockBalanceKey): number {
    return this.repo.getBalance(key);
  }

  getFifoLayers(): FifoLayerStore {
    return { layers: [...this.fifoLayers.layers] };
  }
}

export function createInventoryEngine(options?: InventoryEngineOptions): InventoryEngine {
  return new InventoryEngine(options);
}
