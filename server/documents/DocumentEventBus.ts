/**
 * Stage 9 — Event bus.
 *
 * Real, synchronous, in-memory publish/subscribe. A throwing subscriber never
 * stops delivery to the remaining subscribers, and never propagates out of
 * publish() — the bus isolates handler failures and reports them back to the
 * caller instead.
 */

import { DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP } from "./DocumentModels.ts";

export type DocumentPipelineEventType =
  | "pipeline.upload_received"
  | "pipeline.virus_scan_completed"
  | "pipeline.checksum_computed"
  | "pipeline.duplicate_detected"
  | "pipeline.version_resolved"
  | "pipeline.stored"
  | "pipeline.permissions_assigned"
  | "pipeline.repository_saved"
  | "pipeline.ocr_enqueued"
  | "pipeline.embedding_enqueued"
  | "pipeline.completed"
  | "pipeline.failed";

export const DOCUMENT_PIPELINE_EVENT_TYPES: readonly DocumentPipelineEventType[] = [
  "pipeline.upload_received",
  "pipeline.virus_scan_completed",
  "pipeline.checksum_computed",
  "pipeline.duplicate_detected",
  "pipeline.version_resolved",
  "pipeline.stored",
  "pipeline.permissions_assigned",
  "pipeline.repository_saved",
  "pipeline.ocr_enqueued",
  "pipeline.embedding_enqueued",
  "pipeline.completed",
  "pipeline.failed",
] as const;

export function isDocumentPipelineEventType(value: string): value is DocumentPipelineEventType {
  return (DOCUMENT_PIPELINE_EVENT_TYPES as readonly string[]).includes(value);
}

export interface DocumentPipelineEvent {
  id: string;
  type: DocumentPipelineEventType;
  familyId: string;
  actorId: string;
  companyId: string;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

export type DocumentPipelineEventInput = Omit<DocumentPipelineEvent, "occurredAt"> & { occurredAt?: string };

export function createDocumentPipelineEvent(input: DocumentPipelineEventInput): DocumentPipelineEvent {
  return {
    id: input.id.trim(),
    type: input.type,
    familyId: input.familyId.trim(),
    actorId: input.actorId.trim(),
    companyId: input.companyId.trim(),
    occurredAt: input.occurredAt ?? DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP,
    payload: { ...input.payload },
  };
}

export type DocumentEventHandler = (event: DocumentPipelineEvent) => void;
export type Unsubscribe = () => void;

export interface HandlerFailure {
  eventId: string;
  eventType: DocumentPipelineEventType;
  error: string;
}

export interface DocumentEventBus {
  subscribe(type: DocumentPipelineEventType, handler: DocumentEventHandler): Unsubscribe;
  subscribeAll(handler: DocumentEventHandler): Unsubscribe;
  publish(event: DocumentPipelineEvent): HandlerFailure[];
  history(familyId?: string): DocumentPipelineEvent[];
}

/** Real in-memory pub/sub. Delivery order is subscription order. */
export class InMemoryDocumentEventBus implements DocumentEventBus {
  private typed = new Map<DocumentPipelineEventType, DocumentEventHandler[]>();
  private wildcard: DocumentEventHandler[] = [];
  private log: DocumentPipelineEvent[] = [];

  subscribe(type: DocumentPipelineEventType, handler: DocumentEventHandler): Unsubscribe {
    const list = this.typed.get(type) ?? [];
    list.push(handler);
    this.typed.set(type, list);
    return () => {
      this.typed.set(type, (this.typed.get(type) ?? []).filter((h) => h !== handler));
    };
  }

  subscribeAll(handler: DocumentEventHandler): Unsubscribe {
    this.wildcard.push(handler);
    return () => {
      this.wildcard = this.wildcard.filter((h) => h !== handler);
    };
  }

  publish(event: DocumentPipelineEvent): HandlerFailure[] {
    this.log.push(event);
    const failures: HandlerFailure[] = [];
    const handlers = [...(this.typed.get(event.type) ?? []), ...this.wildcard];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        failures.push({
          eventId: event.id,
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return failures;
  }

  history(familyId?: string): DocumentPipelineEvent[] {
    const filtered = familyId ? this.log.filter((e) => e.familyId === familyId) : [...this.log];
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Test helper. */
  subscriberCount(type: DocumentPipelineEventType): number {
    return (this.typed.get(type) ?? []).length;
  }
}

export function createInMemoryDocumentEventBus(): InMemoryDocumentEventBus {
  return new InMemoryDocumentEventBus();
}
