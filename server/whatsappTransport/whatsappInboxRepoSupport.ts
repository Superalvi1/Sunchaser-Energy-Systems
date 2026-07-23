/**
 * Shared helpers for PR 2 inbox repositories (data-access only).
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { resolveCompanyId } from "./whatsappConstants.ts";
import {
  isWhatsAppAiOwnershipState,
  type WhatsAppAiOwnershipState,
  type WhatsAppConversationAssignmentEvent,
  type WhatsAppConversationCrmLink,
  type WhatsAppConversationInbox,
  type WhatsAppConversationStatusEvent,
  type WhatsAppCrmLinkEntityType,
  type WhatsAppInboxConversationStatus,
  type WhatsAppOutboundIdempotencyKey,
  type WhatsAppOutboundIdempotencyState,
  type WhatsAppReadWatermark,
} from "./whatsappInboxDatabaseTypes.ts";
export { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

export type KeysetCursor = {
  at: string;
  id: string;
};

export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newInboxId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function clampLimit(limit: number | undefined, fallback = 50, max = 100): number {
  if (limit == null || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

export function activityAt(row: {
  lastMessageAt: string | null;
  createdAt: string;
}): string {
  return row.lastMessageAt ?? row.createdAt;
}

/** Lexicographic compare for (timestamp, id) descending keysets. */
export function isBeforeKeyset(
  at: string,
  id: string,
  cursor: KeysetCursor
): boolean {
  if (at < cursor.at) return true;
  if (at > cursor.at) return false;
  return id < cursor.id;
}

export function mapConversationInbox(
  row: Record<string, unknown>
): WhatsAppConversationInbox {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    channelId: String(row.channel_id),
    contactId: String(row.contact_id),
    status: String(row.status) as WhatsAppInboxConversationStatus,
    lastMessageAt: (row.last_message_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    assignedUserId: (row.assigned_user_id as string) ?? null,
    assignedAt: (row.assigned_at as string) ?? null,
    assignedBy: (row.assigned_by as string) ?? null,
    lockVersion: Number(row.lock_version ?? 1),
    hasFailedMessage: Boolean(row.has_failed_message),
    aiOwnershipState: isWhatsAppAiOwnershipState(row.ai_ownership_state)
      ? row.ai_ownership_state
      : "AI_SHADOW",
  };
}

export function mapAssignmentEvent(
  row: Record<string, unknown>
): WhatsAppConversationAssignmentEvent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    conversationId: String(row.conversation_id),
    assignedUserId: (row.assigned_user_id as string) ?? null,
    assignedBy: String(row.assigned_by),
    createdAt: String(row.created_at),
  };
}

export function mapStatusEvent(
  row: Record<string, unknown>
): WhatsAppConversationStatusEvent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    conversationId: String(row.conversation_id),
    fromStatus: (row.from_status as WhatsAppInboxConversationStatus) ?? null,
    toStatus: String(row.to_status) as WhatsAppInboxConversationStatus,
    changedByUserId: (row.changed_by_user_id as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

export function mapReadWatermark(
  row: Record<string, unknown>
): WhatsAppReadWatermark {
  return {
    companyId: String(row.company_id),
    conversationId: String(row.conversation_id),
    userId: String(row.user_id),
    lastReadInboundMessageId:
      (row.last_read_inbound_message_id as string) ?? null,
    lastReadInboundMessageCreatedAt:
      (row.last_read_inbound_message_created_at as string) ?? null,
    updatedAt: String(row.updated_at),
  };
}

export function mapCrmLink(
  row: Record<string, unknown>
): WhatsAppConversationCrmLink {
  return {
    conversationId: String(row.conversation_id),
    companyId: String(row.company_id),
    linkedEntityType: String(row.linked_entity_type) as WhatsAppCrmLinkEntityType,
    linkedEntityId: String(row.linked_entity_id),
    linkedByUserId: String(row.linked_by_user_id),
    linkedAt: String(row.linked_at),
  };
}

export function mapIdempotencyKey(
  row: Record<string, unknown>
): WhatsAppOutboundIdempotencyKey {
  return {
    idempotencyKey: String(row.idempotency_key),
    companyId: String(row.company_id),
    conversationId: String(row.conversation_id),
    state: String(row.state) as WhatsAppOutboundIdempotencyState,
    messageId: (row.message_id as string) ?? null,
    error: (row.error as string) ?? null,
    createdAt: String(row.created_at),
    completedAt: (row.completed_at as string) ?? null,
  };
}

export type InboxMessageRef = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: string;
  status: string;
  textBody: string | null;
  createdAt: string;
  occurredAt: string | null;
  messageType?: string;
  metaMediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
  sha256?: string | null;
  voice?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  placeName?: string | null;
};

