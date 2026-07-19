/**
 * Shared helpers for PR 2 inbox repositories (data-access only).
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type {
  WhatsAppConversationAssignmentEvent,
  WhatsAppConversationCrmLink,
  WhatsAppConversationInbox,
  WhatsAppConversationStatusEvent,
  WhatsAppCrmLinkEntityType,
  WhatsAppInboxConversationStatus,
  WhatsAppOutboundIdempotencyKey,
  WhatsAppOutboundIdempotencyState,
  WhatsAppReadWatermark,
} from "./whatsappInboxDatabaseTypes.ts";

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
  conversationId: string;
  direction: string;
  createdAt: string;
};

export function mapMessageRef(row: Record<string, unknown>): InboxMessageRef {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    direction: String(row.direction),
    createdAt: String(row.created_at),
  };
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
      throw new Error("Supabase is not active for WhatsApp inbox repositories.");
    }
    return supabase;
  }

  companyId(explicit?: string): string {
    return explicit ?? DEFAULT_COMPANY_ID;
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

  watermarkKey(conversationId: string, userId: string): string {
    return `${conversationId}|${userId}`;
  }
}
