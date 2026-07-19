/**
 * CRM link data-access for PR 2 shared inbox (Revision 3).
 * Lookup / create / unlink only — no CRM lead creation or auth rules.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WhatsAppConversationCrmLink,
  WhatsAppCrmLinkEntityType,
} from "./whatsappInboxDatabaseTypes.ts";
import {
  InboxSupabaseAccess,
  mapCrmLink,
  nowIso,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export type CrmLinkInsertIfAbsentResult =
  | { kind: "inserted"; row: WhatsAppConversationCrmLink }
  | { kind: "existing"; row: WhatsAppConversationCrmLink };

export interface WhatsAppInboxCrmLinkRepository {
  isActive(): boolean;
  getByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationCrmLink | null>;
  upsert(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<WhatsAppConversationCrmLink>;
  /**
   * INSERT ... ON CONFLICT DO NOTHING.
   * Winner gets inserted; loser receives the existing row.
   */
  insertIfAbsent(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<CrmLinkInsertIfAbsentResult>;
  deleteByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<boolean>;
}

export class InMemoryWhatsAppInboxCrmLinkRepository
  implements WhatsAppInboxCrmLinkRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async getByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationCrmLink | null> {
    const row = this.store.crmLinks.get(conversationId) ?? null;
    if (!row) return null;
    if (row.companyId !== this.access.companyId(companyId)) return null;
    return row;
  }

  async upsert(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<WhatsAppConversationCrmLink> {
    const row: WhatsAppConversationCrmLink = {
      conversationId: input.conversationId,
      companyId: this.access.companyId(input.companyId),
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: input.linkedEntityId,
      linkedByUserId: input.linkedByUserId,
      linkedAt: input.linkedAt ?? nowIso(),
    };
    this.store.crmLinks.set(input.conversationId, row);
    return row;
  }

  async insertIfAbsent(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<CrmLinkInsertIfAbsentResult> {
    // Synchronous claim — no await between existence check and insert.
    const companyId = this.access.companyId(input.companyId);
    const existing = this.store.crmLinks.get(input.conversationId) ?? null;
    if (existing && existing.companyId === companyId) {
      return { kind: "existing", row: existing };
    }
    const row: WhatsAppConversationCrmLink = {
      conversationId: input.conversationId,
      companyId,
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: input.linkedEntityId,
      linkedByUserId: input.linkedByUserId,
      linkedAt: input.linkedAt ?? nowIso(),
    };
    this.store.crmLinks.set(input.conversationId, row);
    return { kind: "inserted", row };
  }

  async deleteByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<boolean> {
    const existing = await this.getByConversationId(conversationId, companyId);
    if (!existing) return false;
    this.store.crmLinks.delete(conversationId);
    return true;
  }
}

export class SupabaseWhatsAppInboxCrmLinkRepository
  implements WhatsAppInboxCrmLinkRepository
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

  async getByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationCrmLink | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversation_crm_links")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapCrmLink(data as Record<string, unknown>);
  }

  async upsert(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<WhatsAppConversationCrmLink> {
    const row = {
      conversation_id: input.conversationId,
      company_id: this.access.companyId(input.companyId),
      linked_entity_type: input.linkedEntityType,
      linked_entity_id: input.linkedEntityId,
      linked_by_user_id: input.linkedByUserId,
      linked_at: input.linkedAt ?? nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_conversation_crm_links")
      .upsert(row, { onConflict: "conversation_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapCrmLink(data as Record<string, unknown>);
  }

  async insertIfAbsent(input: {
    conversationId: string;
    linkedEntityType: WhatsAppCrmLinkEntityType;
    linkedEntityId: string;
    linkedByUserId: string;
    companyId?: string;
    linkedAt?: string;
  }): Promise<CrmLinkInsertIfAbsentResult> {
    const companyId = this.access.companyId(input.companyId);
    const insertRow = {
      conversation_id: input.conversationId,
      company_id: companyId,
      linked_entity_type: input.linkedEntityType,
      linked_entity_id: input.linkedEntityId,
      linked_by_user_id: input.linkedByUserId,
      linked_at: input.linkedAt ?? nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_conversation_crm_links")
      .insert(insertRow)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return {
        kind: "inserted",
        row: mapCrmLink(data as Record<string, unknown>),
      };
    }
    const existing = await this.getByConversationId(
      input.conversationId,
      companyId
    );
    if (existing) return { kind: "existing", row: existing };
    throw new Error(
      error?.message || "CRM link insertIfAbsent failed without existing row"
    );
  }

  async deleteByConversationId(
    conversationId: string,
    companyId?: string
  ): Promise<boolean> {
    const { data, error } = await this.client()
      .from("whatsapp_conversation_crm_links")
      .delete()
      .eq("company_id", this.access.companyId(companyId))
      .eq("conversation_id", conversationId)
      .select("conversation_id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }
}
