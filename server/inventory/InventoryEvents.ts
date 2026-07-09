/**
 * Inventory domain events — lifecycle audit trail.
 */

import { INVENTORY_DEFAULT_TIMESTAMP } from "./InventoryModels.ts";

export type InventoryEventType =
  | "sku.created"
  | "sku.updated"
  | "warehouse.created"
  | "bin.created"
  | "movement.posted"
  | "transfer.completed"
  | "reservation.created"
  | "reservation.released"
  | "purchase_order.created"
  | "goods_receipt.posted"
  | "valuation.updated"
  | "serial.registered"
  | "batch.registered";

export const INVENTORY_EVENT_TYPES: readonly InventoryEventType[] = [
  "sku.created",
  "sku.updated",
  "warehouse.created",
  "bin.created",
  "movement.posted",
  "transfer.completed",
  "reservation.created",
  "reservation.released",
  "purchase_order.created",
  "goods_receipt.posted",
  "valuation.updated",
  "serial.registered",
  "batch.registered",
] as const;

export interface InventoryEvent {
  id: string;
  type: InventoryEventType;
  companyId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

export type InventoryEventInput = Omit<InventoryEvent, "occurredAt"> & { occurredAt?: string };

export function createInventoryEvent(input: InventoryEventInput): InventoryEvent {
  return {
    id: input.id.trim(),
    type: input.type,
    companyId: input.companyId.trim(),
    actorId: input.actorId.trim(),
    entityType: input.entityType.trim(),
    entityId: input.entityId.trim(),
    occurredAt: input.occurredAt ?? INVENTORY_DEFAULT_TIMESTAMP,
    payload: { ...input.payload },
  };
}

export class DuplicateInventoryEventError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Duplicate inventory event id: ${eventId.trim()}`);
    this.name = "DuplicateInventoryEventError";
    this.eventId = eventId.trim();
  }
}

export function assertUniqueEventId(seenEventIds: ReadonlySet<string>, eventId: string): void {
  const id = eventId.trim();
  if (seenEventIds.has(id)) {
    throw new DuplicateInventoryEventError(id);
  }
}

export function isInventoryEventType(value: string): value is InventoryEventType {
  return (INVENTORY_EVENT_TYPES as readonly string[]).includes(value);
}

export function sortInventoryEventsDesc(events: InventoryEvent[]): InventoryEvent[] {
  return [...events].sort((a, b) => {
    const diff = b.occurredAt.localeCompare(a.occurredAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
