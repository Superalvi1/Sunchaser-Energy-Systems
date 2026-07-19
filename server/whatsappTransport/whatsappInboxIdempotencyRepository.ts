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
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null>;
  markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null>;
  /** Conditional: only when current state is processing. */
  markOutcomeUnknown(input: {
    idempotencyKey: string;
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

  private async setState(
    idempotencyKey: string,
    patch: Partial<WhatsAppOutboundIdempotencyKey>,
    requiredState?: WhatsAppOutboundIdempotencyState,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const row = await this.getByKey(idempotencyKey, companyId);
    if (!row) return null;
    if (requiredState && row.state !== requiredState) return null;
    const next = { ...row, ...patch };
    this.store.idempotencyKeys.set(idempotencyKey, next);
    return next;
  }

  async markCompleted(input: {
    idempotencyKey: string;
    messageId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.setState(
      input.idempotencyKey,
      {
        state: "completed",
        messageId: input.messageId,
        error: null,
        completedAt: input.completedAt ?? nowIso(),
      },
      "processing",
      input.companyId
    );
  }

  async markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.setState(
      input.idempotencyKey,
      {
        state: "failed_known",
        error: input.error,
        completedAt: input.completedAt ?? nowIso(),
      },
      "processing",
      input.companyId
    );
  }

  async markOutcomeUnknown(input: {
    idempotencyKey: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.setState(
      input.idempotencyKey,
      {
        state: "outcome_unknown",
        completedAt: input.completedAt ?? nowIso(),
      },
      "processing",
      input.companyId
    );
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
    const insertRow = {
      idempotency_key: input.idempotencyKey,
      company_id: companyId,
      conversation_id: input.conversationId,
      state: "processing" as const,
      created_at: input.createdAt ?? nowIso(),
    };

    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency_keys")
      .insert(insertRow)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return {
        kind: "claimed",
        row: mapIdempotencyKey(data as Record<string, unknown>),
      };
    }

    // Unique conflict or empty return → load existing row.
    const existing = await this.getByKey(input.idempotencyKey, companyId);
    if (existing) return { kind: "existing", row: existing };
    throw new Error(
      error?.message ||
        "idempotency claim failed without returning an existing row"
    );
  }

  async getByKey(
    idempotencyKey: string,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency_keys")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }

  private async updateFromProcessing(
    idempotencyKey: string,
    patch: Record<string, unknown>,
    companyId?: string
  ): Promise<WhatsAppOutboundIdempotencyKey | null> {
    const { data, error } = await this.client()
      .from("whatsapp_outbound_idempotency_keys")
      .update(patch)
      .eq("company_id", this.access.companyId(companyId))
      .eq("idempotency_key", idempotencyKey)
      .eq("state", "processing")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapIdempotencyKey(data as Record<string, unknown>);
  }

  async markCompleted(input: {
    idempotencyKey: string;
    messageId: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.updateFromProcessing(
      input.idempotencyKey,
      {
        state: "completed",
        message_id: input.messageId,
        error: null,
        completed_at: input.completedAt ?? nowIso(),
      },
      input.companyId
    );
  }

  async markFailedKnown(input: {
    idempotencyKey: string;
    error: string | null;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.updateFromProcessing(
      input.idempotencyKey,
      {
        state: "failed_known",
        error: input.error,
        completed_at: input.completedAt ?? nowIso(),
      },
      input.companyId
    );
  }

  async markOutcomeUnknown(input: {
    idempotencyKey: string;
    companyId?: string;
    completedAt?: string;
  }): Promise<WhatsAppOutboundIdempotencyKey | null> {
    return this.updateFromProcessing(
      input.idempotencyKey,
      {
        state: "outcome_unknown",
        completed_at: input.completedAt ?? nowIso(),
      },
      input.companyId
    );
  }
}