export function mapMessageRef(row: Record<string, unknown>): InboxMessageRef {
  return {
    id: String(row.id),
    companyId: String(row.company_id ?? "sunchaser"),
    conversationId: String(row.conversation_id),
    direction: String(row.direction),
    status: String(row.status ?? ""),
    textBody: (row.text_body as string) ?? null,
    createdAt: String(row.created_at),
    occurredAt: (row.occurred_at as string) ?? null,
    messageType: (row.message_type as string) ?? "text",
    metaMediaId: (row.meta_media_id as string) ?? null,
    mimeType: (row.mime_type as string) ?? null,
    caption: (row.caption as string) ?? null,
    filename: (row.filename as string) ?? null,
    sha256: (row.sha256 as string) ?? null,
    voice: Boolean(row.voice),
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    address: (row.address as string) ?? null,
    placeName: (row.place_name as string) ?? null,
  };
}

import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

export function handleSupabaseError(error: { message: string; code?: string }): never {
  throw new InboxServiceError(
    "service_unavailable",
    `Database query failed: ${error.message}`,
    { originalCode: error.code, originalMessage: error.message }
  );
}

export class InboxSupabaseAccess {
  constructor(
    private readonly clientFactory: () => SupabaseClient | null = getSupabase
  ) {}

  isActive(): boolean {
    return isSupabaseActive() && this.clientFactory() !== null;
  }

  client(): SupabaseClient {
    const supabase = this.clientFactory();
    if (!supabase) {
      throw new InboxServiceError(
        "service_unavailable",
        "Supabase is not active for WhatsApp inbox repositories."
      );
    }
    return supabase;
  }

  companyId(explicit?: string): string {
    return resolveCompanyId(explicit);
  }
}

/** Shared in-memory tables for inbox repository tests. */
export class WhatsAppInboxMemoryStore {
  conversations = new Map<string, WhatsAppConversationInbox>();
  assignmentEvents = new Map<string, WhatsAppConversationAssignmentEvent>();
  statusEvents = new Map<string, WhatsAppConversationStatusEvent>();
  watermarks = new Map<string, WhatsAppReadWatermark>(); // `${conversationId}|${userId}`
  crmLinks = new Map<string, WhatsAppConversationCrmLink>(); // conversationId
  idempotencyKeys = new Map<string, WhatsAppOutboundIdempotencyKey>();
  /** Minimal message rows for inbound watermark / unread queries. */
  messages = new Map<string, InboxMessageRef>();

  /**
   * Test hooks — throw to simulate audit-insert failure inside atomic mutations.
   * Production code never sets these.
   */
  beforeStatusEventInsert: (() => void) | null = null;
  beforeAssignmentEventInsert: (() => void) | null = null;

  watermarkKey(conversationId: string, userId: string): string {
    return `${conversationId}|${userId}`;
  }
}

/** Sentinel entity id used to claim create-lead exclusivity before CRM callback. */
export const CREATE_LEAD_PENDING_ENTITY_ID = "__pending_create_lead__";
export const PENDING_LEAD_PREFIX = "pending_lead:";

export function isPendingCreateLeadLink(
  link: WhatsAppConversationCrmLink | null | undefined
): boolean {
  if (!link) return false;
  return (
    link.linkedEntityId === CREATE_LEAD_PENDING_ENTITY_ID ||
    link.linkedEntityId.startsWith(PENDING_LEAD_PREFIX)
  );
}

export function extractPendingLeadId(
  link: WhatsAppConversationCrmLink | null | undefined
): string | null {
  if (!link) return null;
  if (link.linkedEntityId.startsWith(PENDING_LEAD_PREFIX)) {
    return link.linkedEntityId.slice(PENDING_LEAD_PREFIX.length);
  }
  return null;
}
