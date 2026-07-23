/**
 * Outbound idempotency-key data-access for PR 2 shared inbox (Revision 3).
 * Atomic claim + state updates only — no HTTP / Meta / guard logic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WhatsAppOutboundIdempotencyKey,
  WhatsAppOutboundIdempotencyState,
} from "./whatsappInboxDatabaseTypes.ts";
import {
  handleSupabaseError,
  InboxSupabaseAccess,
  mapIdempotencyKey,
  nowIso,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export type IdempotencyClaimResult =
  | { kind: "claimed"; row: WhatsAppOutboundIdempotencyKey }
  | { kind: "existing"; row: WhatsAppOutboundIdempotencyKey };

export interface WhatsAppInboxIdempotencyRepository {
  isActive(): boolean;
  /**
   * INSERT ... ON CONFLICT DO NOTHING RETURNING *.
   * claimed = this caller owns the key; existing = another caller already owns it.
   */
  claim(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    createdAt?: string;
  }): Promise<IdempotencyClaimResult>;
  getByKey(
    idempotencyKey: string,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null>;
  markCompleted(input: {
    idempotencyKey: string;
    messageId: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null>;
  markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null>;
  /** Conditional: only when current state is processing. */
  markOutcomeUnknown(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null>;
}

export class InMemoryWhatsAppInboxIdempotencyRepository
  implements WhatsAppInboxIdempotencyRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async claim(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    createdAt?: string;
  }): Promise<IdempotencyClaimResult> {
    const existing = this.store.idempotencyKeys.get(input.idempotencyKey);
    if (existing) return { kind: "existing", row: existing };
    const row: WhatsAppOutboundIdempotencyKey = {
      idempotencyKey: input.idempotencyKey,
      companyId: this.access.companyId(input.companyId),
      conversationId: input.conversationId,
      state: "processing",
      messageId: null,
      error: null,
      createdAt: input.createdAt ?? nowIso(),
      completedAt: null,
    };
    this.store.idempotencyKeys.set(input.idempotencyKey, row);
    return { kind: "claimed", row };
  }

  async getByKey(
    idempotencyKey: string,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const row = this.store.idempotencyKeys.get(idempotencyKey) ?? null;
    if (!row) return null;
    if (row.companyId !== this.access.companyId(companyId)) return null;
    return row;
  }

  async markCompleted(input: {
    idempotencyKey: string;
    messageId: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const existing = await this.getByKey(input.idempotencyKey, input.companyId);
    if (!existing) return null;
    const next: WhatsAppOutboundIdempotencyKey = {
      ...existing,
      state: "completed",
      messageId: input.messageId,
      error: null,
      completedAt: input.completedAt ?? nowIso(),
    };
    this.store.idempotencyKeys.set(input.idempotencyKey, next);
    return next;
  }

  async markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const existing = await this.getByKey(input.idempotencyKey, input.companyId);
    if (!existing) return null;
    const next: WhatsAppOutboundIdempotencyKey = {
      ...existing,
      state: "failed_known",
      messageId: null,
      error: input.error,
      completedAt: input.completedAt ?? nowIso(),
    };
    this.store.idempotencyKeys.set(input.idempotencyKey, next);
    return next;
  }

  async markOutcomeUnknown(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const existing = await this.getByKey(input.idempotencyKey, input.companyId);
    if (!existing || existing.state !== "processing") return null;
    const next: WhatsAppOutboundIdempotencyKey = {
      ...existing,
      state: "outcome_unknown",
      completedAt: input.completedAt ?? nowIso(),
    };
    this.store.idempotencyKeys.set(input.idempotencyKey, next);
    return next;
  }
}

export class SupabaseWhatsAppInboxIdempotencyRepository
  implements WhatsAppInboxIdempotencyRepository
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

  async claim(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    createdAt?: string;
  }): Promise<IdempotencyClaimResult> {
    const companyId = this.access.companyId(input.companyId);
    const row = {
      idempotency_key: input.idempotencyKey,
      company_id: companyId,
      conversation_id: input.conversationId,
      state: "processing" as WhatsAppOutboundIdempotencyState,
      created_at: input.createdAt ?? nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency")
      .insert(row)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return {
        kind: "claimed",
        row: mapIdempotencyKey(data as Record<string, unknown>),
      };
    }
    const existing = await this.getByKey(input.idempotencyKey, companyId);
    if (existing) return { kind: "existing", row: existing };
    if (error) handleSupabaseError(error);
    throw new Error("Idempotency claim failed");
  }

  async getByKey(
    idempotencyKey: string,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) handleSupabaseError(error);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }

  async markCompleted(input: {
    idempotencyKey: string;
    messageId: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency")
      .update({
        state: "completed" as WhatsAppOutboundIdempotencyState,
        message_id: input.messageId,
        completed_at: input.completedAt ?? nowIso(),
      })
      .eq("company_id", this.access.companyId(input.companyId))
      .eq("idempotency_key", input.idempotencyKey)
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }

  async markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency")
      .update({
        state: "failed_known" as WhatsAppOutboundIdempotencyState,
        error: input.error,
        completedAt: input.completedAt ?? nowIso(),
      })
      .eq("company_id", this.access.companyId(input.companyId))
      .eq("idempotency_key", input.idempotencyKey)
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }

  async markOutcomeUnknown(input: {
    idempotencyKey: string;
    conversationId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency")
      .update({
        state: "outcome_unknown" as WhatsAppOutboundIdempotencyState,
        completedAt: input.completedAt ?? nowIso(),
      })
      .eq("company_id", this.access.companyId(input.companyId))
      .eq("idempotency_key", input.idempotencyKey)
      .eq("state", "processing")
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }
}
