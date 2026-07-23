/**
 * PostgreSQL implementation of MessagingRepository for messaging_* tables.
 *
 * Dependency-injected SqlExecutor only — no CRM/AI/Meta/whatsappTransport imports.
 * Not wired into live WhatsApp runtime in this task.
 */
import { randomUUID } from "node:crypto";
import type {
  MessagingIdentityRef,
  NormalizedMessage,
  NormalizedStructuredContent,
  SafeProviderMetadata,
} from "./transportTypes.ts";
import type {
  AddAttachmentReferenceInput,
  AppendAuditEventInput,
  AppendStatusEventInput,
  CreateOutboundMessageInput,
  EnqueueOutboxEventInput,
  FindOrCreateConversationInput,
  IdempotentOutcome,
  MessagingAssignmentRow,
  MessagingAttachmentRow,
  MessagingAuditLogRow,
  MessagingContactIdentityRow,
  MessagingContactRow,
  MessagingConversationRow,
  MessagingOutboxRow,
  MessagingRepository,
  MessagingStatusEventRow,
  PersistInboundMessageInput,
  RecordAssignmentInput,
  SafeMessagingRepositoryDeps,
  UpsertContactIdentityInput,
} from "./messagingRepository.ts";
import {
  MessagingRepositoryError,
  asPgError,
  mapDatabaseError,
} from "./messagingRepositoryErrors.ts";
import type { SqlExecutor } from "./messagingSql.ts";

export type PostgresMessagingRepositoryDeps = SafeMessagingRepositoryDeps & {
  db: SqlExecutor;
  /** Optional id factory (defaults to crypto.randomUUID). */
  newId?: () => string;
};

type DbRow = Record<string, unknown>;

