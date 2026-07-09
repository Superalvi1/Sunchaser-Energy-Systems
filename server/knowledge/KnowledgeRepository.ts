/**
 * In-memory knowledge repository — architecture stub, no DB.
 */

import type { KnowledgeDocument } from "./KnowledgeDocument.ts";
import { createKnowledgeDocument, validateKnowledgeDocument, type KnowledgeDocumentInput } from "./KnowledgeDocument.ts";
import { createKnowledgeEvent, knowledgeEventForDocumentCreated, type KnowledgeEvent } from "./KnowledgeEvents.ts";
import {
  canActorReadKnowledgeDocument,
  evaluateKnowledgePermission,
  type KnowledgePermissionContext,
} from "./KnowledgePermissions.ts";
import type { KnowledgeDocumentMetadata } from "./KnowledgeMetadata.ts";
import type { KnowledgeCollection } from "./KnowledgeModels.ts";
import type { RequestActor } from "../middleware/actor.ts";

export interface KnowledgeRepository {
  save(input: KnowledgeDocumentInput, metadata: KnowledgeDocumentMetadata, actor: RequestActor): KnowledgeSaveResult;
  findById(id: string, actor: RequestActor, context?: KnowledgePermissionContext): KnowledgeDocument | null;
  listByCollection(
    collection: KnowledgeCollection,
    actor: RequestActor,
    context?: KnowledgePermissionContext
  ): KnowledgeDocument[];
  delete(id: string, actor: RequestActor): KnowledgeDeleteResult;
  listEvents(documentId?: string): KnowledgeEvent[];
}

export interface KnowledgeSaveResult {
  ok: true;
  document: KnowledgeDocument;
  metadata: KnowledgeDocumentMetadata;
  event: KnowledgeEvent;
}

export interface KnowledgeDeleteResult {
  ok: boolean;
  reason: string;
}

export interface InMemoryKnowledgeRepositoryOptions {
  eventIdPrefix?: string;
}

/** Pure in-memory store for tests and future wiring. */
export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private documents = new Map<string, KnowledgeDocument>();
  private metadata = new Map<string, KnowledgeDocumentMetadata>();
  private events: KnowledgeEvent[] = [];
  private eventCounter = 0;
  private eventIdPrefix: string;

  constructor(options: InMemoryKnowledgeRepositoryOptions = {}) {
    this.eventIdPrefix = options.eventIdPrefix ?? "kevt";
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `${this.eventIdPrefix}-${this.eventCounter}`;
  }

  save(input: KnowledgeDocumentInput, metadata: KnowledgeDocumentMetadata, actor: RequestActor): KnowledgeSaveResult {
    const validated = validateKnowledgeDocument(input);
    if (!validated.ok) {
      throw new Error(`Cannot save invalid document: ${validated.errors.join("; ")}`);
    }
    if (metadata.documentId !== validated.document.id) {
      throw new Error("metadata.documentId must match document.id");
    }

    const writeDecision = evaluateKnowledgePermission(actor, validated.document, "write", { metadata });
    if (!writeDecision.allowed && validated.document.owner !== actor.id) {
      throw new Error(`Write denied: ${writeDecision.reason}`);
    }

    const isUpdate = this.documents.has(validated.document.id);
    this.documents.set(validated.document.id, validated.document);
    this.metadata.set(validated.document.id, metadata);

    const event = isUpdate
      ? createKnowledgeEvent({
          id: this.nextEventId(),
          type: "document.updated",
          documentId: validated.document.id,
          actorId: actor.id,
          companyId: validated.document.companyId,
          payload: { collection: validated.document.collection },
        })
      : knowledgeEventForDocumentCreated(this.nextEventId(), validated.document, actor.id);

    this.events.push(event);

    return { ok: true, document: validated.document, metadata, event };
  }

  findById(id: string, actor: RequestActor, context: KnowledgePermissionContext = {}): KnowledgeDocument | null {
    const document = this.documents.get(id);
    if (!document) return null;
    const meta = this.metadata.get(id);
    const ctx: KnowledgePermissionContext = { ...context, metadata: meta ?? context.metadata };
    if (!canActorReadKnowledgeDocument(actor, document, ctx)) return null;
    return document;
  }

  listByCollection(
    collection: KnowledgeCollection,
    actor: RequestActor,
    context: KnowledgePermissionContext = {}
  ): KnowledgeDocument[] {
    const results: KnowledgeDocument[] = [];
    for (const document of this.documents.values()) {
      if (document.collection !== collection) continue;
      const meta = this.metadata.get(document.id);
      const ctx: KnowledgePermissionContext = { ...context, metadata: meta ?? context.metadata };
      if (canActorReadKnowledgeDocument(actor, document, ctx)) {
        results.push(document);
      }
    }
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  delete(id: string, actor: RequestActor): KnowledgeDeleteResult {
    const document = this.documents.get(id);
    if (!document) return { ok: false, reason: "not_found" };

    const decision = evaluateKnowledgePermission(actor, document, "delete");
    if (!decision.allowed) return { ok: false, reason: decision.reason };

    this.documents.delete(id);
    this.metadata.delete(id);
    this.events.push(
      createKnowledgeEvent({
        id: this.nextEventId(),
        type: "document.deleted",
        documentId: id,
        actorId: actor.id,
        companyId: document.companyId,
        payload: {},
      })
    );
    return { ok: true, reason: "deleted" };
  }

  listEvents(documentId?: string): KnowledgeEvent[] {
    const filtered = documentId
      ? this.events.filter((e) => e.documentId === documentId)
      : [...this.events];
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Test helper — raw count without permission filter. */
  size(): number {
    return this.documents.size;
  }
}

export function createInMemoryKnowledgeRepository(
  options?: InMemoryKnowledgeRepositoryOptions
): InMemoryKnowledgeRepository {
  return new InMemoryKnowledgeRepository(options);
}

/** Convenience factory for valid test documents. */
export function buildKnowledgeDocumentInput(
  overrides: Partial<KnowledgeDocumentInput> = {}
): KnowledgeDocumentInput {
  return createKnowledgeDocument({
    id: "doc-1",
    title: "Test Document",
    collection: "General",
    owner: "user-1",
    visibility: "company",
    department: "Operations",
    companyId: "company-1",
    tags: ["test"],
    mimeType: "application/pdf",
    checksum: "abc123",
    language: "en",
    source: "upload",
    status: "active",
    ...overrides,
  });
}
