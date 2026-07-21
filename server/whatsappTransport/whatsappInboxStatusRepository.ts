/**
 * Conversation status-event data-access for PR 2 shared inbox (Revision 3).
 * No transition matrix or permission checks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WhatsAppConversationStatusEvent,
  WhatsAppInboxConversationStatus,
} from "./whatsappInboxDatabaseTypes.ts";
import {
  clampLimit,
  InboxSupabaseAccess,
  mapStatusEvent,
  newInboxId,
  nowIso,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export interface WhatsAppInboxStatusRepository {
  isActive(): boolean;
  insertEvent(input: {
    conversationId: string;
    fromStatus: WhatsAppInboxConversationStatus | null;
    toStatus: WhatsAppInboxConversationStatus;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationStatusEvent>;
  listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationStatusEvent[]>;
  /** Newest status event for a conversation (for read-path reconciliation inputs). */
  getLatest(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationStatusEvent | null>;
}

export class InMemoryWhatsAppInboxStatusRepository
  implements WhatsAppInboxStatusRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async insertEvent(input: {
    conversationId: string;
    fromStatus: WhatsAppInboxConversationStatus | null;
    toStatus: WhatsAppInboxConversationStatus;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationStatusEvent> {
    const row: WhatsAppConversationStatusEvent = {
      id: input.id ?? newInboxId("wcse"),
      companyId: this.access.companyId(input.companyId),
      conversationId: input.conversationId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedByUserId: input.changedByUserId,
      metadata: input.metadata ?? {},
      createdAt: input.createdAt ?? nowIso(),
    };
    this.store.statusEvents.set(row.id, row);
    return row;
  }

  async listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationStatusEvent[]> {
    const companyId = this.access.companyId(opts?.companyId);
    const limit = clampLimit(opts?.limit, 100, 500);
    return [...this.store.statusEvents.values()]
      .filter(
        (e) =>
          e.conversationId === conversationId && e.companyId === companyId
      )
      .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
      .slice(0, limit);
  }

  async getLatest(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationStatusEvent | null> {
    const rows = await this.listByConversation(conversationId, {
      companyId,
      limit: 1,
    });
    return rows[0] ?? null;
  }
}

export class SupabaseWhatsAppInboxStatusRepository
  implements WhatsAppInboxStatusRepository
{
  private readonly access: InboxSupabaseAccess;

  constructor(clientFactory?: () => SupabaseClient | null) {
    this.access = new InboxSupabaseAccess(clientFactory);
  }

  isActive(): boolean {
    return this.access.isActive();
  }

  private client(): SupabaseClient {
    return this.access.client();
  }

  async insertEvent(input: {
    conversationId: string;
    fromStatus: WhatsAppInboxConversationStatus | null;
    toStatus: WhatsAppInboxConversationStatus;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationStatusEvent> {
    const row = {
      id: input.id ?? newInboxId("wcse"),
      company_id: this.access.companyId(input.companyId),
      conversation_id: input.conversationId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      changed_by_user_id: input.changedByUserId,
      metadata: input.metadata ?? {},
      created_at: input.createdAt ?? nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_conversation_status_events")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapStatusEvent(data as Record<string, unknown>);
  }

  async listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationStatusEvent[]> {
    const { data, error } = await this.client()
      .from("whatsapp_conversation_status_events")
      .select("*")
      .eq("company_id", this.access.companyId(opts?.companyId))
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(clampLimit(opts?.limit, 100, 500));
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(mapStatusEvent);
  }

  async getLatest(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationStatusEvent | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversation_status_events")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapStatusEvent(data as Record<string, unknown>);
  }
}
