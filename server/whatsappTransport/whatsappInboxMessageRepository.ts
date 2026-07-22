/**
 * Minimal message read repository for PR 2 inbox services (Revision 3).
 * No send/Graph logic — data access only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clampLimit,
  InboxSupabaseAccess,
  isBeforeKeyset,
  mapMessageRef,
  type InboxMessageRef,
  type KeysetCursor,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export type MessageListPage = {
  rows: InboxMessageRef[];
  nextCursor: KeysetCursor | null;
};

export interface WhatsAppInboxMessageRepository {
  isActive(): boolean;
  getById(
    messageId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null>;
  getLatestInbound(
    conversationId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null>;
  /** Newest-first page; `before` loads older messages. */
  listByConversation(
    conversationId: string,
    opts?: {
      companyId?: string;
      before?: KeysetCursor | null;
      limit?: number;
    }
  ): Promise<MessageListPage>;
}

export class InMemoryWhatsAppInboxMessageRepository
  implements WhatsAppInboxMessageRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async getById(
    messageId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null> {
    const row = this.store.messages.get(messageId) ?? null;
    if (!row) return null;
    if (row.companyId !== this.access.companyId(companyId)) return null;
    return row;
  }

  async getLatestInbound(
    conversationId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null> {
    const company = this.access.companyId(companyId);
    const rows = [...this.store.messages.values()]
      .filter(
        (m) =>
          m.conversationId === conversationId &&
          m.companyId === company &&
          m.direction === "inbound"
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return b.createdAt < a.createdAt ? -1 : 1;
        }
        return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
      });
    return rows[0] ?? null;
  }

  async listByConversation(
    conversationId: string,
    opts?: {
      companyId?: string;
      before?: KeysetCursor | null;
      limit?: number;
    }
  ): Promise<MessageListPage> {
    const company = this.access.companyId(opts?.companyId);
    const limit = clampLimit(opts?.limit);
    const before = opts?.before ?? null;
    const sorted = [...this.store.messages.values()]
      .filter(
        (m) => m.conversationId === conversationId && m.companyId === company
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return b.createdAt < a.createdAt ? -1 : 1;
        }
        return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
      })
      .filter((m) => {
        if (!before) return true;
        return isBeforeKeyset(m.createdAt, m.id, before);
      })
      .slice(0, limit + 1);
    const page = sorted.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        sorted.length > limit && last
          ? { at: last.createdAt, id: last.id }
          : null,
    };
  }
}

export class SupabaseWhatsAppInboxMessageRepository
  implements WhatsAppInboxMessageRepository
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

  async getById(
    messageId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null> {
    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapMessageRef(data as Record<string, unknown>);
  }

  async getLatestInbound(
    conversationId: string,
    companyId?: string
  ): Promise<InboxMessageRef | null> {
    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    return row ? mapMessageRef(row) : null;
  }

  async listByConversation(
    conversationId: string,
    opts?: {
      companyId?: string;
      before?: KeysetCursor | null;
      limit?: number;
    }
  ): Promise<MessageListPage> {
    const limit = clampLimit(opts?.limit);
    const before = opts?.before ?? null;
    let query = this.client()
      .from("whatsapp_messages")
      .select("*")
      .eq("company_id", this.access.companyId(opts?.companyId))
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (before) {
      query = query.or(
        `created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id})`
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Record<string, unknown>[]).map(mapMessageRef);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > limit && last
          ? { at: last.createdAt, id: last.id }
          : null,
    };
  }
}
