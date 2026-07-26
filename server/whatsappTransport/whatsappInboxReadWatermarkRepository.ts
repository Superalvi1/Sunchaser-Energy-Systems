/**
 * Read-watermark data-access for PR 2 shared inbox (Revision 3).
 * Inbound-only query helpers; no monotonic business rules here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppReadWatermark } from "./whatsappInboxDatabaseTypes.ts";
import {
  handleSupabaseError,
  InboxSupabaseAccess,
  mapMessageRef,
  mapReadWatermark,
  nowIso,
  type InboxMessageRef,
  type KeysetCursor,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";
import {
  batchUnreadStateFromMemory,
  batchUnreadStateFromSnapshots,
  type ConversationUnreadState,
} from "./whatsappInboxUnreadBatch.ts";

export interface WhatsAppInboxReadWatermarkRepository {
  isActive(): boolean;
  get(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<WhatsAppReadWatermark | null>;
  /** Upsert watermark tuple as provided (caller enforces monotonicity). */
  upsert(input: {
    conversationId: string;
    userId: string;
    lastReadInboundMessageId: string | null;
    lastReadInboundMessageCreatedAt: string | null;
    companyId?: string;
  }): Promise<WhatsAppReadWatermark>;
  /** Latest inbound message with (created_at, id) <= position. */
  findLatestInboundAtOrBefore(
    conversationId: string,
    position: KeysetCursor,
    companyId?: string
  ): Promise<InboxMessageRef | null>;
  countUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<number>;
  hasUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<boolean>;
  /**
   * Batch unread state for many conversations (single pass / few queries).
   * Avoids N+1 countUnreadInbound calls on live list refresh.
   */
  batchUnreadState(
    conversationIds: string[],
    userId: string,
    companyId?: string
  ): Promise<Map<string, ConversationUnreadState>>;
}

function isNewerThanWatermark(
  message: InboxMessageRef,
  watermark: WhatsAppReadWatermark | null
): boolean {
  if (!watermark?.lastReadInboundMessageCreatedAt || !watermark.lastReadInboundMessageId) {
    return true;
  }
  if (message.createdAt > watermark.lastReadInboundMessageCreatedAt) return true;
  if (message.createdAt < watermark.lastReadInboundMessageCreatedAt) return false;
  return message.id > watermark.lastReadInboundMessageId;
}

export class InMemoryWhatsAppInboxReadWatermarkRepository
  implements WhatsAppInboxReadWatermarkRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async get(
    conversationId: string,
    userId: string,
    _companyId?: string
  ): Promise<WhatsAppReadWatermark | null> {
    return (
      this.store.watermarks.get(this.store.watermarkKey(conversationId, userId)) ??
      null
    );
  }

  async upsert(input: {
    conversationId: string;
    userId: string;
    lastReadInboundMessageId: string | null;
    lastReadInboundMessageCreatedAt: string | null;
    companyId?: string;
  }): Promise<WhatsAppReadWatermark> {
    const row: WhatsAppReadWatermark = {
      companyId: this.access.companyId(input.companyId),
      conversationId: input.conversationId,
      userId: input.userId,
      lastReadInboundMessageId: input.lastReadInboundMessageId,
      lastReadInboundMessageCreatedAt: input.lastReadInboundMessageCreatedAt,
      updatedAt: nowIso(),
    };
    this.store.watermarks.set(
      this.store.watermarkKey(input.conversationId, input.userId),
      row
    );
    return row;
  }

  async findLatestInboundAtOrBefore(
    conversationId: string,
    position: KeysetCursor,
    _companyId?: string
  ): Promise<InboxMessageRef | null> {
    const candidates = [...this.store.messages.values()]
      .filter(
        (m) =>
          m.conversationId === conversationId &&
          m.direction === "inbound" &&
          (m.createdAt < position.at ||
            (m.createdAt === position.at && m.id <= position.id))
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return b.createdAt < a.createdAt ? -1 : 1;
        }
        return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
      });
    return candidates[0] ?? null;
  }

  async countUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<number> {
    const watermark = await this.get(conversationId, userId, companyId);
    return [...this.store.messages.values()].filter(
      (m) =>
        m.conversationId === conversationId &&
        m.direction === "inbound" &&
        m.isBackfill !== true &&
        isNewerThanWatermark(m, watermark)
    ).length;
  }

  async hasUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<boolean> {
    const count = await this.countUnreadInbound(
      conversationId,
      userId,
      companyId
    );
    return count > 0;
  }

  async batchUnreadState(
    conversationIds: string[],
    userId: string,
    _companyId?: string
  ): Promise<Map<string, ConversationUnreadState>> {
    return batchUnreadStateFromMemory(this.store, conversationIds, userId);
  }
}

