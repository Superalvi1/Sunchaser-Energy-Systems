/**
 * Knowledge platform event types — lifecycle audit trail (architecture only).
 */

import type { KnowledgeDocument } from "./KnowledgeDocument.ts";
import { KNOWLEDGE_DEFAULT_TIMESTAMP } from "./KnowledgeModels.ts";

export type KnowledgeEventType =
  | "document.created"
  | "document.updated"
  | "document.archived"
  | "document.deleted"
  | "document.visibility_changed"
  | "index.requested"
  | "index.completed"
  | "index.failed"
  | "search.requested";

export const KNOWLEDGE_EVENT_TYPES: readonly KnowledgeEventType[] = [
  "document.created",
  "document.updated",
  "document.archived",
  "document.deleted",
  "document.visibility_changed",
  "index.requested",
  "index.completed",
  "index.failed",
  "search.requested",
] as const;

export interface KnowledgeEvent {
  id: string;
  type: KnowledgeEventType;
  documentId: string;
  actorId: string;
  companyId: string;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

export type KnowledgeEventInput = Omit<KnowledgeEvent, "occurredAt"> & {
  occurredAt?: string;
};

export function isKnowledgeEventType(value: string): value is KnowledgeEventType {
  return (KNOWLEDGE_EVENT_TYPES as readonly string[]).includes(value);
}

export function createKnowledgeEvent(input: KnowledgeEventInput): KnowledgeEvent {
  return {
    id: input.id.trim(),
    type: input.type,
    documentId: input.documentId.trim(),
    actorId: input.actorId.trim(),
    companyId: input.companyId.trim(),
    occurredAt: input.occurredAt ?? KNOWLEDGE_DEFAULT_TIMESTAMP,
    payload: { ...input.payload },
  };
}

export function knowledgeEventForDocumentCreated(
  eventId: string,
  document: KnowledgeDocument,
  actorId: string
): KnowledgeEvent {
  return createKnowledgeEvent({
    id: eventId,
    type: "document.created",
    documentId: document.id,
    actorId,
    companyId: document.companyId,
    payload: {
      collection: document.collection,
      visibility: document.visibility,
      source: document.source,
    },
  });
}

export function knowledgeEventForIndexRequested(
  eventId: string,
  documentId: string,
  actorId: string,
  companyId: string
): KnowledgeEvent {
  return createKnowledgeEvent({
    id: eventId,
    type: "index.requested",
    documentId,
    actorId,
    companyId,
    payload: { implemented: false },
  });
}

/** Deterministic sort: occurredAt desc, then id asc. */
export function sortKnowledgeEventsDesc(events: KnowledgeEvent[]): KnowledgeEvent[] {
  return [...events].sort((a, b) => {
    const timeDiff = b.occurredAt.localeCompare(a.occurredAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}