function requireOrgId(organizationId: string): string {
  const id = organizationId?.trim();
  if (!id) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: "organizationId is required",
    });
  }
  return id;
}

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const v = value?.trim();
  if (!v) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} is required`,
    });
  }
  return v;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new MessagingRepositoryError({
    code: "database_failure",
    message: "Expected timestamptz column",
  });
}

function asIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return asIso(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  throw new MessagingRepositoryError({
    code: "database_failure",
    message: "Expected text column",
  });
}

function asStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  throw new MessagingRepositoryError({
    code: "database_failure",
    message: "Expected numeric column",
  });
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}

function asSafeMetadata(value: unknown): SafeProviderMetadata {
  const obj = asJsonObject(value);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) {
      out[k] = null;
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

function asStructuredContent(value: unknown): NormalizedStructuredContent {
  const obj = asJsonObject(value);
  const kind = obj.kind;
  if (typeof kind === "string") {
    return obj as NormalizedStructuredContent;
  }
  return { kind: "none" };
}

function assertPrivateObjectKey(objectKey: string): void {
  const key = objectKey.trim();
  if (!key) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: "objectKey is required",
    });
  }
  if (/^https?:\/\//i.test(key) || key.startsWith("//")) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: "objectKey must be a private storage key, not a public URL",
    });
  }
}

function identityRef(identityId: string | null | undefined): MessagingIdentityRef {
  if (identityId) {
    return { kind: "customer_contact", id: identityId };
  }
  return { kind: "system", id: "unspecified" };
}

function mapContact(row: DbRow): MessagingContactRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    displayName: asStringOrNull(row.display_name),
    primaryPhoneNormalized: asStringOrNull(row.primary_phone_normalized),
    city: asStringOrNull(row.city),
    area: asStringOrNull(row.area),
    customerType: asStringOrNull(row.customer_type),
    consentStatus: asString(row.consent_status) as MessagingContactRow["consentStatus"],
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapIdentity(row: DbRow): MessagingContactIdentityRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    contactId: asString(row.contact_id),
    transportType: asString(
      row.transport_type
    ) as MessagingContactIdentityRow["transportType"],
    connectionId: asString(row.connection_id),
    externalUserId: asString(row.external_user_id),
    normalizedAddress: asStringOrNull(row.normalized_address),
    displayMetadata: asSafeMetadata(row.display_metadata),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapConversation(row: DbRow): MessagingConversationRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    contactId: asString(row.contact_id),
    connectionId: asString(row.connection_id),
    transportType: asString(
      row.transport_type
    ) as MessagingConversationRow["transportType"],
    status: asString(row.status) as MessagingConversationRow["status"],
    assignedUserId: asStringOrNull(row.assigned_user_id),
    automationMode: asString(
      row.automation_mode
    ) as MessagingConversationRow["automationMode"],
    lastMessageAt: asIsoOrNull(row.last_message_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapMessage(row: DbRow): NormalizedMessage {
  const receivedAt = asIsoOrNull(row.received_at) ?? asIso(row.created_at);
  return {
    messageId: asString(row.id),
    organizationId: asString(row.organization_id),
    conversationId: asString(row.conversation_id),
    connectionId: asString(row.connection_id),
    transport: asString(row.transport_type) as NormalizedMessage["transport"],
    externalMessageId: asStringOrNull(row.external_message_id),
    direction: asString(row.direction) as NormalizedMessage["direction"],
    sender: identityRef(asStringOrNull(row.sender_identity_id)),
    recipient: identityRef(asStringOrNull(row.recipient_identity_id)),
    messageType: asString(row.message_type) as NormalizedMessage["messageType"],
    text: asStringOrNull(row.normalized_text),
    structuredContent: asStructuredContent(row.structured_content),
    replyToMessageId: asStringOrNull(row.reply_to_message_id),
    clientIdempotencyKey: asStringOrNull(row.client_idempotency_key),
    providerTimestamp: asIsoOrNull(row.provider_timestamp),
    receivedAt,
    createdAt: asIso(row.created_at),
    processingStatus: asString(
      row.processing_status
    ) as NormalizedMessage["processingStatus"],
    deliveryStatus: asString(
      row.delivery_status
    ) as NormalizedMessage["deliveryStatus"],
    origin: asString(row.origin) as NormalizedMessage["origin"],
    aiRunRef: asStringOrNull(row.ai_run_id),
    providerMetadata: asSafeMetadata(row.provider_metadata),
  };
}

function mapAttachment(row: DbRow): MessagingAttachmentRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    messageId: asString(row.message_id),
    objectKey: asString(row.object_key),
    mediaType: asString(row.media_type),
    originalFilenameSafe: asStringOrNull(row.original_filename_safe),
    sizeBytes: asNumber(row.size_bytes),
    sha256: asString(row.sha256),
    scanStatus: asString(row.scan_status) as MessagingAttachmentRow["scanStatus"],
    createdAt: asIso(row.created_at),
  };
}

function mapStatusEvent(row: DbRow): MessagingStatusEventRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    messageId: asString(row.message_id),
    status: asString(row.status) as MessagingStatusEventRow["status"],
    externalStatusId: asStringOrNull(row.external_status_id),
    occurredAt: asIso(row.occurred_at),
    errorCategory: asStringOrNull(row.error_category),
    diagnostics: asSafeMetadata(row.diagnostics),
    createdAt: asIso(row.created_at),
  };
}

function mapAssignment(row: DbRow): MessagingAssignmentRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    conversationId: asString(row.conversation_id),
    assignedTo: asString(row.assigned_to),
    assignedBy: asString(row.assigned_by),
    reason: asStringOrNull(row.reason),
    startedAt: asIso(row.started_at),
    endedAt: asIsoOrNull(row.ended_at),
  };
}

function mapOutbox(row: DbRow): MessagingOutboxRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    aggregateType: asString(row.aggregate_type),
    aggregateId: asString(row.aggregate_id),
    eventType: asString(row.event_type),
    payload: asSafeMetadata(row.payload),
    idempotencyKey: asString(row.idempotency_key),
    status: asString(row.status) as MessagingOutboxRow["status"],
    attemptCount: asNumber(row.attempt_count),
    availableAt: asIso(row.available_at),
    lockedAt: asIsoOrNull(row.locked_at),
    lockedBy: asStringOrNull(row.locked_by),
    lastErrorCategory: asStringOrNull(row.last_error_category),
    createdAt: asIso(row.created_at),
    processedAt: asIsoOrNull(row.processed_at),
  };
}

function mapAudit(row: DbRow): MessagingAuditLogRow {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    actorType: asString(row.actor_type) as MessagingAuditLogRow["actorType"],
    actorId: asStringOrNull(row.actor_id),
    action: asString(row.action),
    targetType: asString(row.target_type),
    targetId: asStringOrNull(row.target_id),
    metadata: asSafeMetadata(row.metadata),
    occurredAt: asIso(row.occurred_at),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return asPgError(err)?.code === "23505";
}

export function createPostgresMessagingRepository(
  deps: PostgresMessagingRepositoryDeps
): MessagingRepository {
  const db = deps.db;
  const newId = deps.newId ?? (() => randomUUID());
  const now = deps.now ?? (() => new Date());

  async function getContact(
    executor: SqlExecutor,
    organizationId: string,
    contactId: string
  ): Promise<MessagingContactRow | null> {
    const { rows } = await executor.query(
      `SELECT * FROM public.messaging_contacts
       WHERE organization_id = $1 AND id = $2
       LIMIT 1`,
      [organizationId, contactId]
    );
    return rows[0] ? mapContact(rows[0]) : null;
  }

  async function getIdentityByProvider(
    executor: SqlExecutor,
    organizationId: string,
    connectionId: string,
    transportType: string,
    externalUserId: string
  ): Promise<MessagingContactIdentityRow | null> {
    const { rows } = await executor.query(
      `SELECT * FROM public.messaging_contact_identities
       WHERE organization_id = $1
         AND connection_id = $2
         AND transport_type = $3
         AND external_user_id = $4
       LIMIT 1`,
      [organizationId, connectionId, transportType, externalUserId]
    );
    return rows[0] ? mapIdentity(rows[0]) : null;
  }

  async function getConversationByKey(
    executor: SqlExecutor,
    organizationId: string,
    contactId: string,
    connectionId: string,
    transportType: string
  ): Promise<MessagingConversationRow | null> {
    const { rows } = await executor.query(
      `SELECT * FROM public.messaging_conversations
       WHERE organization_id = $1
         AND contact_id = $2
         AND connection_id = $3
         AND transport_type = $4
       LIMIT 1`,
      [organizationId, contactId, connectionId, transportType]
    );
    return rows[0] ? mapConversation(rows[0]) : null;
  }

  async function getInboundByExternal(
    executor: SqlExecutor,
    organizationId: string,
    connectionId: string,
    transportType: string,
    externalMessageId: string
  ): Promise<NormalizedMessage | null> {
    const { rows } = await executor.query(
      `SELECT * FROM public.messaging_messages
       WHERE organization_id = $1
         AND connection_id = $2
         AND transport_type = $3
         AND external_message_id = $4
       LIMIT 1`,
      [organizationId, connectionId, transportType, externalMessageId]
    );
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async function getOutboundByClientKey(
    executor: SqlExecutor,
    organizationId: string,
    connectionId: string,
    clientIdempotencyKey: string
  ): Promise<NormalizedMessage | null> {
    const { rows } = await executor.query(
      `SELECT * FROM public.messaging_messages
       WHERE organization_id = $1
         AND connection_id = $2
         AND client_idempotency_key = $3
       LIMIT 1`,
      [organizationId, connectionId, clientIdempotencyKey]
    );
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async function touchConversationActivity(
    executor: SqlExecutor,
    organizationId: string,
    conversationId: string,
    at: Date
  ): Promise<void> {
    await executor.query(
      `UPDATE public.messaging_conversations
       SET last_message_at = GREATEST(COALESCE(last_message_at, $3), $3),
           updated_at = $3
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, conversationId, at.toISOString()]
    );
  }

  const repo: MessagingRepository = {
    async upsertContactIdentity(input: UpsertContactIdentityInput) {
      const organizationId = requireOrgId(input.organizationId);
      const connectionId = requireNonEmpty(
        input.identity.connectionId,
        "identity.connectionId"
      );
      const externalUserId = requireNonEmpty(
        input.identity.externalUserId,
        "identity.externalUserId"
      );
      const transportType = input.identity.transportType;
      if (!transportType) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "identity.transportType is required",
        });
      }

      try {
        return await db.withTransaction(async (tx) => {
          const existingIdentity = await getIdentityByProvider(
            tx,
            organizationId,
            connectionId,
            transportType,
            externalUserId
          );
          if (existingIdentity) {
            if (
              input.contact.id &&
              input.contact.id !== existingIdentity.contactId
            ) {
              throw new MessagingRepositoryError({
                code: "tenant_mismatch",
                message:
                  "Contact identity already bound to a different contact in this organization",
              });
            }
            const contact = await getContact(
              tx,
              organizationId,
              existingIdentity.contactId
            );
            if (!contact) {
              throw new MessagingRepositoryError({
                code: "not_found",
                message: "Contact for existing identity was not found",
              });
            }
            return {
              contact: { kind: "existing", row: contact },
              identity: { kind: "existing", row: existingIdentity },
            };
          }

          let contactOutcome: IdempotentOutcome<MessagingContactRow>;
          const requestedContactId = input.contact.id?.trim();
          if (requestedContactId) {
            const existingContact = await getContact(
              tx,
              organizationId,
              requestedContactId
            );
            if (!existingContact) {
              throw new MessagingRepositoryError({
                code: "not_found",
                message: "Referenced contact was not found in this organization",
              });
            }
            contactOutcome = { kind: "existing", row: existingContact };
          } else {
            const contactId = newId();
            const ts = now().toISOString();
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_contacts (
                 id, organization_id, display_name, primary_phone_normalized,
                 city, area, customer_type, consent_status, created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
               )
               RETURNING *`,
              [
                contactId,
                organizationId,
                input.contact.displayName ?? null,
                input.contact.primaryPhoneNormalized ?? null,
                input.contact.city ?? null,
                input.contact.area ?? null,
                input.contact.customerType ?? null,
                input.contact.consentStatus ?? "unknown",
                ts,
              ]
            );
            contactOutcome = { kind: "created", row: mapContact(rows[0]!) };
          }

          const identityId = input.identity.id?.trim() || newId();
          const ts = now().toISOString();
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_contact_identities (
                 id, organization_id, contact_id, transport_type, connection_id,
                 external_user_id, normalized_address, display_metadata,
                 created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9
               )
               RETURNING *`,
              [
                identityId,
                organizationId,
                contactOutcome.row.id,
                transportType,
                connectionId,
                externalUserId,
                input.identity.normalizedAddress ?? null,
                JSON.stringify(input.identity.displayMetadata ?? {}),
                ts,
              ]
            );
            return {
              contact: contactOutcome,
              identity: { kind: "created", row: mapIdentity(rows[0]!) },
            };
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const raced = await getIdentityByProvider(
              tx,
              organizationId,
              connectionId,
              transportType,
              externalUserId
            );
            if (!raced) throw mapDatabaseError(err);
            // Another writer won the identity unique index. Drop an unused
            // contact we inserted in this transaction so it is not orphaned.
            if (
              contactOutcome.kind === "created" &&
              contactOutcome.row.id !== raced.contactId
            ) {
              await tx.query(
                `DELETE FROM public.messaging_contacts
                 WHERE organization_id = $1 AND id = $2`,
                [organizationId, contactOutcome.row.id]
              );
            }
            const contact = await getContact(tx, organizationId, raced.contactId);
            if (!contact) {
              throw new MessagingRepositoryError({
                code: "not_found",
                message: "Contact for concurrent identity was not found",
              });
            }
            return {
              contact: { kind: "existing", row: contact },
              identity: { kind: "existing", row: raced },
            };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to upsert contact identity");
      }
    },

    async findOrCreateConversation(input: FindOrCreateConversationInput) {
      const organizationId = requireOrgId(input.organizationId);
      const contactId = requireNonEmpty(input.contactId, "contactId");
      const connectionId = requireNonEmpty(input.connectionId, "connectionId");
      const transportType = input.transportType;
      if (!transportType) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "transportType is required",
        });
      }

      try {
        return await db.withTransaction(async (tx) => {
          const existing = await getConversationByKey(
            tx,
            organizationId,
            contactId,
            connectionId,
            transportType
          );
          if (existing) return { kind: "existing", row: existing };

          const contact = await getContact(tx, organizationId, contactId);
          if (!contact) {
            throw new MessagingRepositoryError({
              code: "not_found",
              message: "Contact not found for conversation",
            });
          }

          const id = newId();
          const ts = now().toISOString();
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_conversations (
                 id, organization_id, contact_id, connection_id, transport_type,
                 status, automation_mode, created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8, $8
               )
               RETURNING *`,
              [
                id,
                organizationId,
                contactId,
                connectionId,
                transportType,
                input.status ?? "open",
                input.automationMode ?? "human_handling",
                ts,
              ]
            );
            return { kind: "created", row: mapConversation(rows[0]!) };
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const raced = await getConversationByKey(
              tx,
              organizationId,
              contactId,
              connectionId,
              transportType
            );
            if (!raced) throw mapDatabaseError(err);
            return { kind: "existing", row: raced };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to find or create conversation");
      }
    },

    async persistInboundMessage(input: PersistInboundMessageInput) {
      const organizationId = requireOrgId(input.organizationId);
      const conversationId = requireNonEmpty(
        input.conversationId,
        "conversationId"
      );
      const connectionId = requireNonEmpty(input.connectionId, "connectionId");
      const externalMessageId = requireNonEmpty(
        input.externalMessageId,
        "externalMessageId"
      );
      const transportType = input.transportType;
      if (!transportType) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "transportType is required",
        });
      }

      try {
        return await db.withTransaction(async (tx) => {
          const existing = await getInboundByExternal(
            tx,
            organizationId,
            connectionId,
            transportType,
            externalMessageId
          );
          if (existing) return { kind: "existing", row: existing };

          const id = newId();
          const ts = now();
          const createdAt = ts.toISOString();
          const receivedAt = input.receivedAt ?? createdAt;
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_messages (
                 id, organization_id, conversation_id, connection_id, transport_type,
                 external_message_id, direction, sender_identity_id, recipient_identity_id,
                 message_type, normalized_text, structured_content, reply_to_message_id,
                 client_idempotency_key, provider_timestamp, received_at, created_at,
                 processing_status, delivery_status, origin, ai_run_id, provider_metadata
               ) VALUES (
                 $1, $2, $3, $4, $5,
                 $6, 'inbound', $7, $8,
                 $9, $10, $11::jsonb, $12,
                 NULL, $13, $14, $15,
                 'pending', 'received', $16, NULL, $17::jsonb
               )
               RETURNING *`,
              [
                id,
                organizationId,
                conversationId,
                connectionId,
                transportType,
                externalMessageId,
                input.senderIdentityId ?? null,
                input.recipientIdentityId ?? null,
                input.messageType,
                input.normalizedText ?? null,
                JSON.stringify(input.structuredContent ?? { kind: "none" }),
                input.replyToMessageId ?? null,
                input.providerTimestamp ?? null,
                receivedAt,
                createdAt,
                input.origin ?? "customer",
                JSON.stringify(input.providerMetadata ?? {}),
              ]
            );
            await touchConversationActivity(
              tx,
              organizationId,
              conversationId,
              ts
            );
            return { kind: "created", row: mapMessage(rows[0]!) };
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const raced = await getInboundByExternal(
              tx,
              organizationId,
              connectionId,
              transportType,
              externalMessageId
            );
            if (!raced) throw mapDatabaseError(err);
            return { kind: "existing", row: raced };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to persist inbound message");
      }
    },

    async createOutboundMessage(input: CreateOutboundMessageInput) {
      const organizationId = requireOrgId(input.organizationId);
      const conversationId = requireNonEmpty(
        input.conversationId,
        "conversationId"
      );
      const connectionId = requireNonEmpty(input.connectionId, "connectionId");
      const clientIdempotencyKey = requireNonEmpty(
        input.clientIdempotencyKey,
        "clientIdempotencyKey"
      );
      const transportType = input.transportType;
      if (!transportType) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "transportType is required",
        });
      }

      try {
        return await db.withTransaction(async (tx) => {
          const existing = await getOutboundByClientKey(
            tx,
            organizationId,
            connectionId,
            clientIdempotencyKey
          );
          if (existing) return { kind: "existing", row: existing };

          const id = newId();
          const ts = now();
          const createdAt = ts.toISOString();
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_messages (
                 id, organization_id, conversation_id, connection_id, transport_type,
                 external_message_id, direction, sender_identity_id, recipient_identity_id,
                 message_type, normalized_text, structured_content, reply_to_message_id,
                 client_idempotency_key, provider_timestamp, received_at, created_at,
                 processing_status, delivery_status, origin, ai_run_id, provider_metadata
               ) VALUES (
                 $1, $2, $3, $4, $5,
                 NULL, 'outbound', $6, $7,
                 $8, $9, $10::jsonb, $11,
                 $12, NULL, NULL, $13,
                 $14, $15, $16, $17, $18::jsonb
               )
               RETURNING *`,
              [
                id,
                organizationId,
                conversationId,
                connectionId,
                transportType,
                input.senderIdentityId ?? null,
                input.recipientIdentityId ?? null,
                input.messageType,
                input.normalizedText ?? null,
                JSON.stringify(input.structuredContent ?? { kind: "none" }),
                input.replyToMessageId ?? null,
                clientIdempotencyKey,
                createdAt,
                input.processingStatus ?? "pending",
                input.deliveryStatus ?? "queued",
                input.origin,
                input.aiRunId ?? null,
                JSON.stringify(input.providerMetadata ?? {}),
              ]
            );
            await touchConversationActivity(
              tx,
              organizationId,
              conversationId,
              ts
            );
            return { kind: "created", row: mapMessage(rows[0]!) };
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const raced = await getOutboundByClientKey(
              tx,
              organizationId,
              connectionId,
              clientIdempotencyKey
            );
            if (!raced) throw mapDatabaseError(err);
            return { kind: "existing", row: raced };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to create outbound message");
      }
    },

    async appendStatusEvent(input: AppendStatusEventInput) {
      const organizationId = requireOrgId(input.organizationId);
      const messageId = requireNonEmpty(input.messageId, "messageId");
      const occurredAt = requireNonEmpty(input.occurredAt, "occurredAt");

      try {
        return await db.withTransaction(async (tx) => {
          if (input.externalStatusId) {
            const { rows: existingRows } = await tx.query(
              `SELECT * FROM public.messaging_status_events
               WHERE organization_id = $1
                 AND message_id = $2
                 AND external_status_id = $3
               LIMIT 1`,
              [organizationId, messageId, input.externalStatusId]
            );
            if (existingRows[0]) {
              return {
                kind: "existing",
                row: mapStatusEvent(existingRows[0]),
              };
            }
          }

          const id = newId();
          const createdAt = now().toISOString();
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_status_events (
                 id, organization_id, message_id, status, external_status_id,
                 occurred_at, error_category, diagnostics, created_at
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9
               )
               RETURNING *`,
              [
                id,
                organizationId,
                messageId,
                input.status,
                input.externalStatusId ?? null,
                occurredAt,
                input.errorCategory ?? null,
                JSON.stringify(input.diagnostics ?? {}),
                createdAt,
              ]
            );
            return { kind: "created", row: mapStatusEvent(rows[0]!) };
          } catch (err) {
            if (!isUniqueViolation(err) || !input.externalStatusId) throw err;
            const { rows } = await tx.query(
              `SELECT * FROM public.messaging_status_events
               WHERE organization_id = $1
                 AND message_id = $2
                 AND external_status_id = $3
               LIMIT 1`,
              [organizationId, messageId, input.externalStatusId]
            );
            if (!rows[0]) throw mapDatabaseError(err);
            return { kind: "existing", row: mapStatusEvent(rows[0]) };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to append status event");
      }
    },

    async addAttachmentReference(input: AddAttachmentReferenceInput) {
      const organizationId = requireOrgId(input.organizationId);
      const messageId = requireNonEmpty(input.messageId, "messageId");
      assertPrivateObjectKey(input.objectKey);
      const mediaType = requireNonEmpty(input.mediaType, "mediaType");
      const sha256 = requireNonEmpty(input.sha256, "sha256");
      if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "sizeBytes must be a non-negative number",
        });
      }

      try {
        const id = newId();
        const createdAt = now().toISOString();
        const { rows } = await db.query(
          `INSERT INTO public.messaging_attachments (
             id, organization_id, message_id, object_key, media_type,
             original_filename_safe, size_bytes, sha256, scan_status, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           )
           RETURNING *`,
          [
            id,
            organizationId,
            messageId,
            input.objectKey.trim(),
            mediaType,
            input.originalFilenameSafe ?? null,
            input.sizeBytes,
            sha256,
            input.scanStatus ?? "pending",
            createdAt,
          ]
        );
        return mapAttachment(rows[0]!);
      } catch (err) {
        throw mapDatabaseError(err, "Failed to add attachment reference");
      }
    },

    async recordAssignment(input: RecordAssignmentInput) {
      const organizationId = requireOrgId(input.organizationId);
      const conversationId = requireNonEmpty(
        input.conversationId,
        "conversationId"
      );
      const assignedTo = requireNonEmpty(input.assignedTo, "assignedTo");
      const assignedBy = requireNonEmpty(input.assignedBy, "assignedBy");
      const startedAt = input.startedAt ?? now().toISOString();

      try {
        return await db.withTransaction(async (tx) => {
          if (input.endPreviousOpen) {
            await tx.query(
              `UPDATE public.messaging_conversation_assignments
               SET ended_at = $3
               WHERE organization_id = $1
                 AND conversation_id = $2
                 AND ended_at IS NULL
                 AND started_at <= $3`,
              [organizationId, conversationId, startedAt]
            );
          }

          const id = newId();
          const { rows } = await tx.query(
            `INSERT INTO public.messaging_conversation_assignments (
               id, organization_id, conversation_id, assigned_to, assigned_by,
               reason, started_at, ended_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, NULL
             )
             RETURNING *`,
            [
              id,
              organizationId,
              conversationId,
              assignedTo,
              assignedBy,
              input.reason ?? null,
              startedAt,
            ]
          );

          await tx.query(
            `UPDATE public.messaging_conversations
             SET assigned_user_id = $3, updated_at = $4
             WHERE organization_id = $1 AND id = $2`,
            [organizationId, conversationId, assignedTo, startedAt]
          );

          return mapAssignment(rows[0]!);
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to record assignment");
      }
    },

    async enqueueOutboxEvent(input: EnqueueOutboxEventInput) {
      const organizationId = requireOrgId(input.organizationId);
      const aggregateType = requireNonEmpty(
        input.aggregateType,
        "aggregateType"
      );
      const aggregateId = requireNonEmpty(input.aggregateId, "aggregateId");
      const eventType = requireNonEmpty(input.eventType, "eventType");
      const idempotencyKey = requireNonEmpty(
        input.idempotencyKey,
        "idempotencyKey"
      );

      try {
        return await db.withTransaction(async (tx) => {
          const { rows: existingRows } = await tx.query(
            `SELECT * FROM public.messaging_outbox
             WHERE organization_id = $1 AND idempotency_key = $2
             LIMIT 1`,
            [organizationId, idempotencyKey]
          );
          if (existingRows[0]) {
            return { kind: "existing", row: mapOutbox(existingRows[0]) };
          }

          const id = newId();
          const createdAt = now().toISOString();
          const availableAt = input.availableAt ?? createdAt;
          try {
            const { rows } = await tx.query(
              `INSERT INTO public.messaging_outbox (
                 id, organization_id, aggregate_type, aggregate_id, event_type,
                 payload, idempotency_key, status, attempt_count, available_at,
                 created_at
               ) VALUES (
                 $1, $2, $3, $4, $5,
                 $6::jsonb, $7, 'pending', 0, $8, $9
               )
               RETURNING *`,
              [
                id,
                organizationId,
                aggregateType,
                aggregateId,
                eventType,
                JSON.stringify(input.payload ?? {}),
                idempotencyKey,
                availableAt,
                createdAt,
              ]
            );
            return { kind: "created", row: mapOutbox(rows[0]!) };
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            const { rows } = await tx.query(
              `SELECT * FROM public.messaging_outbox
               WHERE organization_id = $1 AND idempotency_key = $2
               LIMIT 1`,
              [organizationId, idempotencyKey]
            );
            if (!rows[0]) throw mapDatabaseError(err);
            return { kind: "existing", row: mapOutbox(rows[0]) };
          }
        });
      } catch (err) {
        throw mapDatabaseError(err, "Failed to enqueue outbox event");
      }
    },

    async appendAuditEvent(input: AppendAuditEventInput) {
      const organizationId = requireOrgId(input.organizationId);
      const action = requireNonEmpty(input.action, "action");
      const targetType = requireNonEmpty(input.targetType, "targetType");
      if (!input.actorType) {
        throw new MessagingRepositoryError({
          code: "invalid_input",
          message: "actorType is required",
        });
      }

      try {
        const id = newId();
        const occurredAt = input.occurredAt ?? now().toISOString();
        const { rows } = await db.query(
          `INSERT INTO public.messaging_audit_logs (
             id, organization_id, actor_type, actor_id, action,
             target_type, target_id, metadata, occurred_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9
           )
           RETURNING *`,
          [
            id,
            organizationId,
            input.actorType,
            input.actorId ?? null,
            action,
            targetType,
            input.targetId ?? null,
            JSON.stringify(input.metadata ?? {}),
            occurredAt,
          ]
        );
        return mapAudit(rows[0]!);
      } catch (err) {
        throw mapDatabaseError(err, "Failed to append audit event");
      }
    },
  };

  return repo;
}