export class SupabaseWhatsAppInboxReadWatermarkRepository
  implements WhatsAppInboxReadWatermarkRepository
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

  async get(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<WhatsAppReadWatermark | null> {
    const { data, error } = await this.client()
      .from("whatsapp_read_watermarks")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) handleSupabaseError(error);
    if (!data) return null;
    return mapReadWatermark(data as Record<string, unknown>);
  }

  async upsert(input: {
    conversationId: string;
    userId: string;
    lastReadInboundMessageId: string | null;
    lastReadInboundMessageCreatedAt: string | null;
    companyId?: string;
  }): Promise<WhatsAppReadWatermark> {
    const row = {
      company_id: this.access.companyId(input.companyId),
      conversation_id: input.conversationId,
      user_id: input.userId,
      last_read_inbound_message_id: input.lastReadInboundMessageId,
      last_read_inbound_message_created_at: input.lastReadInboundMessageCreatedAt,
      updated_at: nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_read_watermarks")
      .upsert(row, { onConflict: "conversation_id,user_id" })
      .select("*")
      .single();
    if (error) handleSupabaseError(error);
    return mapReadWatermark(data as Record<string, unknown>);
  }

  async findLatestInboundAtOrBefore(
    conversationId: string,
    position: KeysetCursor,
    companyId?: string
  ): Promise<InboxMessageRef | null> {
    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, created_at, company_id")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .or(
        `created_at.lt.${position.at},and(created_at.eq.${position.at},id.lte.${position.id})`
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error) handleSupabaseError(error);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    return row ? mapMessageRef(row) : null;
  }

  async countUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<number> {
    const watermark = await this.get(conversationId, userId, companyId);
    let query = this.client()
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .eq("is_backfill", false);

    if (
      watermark?.lastReadInboundMessageCreatedAt &&
      watermark.lastReadInboundMessageId
    ) {
      query = query.or(
        `created_at.gt.${watermark.lastReadInboundMessageCreatedAt},and(created_at.eq.${watermark.lastReadInboundMessageCreatedAt},id.gt.${watermark.lastReadInboundMessageId})`
      );
    }

    const { count, error } = await query;
    if (error) handleSupabaseError(error);
    return count ?? 0;
  }

  async hasUnreadInbound(
    conversationId: string,
    userId: string,
    companyId?: string
  ): Promise<boolean> {
    const watermark = await this.get(conversationId, userId, companyId);
    let query = this.client()
      .from("whatsapp_messages")
      .select("id")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .eq("is_backfill", false);

    if (
      watermark?.lastReadInboundMessageCreatedAt &&
      watermark.lastReadInboundMessageId
    ) {
      query = query.or(
        `created_at.gt.${watermark.lastReadInboundMessageCreatedAt},and(created_at.eq.${watermark.lastReadInboundMessageCreatedAt},id.gt.${watermark.lastReadInboundMessageId})`
      );
    }

    const { data, error } = await query.limit(1);
    if (error) handleSupabaseError(error);
    return (data ?? []).length > 0;
  }

  async batchUnreadState(
    conversationIds: string[],
    userId: string,
    companyId?: string
  ): Promise<Map<string, ConversationUnreadState>> {
    if (conversationIds.length === 0) return new Map();
    const company = this.access.companyId(companyId);

    const { data: watermarkRows, error: wmError } = await this.client()
      .from("whatsapp_read_watermarks")
      .select("*")
      .eq("company_id", company)
      .eq("user_id", userId)
      .in("conversation_id", conversationIds);
    if (wmError) handleSupabaseError(wmError);

    const watermarksByConversationId = new Map<
      string,
      WhatsAppReadWatermark | null
    >();
    for (const id of conversationIds) {
      watermarksByConversationId.set(id, null);
    }
    for (const row of (watermarkRows ?? []) as Record<string, unknown>[]) {
      const mapped = mapReadWatermark(row);
      watermarksByConversationId.set(mapped.conversationId, mapped);
    }

    const { data: messageRows, error: msgError } = await this.client()
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, created_at, company_id, is_backfill")
      .eq("company_id", company)
      .in("conversation_id", conversationIds)
      .eq("direction", "inbound")
      .eq("is_backfill", false);
    if (msgError) handleSupabaseError(msgError);

    const inbound = ((messageRows ?? []) as Record<string, unknown>[]).map(
      mapMessageRef
    );
    return batchUnreadStateFromSnapshots(
      conversationIds,
      watermarksByConversationId,
      inbound
    );
  }
}
