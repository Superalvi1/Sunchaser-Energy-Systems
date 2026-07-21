/**
 * Assignment history / persistence for PR 2 shared inbox (Revision 3).
 * No permission or OCC logic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppConversationAssignmentEvent } from "./whatsappInboxDatabaseTypes.ts";
import {
  clampLimit,
  InboxSupabaseAccess,
  mapAssignmentEvent,
  newInboxId,
  nowIso,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export interface WhatsAppInboxAssignmentRepository {
  isActive(): boolean;
  insertEvent(input: {
    conversationId: string;
    assignedUserId: string | null;
    assignedBy: string;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationAssignmentEvent>;
  listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationAssignmentEvent[]>;
}

export class InMemoryWhatsAppInboxAssignmentRepository
  implements WhatsAppInboxAssignmentRepository
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
    assignedUserId: string | null;
    assignedBy: string;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationAssignmentEvent> {
    const row: WhatsAppConversationAssignmentEvent = {
      id: input.id ?? newInboxId("waae"),
      companyId: this.access.companyId(input.companyId),
      conversationId: input.conversationId,
      assignedUserId: input.assignedUserId,
      assignedBy: input.assignedBy,
      createdAt: input.createdAt ?? nowIso(),
    };
    this.store.assignmentEvents.set(row.id, row);
    return row;
  }

  async listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationAssignmentEvent[]> {
    const companyId = this.access.companyId(opts?.companyId);
    const limit = clampLimit(opts?.limit, 100, 500);
    return [...this.store.assignmentEvents.values()]
      .filter(
        (e) =>
          e.conversationId === conversationId && e.companyId === companyId
      )
      .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
      .slice(0, limit);
  }
}

export class SupabaseWhatsAppInboxAssignmentRepository
  implements WhatsAppInboxAssignmentRepository
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
    assignedUserId: string | null;
    assignedBy: string;
    companyId?: string;
    id?: string;
    createdAt?: string;
  }): Promise<WhatsAppConversationAssignmentEvent> {
    const row = {
      id: input.id ?? newInboxId("waae"),
      company_id: this.access.companyId(input.companyId),
      conversation_id: input.conversationId,
      assigned_user_id: input.assignedUserId,
      assigned_by: input.assignedBy,
      created_at: input.createdAt ?? nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_conversation_assignment_events")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapAssignmentEvent(data as Record<string, unknown>);
  }

  async listByConversation(
    conversationId: string,
    opts?: { companyId?: string; limit?: number }
  ): Promise<WhatsAppConversationAssignmentEvent[]> {
    const { data, error } = await this.client()
      .from("whatsapp_conversation_assignment_events")
      .select("*")
      .eq("company_id", this.access.companyId(opts?.companyId))
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(clampLimit(opts?.limit, 100, 500));
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(mapAssignmentEvent);
  }
}
