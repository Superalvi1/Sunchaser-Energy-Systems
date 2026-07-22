/**
 * Conversation data-access for PR 2 shared inbox (Revision 3).
 * No permissions, OCC, or workflow rules — persistence/query only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WhatsAppConversationAssignmentEvent,
  WhatsAppConversationInbox,
  WhatsAppConversationStatusEvent,
  WhatsAppInboxConversationStatus,
} from "./whatsappInboxDatabaseTypes.ts";
import {
  activityAt,
  clampLimit,
  InboxSupabaseAccess,
  isBeforeKeyset,
  mapConversationInbox,
  newInboxId,
  nowIso,
  type KeysetCursor,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export type ConversationListFilters = {
  companyId?: string;
  status?: WhatsAppInboxConversationStatus;
  /** Exact assignee user id, or "unassigned" for null assignee. */
  assignedTo?: string | "unassigned";
  channelId?: string;
  hasFailedMessage?: boolean;
};

export type ConversationListPage = {
  rows: WhatsAppConversationInbox[];
  nextCursor: KeysetCursor | null;
};

export type ConversationCasPatch = {
  status?: WhatsAppInboxConversationStatus;
  assignedUserId?: string | null;
  assignedAt?: string | null;
  assignedBy?: string | null;
  hasFailedMessage?: boolean;
  aiOwnershipState?: WhatsAppAiOwnershipState;
  companyId?: string;
};

export type ConversationCasResult =
  | { ok: true; row: WhatsAppConversationInbox }
  | {
      ok: false;
      reason: "not_found" | "conflict";
      current: WhatsAppConversationInbox | null;
    };

export interface WhatsAppInboxConversationRepository {
  isActive(): boolean;
  getById(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null>;
  /** Activity sort: coalesce(last_message_at, created_at) desc, id desc. */
  listByActivity(
    filters: ConversationListFilters,
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListPage>;
  /**
   * Delta poll keyset: rows with (updated_at, id) > since,
   * ordered updated_at asc, id asc (monotonic forward traversal).
   */
  listDelta(
    filters: ConversationListFilters,
    opts: { since: KeysetCursor; limit?: number }
  ): Promise<ConversationListPage>;
  /**
   * OCC compare-and-set: UPDATE ... WHERE lock_version = expected.
   * On success increments lock_version by 1 and bumps updated_at.
   */
  compareAndSet(
    conversationId: string,
    expectedLockVersion: number,
    patch: ConversationCasPatch
  ): Promise<ConversationCasResult>;
  /**
   * Atomic: CAS status + insert status event in one transaction/unit.
   * On audit failure the conversation mutation is rolled back.
   */
  applyStatusChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    toStatus: WhatsAppInboxConversationStatus;
    fromStatus: WhatsAppInboxConversationStatus | null;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult>;
  /**
   * Atomic: CAS assignment columns + insert assignment event in one unit.
   * On audit failure the conversation mutation is rolled back.
   */
  applyAssignmentChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    assignedUserId: string | null;
    assignedAt: string | null;
    assignedBy: string;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult>;
  /** Raw assignment column write (no OCC / permission checks). */
  updateAssignmentFields(
    conversationId: string,
    fields: {
      assignedUserId: string | null;
      assignedAt: string | null;
      assignedBy: string | null;
      companyId?: string;
    }
  ): Promise<WhatsAppConversationInbox | null>;
  /** Raw status column write (no OCC / transition validation). */
  updateStatusField(
    conversationId: string,
    fields: {
      status: WhatsAppInboxConversationStatus;
      companyId?: string;
      lockVersion?: number;
    }
  ): Promise<WhatsAppConversationInbox | null>;
  setHasFailedMessage(
    conversationId: string,
    hasFailedMessage: boolean,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null>;
  touchUpdatedAt(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null>;
}

function matchesFilters(
  row: WhatsAppConversationInbox,
  filters: ConversationListFilters,
  companyId: string
): boolean {
  if (row.companyId !== companyId) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.channelId && row.channelId !== filters.channelId) return false;
  if (filters.hasFailedMessage === true && !row.hasFailedMessage) return false;
  if (filters.hasFailedMessage === false && row.hasFailedMessage) return false;
  if (filters.assignedTo === "unassigned") {
    if (row.assignedUserId != null) return false;
  } else if (filters.assignedTo) {
    if (row.assignedUserId !== filters.assignedTo) return false;
  }
  return true;
}

export class InMemoryWhatsAppInboxConversationRepository
  implements WhatsAppInboxConversationRepository
{
  constructor(
    private readonly store: WhatsAppInboxMemoryStore,
    private readonly access = new InboxSupabaseAccess()
  ) {}

  isActive(): boolean {
    return true;
  }

  async getById(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const row = this.store.conversations.get(conversationId) ?? null;
    if (!row) return null;
    if (row.companyId !== this.access.companyId(companyId)) return null;
    return row;
  }

  async listByActivity(
    filters: ConversationListFilters,
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListPage> {
    const companyId = this.access.companyId(filters.companyId);
    const limit = clampLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const sorted = [...this.store.conversations.values()]
      .filter((row) => matchesFilters(row, filters, companyId))
      .sort((a, b) => {
        const aa = activityAt(a);
        const ba = activityAt(b);
        if (aa !== ba) return ba < aa ? -1 : 1;
        return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
      })
      .filter((row) => {
        if (!cursor) return true;
        return isBeforeKeyset(activityAt(row), row.id, cursor);
      })
      .slice(0, limit + 1);

    const page = sorted.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        sorted.length > limit && last
          ? { at: activityAt(last), id: last.id }
          : null,
    };
  }

  async listDelta(
    filters: ConversationListFilters,
    opts: { since: KeysetCursor; limit?: number }
  ): Promise<ConversationListPage> {
    const companyId = this.access.companyId(filters.companyId);
    const limit = clampLimit(opts.limit);
    const sinceId = opts.since.id ?? "";
    const sorted = [...this.store.conversations.values()]
      .filter((row) => matchesFilters(row, filters, companyId))
      .filter((row) => {
        if (row.updatedAt > opts.since.at) return true;
        if (row.updatedAt < opts.since.at) return false;
        return row.id > sinceId;
      })
      .sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) {
          return a.updatedAt < b.updatedAt ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, limit + 1);

    const page = sorted.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        sorted.length > limit && last
          ? { at: last.updatedAt, id: last.id }
          : null,
    };
  }

  async compareAndSet(
    conversationId: string,
    expectedLockVersion: number,
    patch: ConversationCasPatch
  ): Promise<ConversationCasResult> {
    // Synchronous critical section — no await between read and write.
    const companyId = this.access.companyId(patch.companyId);
    const current = this.store.conversations.get(conversationId) ?? null;
    if (!current || current.companyId !== companyId) {
      return { ok: false, reason: "not_found", current: null };
    }
    if (current.lockVersion !== expectedLockVersion) {
      return { ok: false, reason: "conflict", current };
    }
    const next: WhatsAppConversationInbox = {
      ...current,
      status: patch.status !== undefined ? patch.status : current.status,
      assignedUserId:
        patch.assignedUserId !== undefined
          ? patch.assignedUserId
          : current.assignedUserId,
      assignedAt:
        patch.assignedAt !== undefined ? patch.assignedAt : current.assignedAt,
      assignedBy:
        patch.assignedBy !== undefined ? patch.assignedBy : current.assignedBy,
      hasFailedMessage:
        patch.hasFailedMessage !== undefined
          ? patch.hasFailedMessage
          : current.hasFailedMessage,
      aiOwnershipState:
        patch.aiOwnershipState !== undefined
          ? patch.aiOwnershipState
          : current.aiOwnershipState,
      lockVersion: current.lockVersion + 1,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(conversationId, next);
    return { ok: true, row: next };
  }

  async applyStatusChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    toStatus: WhatsAppInboxConversationStatus;
    fromStatus: WhatsAppInboxConversationStatus | null;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult> {
    // Entire CAS+audit unit is synchronous so concurrent callers cannot tear.
    const companyId = this.access.companyId(input.companyId);
    const previous = this.store.conversations.get(input.conversationId) ?? null;
    if (!previous || previous.companyId !== companyId) {
      return { ok: false, reason: "not_found", current: null };
    }
    if (previous.lockVersion !== input.expectedLockVersion) {
      return { ok: false, reason: "conflict", current: previous };
    }

    const next: WhatsAppConversationInbox = {
      ...previous,
      status: input.toStatus,
      lockVersion: previous.lockVersion + 1,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(input.conversationId, next);

    const eventId = input.eventId ?? newInboxId("wcse");
    try {
      this.store.beforeStatusEventInsert?.();
      const event: WhatsAppConversationStatusEvent = {
        id: eventId,
        companyId,
        conversationId: input.conversationId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        changedByUserId: input.changedByUserId,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? nowIso(),
      };
      this.store.statusEvents.set(event.id, event);
    } catch (err) {
      this.store.conversations.set(input.conversationId, previous);
      throw err;
    }
    return { ok: true, row: next };
  }

  async applyAssignmentChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    assignedUserId: string | null;
    assignedAt: string | null;
    assignedBy: string;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult> {
    const companyId = this.access.companyId(input.companyId);
    const previous = this.store.conversations.get(input.conversationId) ?? null;
    if (!previous || previous.companyId !== companyId) {
      return { ok: false, reason: "not_found", current: null };
    }
    if (previous.lockVersion !== input.expectedLockVersion) {
      return { ok: false, reason: "conflict", current: previous };
    }

    const next: WhatsAppConversationInbox = {
      ...previous,
      assignedUserId: input.assignedUserId,
      assignedAt: input.assignedAt,
      assignedBy: input.assignedBy,
      aiOwnershipState:
        input.assignedUserId != null ? "HUMAN_HANDLING" : "AI_SHADOW",
      lockVersion: previous.lockVersion + 1,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(input.conversationId, next);

    const eventId = input.eventId ?? newInboxId("waae");
    try {
      this.store.beforeAssignmentEventInsert?.();
      const event: WhatsAppConversationAssignmentEvent = {
        id: eventId,
        companyId,
        conversationId: input.conversationId,
        assignedUserId: input.assignedUserId,
        assignedBy: input.assignedBy,
        createdAt: input.createdAt ?? nowIso(),
      };
      this.store.assignmentEvents.set(event.id, event);
    } catch (err) {
      this.store.conversations.set(input.conversationId, previous);
      throw err;
    }
    return { ok: true, row: next };
  }

  async updateAssignmentFields(
    conversationId: string,
    fields: {
      assignedUserId: string | null;
      assignedAt: string | null;
      assignedBy: string | null;
      companyId?: string;
    }
  ): Promise<WhatsAppConversationInbox | null> {
    const row = await this.getById(conversationId, fields.companyId);
    if (!row) return null;
    const next: WhatsAppConversationInbox = {
      ...row,
      assignedUserId: fields.assignedUserId,
      assignedAt: fields.assignedAt,
      assignedBy: fields.assignedBy,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(conversationId, next);
    return next;
  }

  async updateStatusField(
    conversationId: string,
    fields: {
      status: WhatsAppInboxConversationStatus;
      companyId?: string;
      lockVersion?: number;
    }
  ): Promise<WhatsAppConversationInbox | null> {
    const row = await this.getById(conversationId, fields.companyId);
    if (!row) return null;
    const next: WhatsAppConversationInbox = {
      ...row,
      status: fields.status,
      lockVersion:
        fields.lockVersion != null ? fields.lockVersion : row.lockVersion,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(conversationId, next);
    return next;
  }

  async setHasFailedMessage(
    conversationId: string,
    hasFailedMessage: boolean,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const row = await this.getById(conversationId, companyId);
    if (!row) return null;
    const next: WhatsAppConversationInbox = {
      ...row,
      hasFailedMessage,
      updatedAt: nowIso(),
    };
    this.store.conversations.set(conversationId, next);
    return next;
  }

  async touchUpdatedAt(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const row = await this.getById(conversationId, companyId);
    if (!row) return null;
    const next = { ...row, updatedAt: nowIso() };
    this.store.conversations.set(conversationId, next);
    return next;
  }
}

export class SupabaseWhatsAppInboxConversationRepository
  implements WhatsAppInboxConversationRepository
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
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .select("*")
      .eq("company_id", this.access.companyId(companyId))
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapConversationInbox(data as Record<string, unknown>);
  }

  private applyFilters(
    query: {
      eq: (column: string, value: unknown) => unknown;
      is: (column: string, value: null) => unknown;
    },
    filters: ConversationListFilters,
    companyId: string
  ) {
    // Chained PostgREST builders vary by supabase-js version; keep local typing minimal.
    let q: any = query.eq("company_id", companyId);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.channelId) q = q.eq("channel_id", filters.channelId);
    if (filters.hasFailedMessage === true) {
      q = q.eq("has_failed_message", true);
    } else if (filters.hasFailedMessage === false) {
      q = q.eq("has_failed_message", false);
    }
    if (filters.assignedTo === "unassigned") {
      q = q.is("assigned_user_id", null);
    } else if (filters.assignedTo) {
      q = q.eq("assigned_user_id", filters.assignedTo);
    }
    return q;
  }

  async listByActivity(
    filters: ConversationListFilters,
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListPage> {
    const companyId = this.access.companyId(filters.companyId);
    const limit = clampLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;

    // Production path: SQL RPC performs coalesce ordering + keyset entirely in Postgres
    // (uses whatsapp_conversations_activity_idx). No in-memory sort/trim.
    const { data, error } = await this.client().rpc(
      "whatsapp_inbox_list_conversations_by_activity",
      {
        p_company_id: companyId,
        p_limit: limit + 1,
        p_cursor_at: cursor?.at ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_status: filters.status ?? null,
        p_assigned_to: filters.assignedTo ?? null,
        p_channel_id: filters.channelId ?? null,
        p_has_failed_message:
          filters.hasFailedMessage === undefined
            ? null
            : filters.hasFailedMessage,
      }
    );
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as Record<string, unknown>[]).map(
      mapConversationInbox
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > limit && last
          ? { at: activityAt(last), id: last.id }
          : null,
    };
  }

  async listDelta(
    filters: ConversationListFilters,
    opts: { since: KeysetCursor; limit?: number }
  ): Promise<ConversationListPage> {
    const companyId = this.access.companyId(filters.companyId);
    const limit = clampLimit(opts.limit);

    // Production path: SQL RPC performs ASC keyset entirely in Postgres.
    // Avoids PostgREST .or() timestamp encoding issues and DESC page loops.
    const { data, error } = await this.client().rpc(
      "whatsapp_inbox_list_conversations_delta",
      {
        p_company_id: companyId,
        p_limit: limit + 1,
        p_since_at: opts.since.at,
        p_since_id: opts.since.id ?? "",
        p_status: filters.status ?? null,
        p_assigned_to: filters.assignedTo ?? null,
        p_channel_id: filters.channelId ?? null,
        p_has_failed_message:
          filters.hasFailedMessage === undefined
            ? null
            : filters.hasFailedMessage,
      }
    );
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as Record<string, unknown>[]).map(
      mapConversationInbox
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > limit && last
          ? { at: last.updatedAt, id: last.id }
          : null,
    };
  }

  async compareAndSet(
    conversationId: string,
    expectedLockVersion: number,
    patch: ConversationCasPatch
  ): Promise<ConversationCasResult> {
    const companyId = this.access.companyId(patch.companyId);
    const updateRow: Record<string, unknown> = {
      lock_version: expectedLockVersion + 1,
      updated_at: nowIso(),
    };
    if (patch.status !== undefined) updateRow.status = patch.status;
    if (patch.assignedUserId !== undefined) {
      updateRow.assigned_user_id = patch.assignedUserId;
    }
    if (patch.assignedAt !== undefined) updateRow.assigned_at = patch.assignedAt;
    if (patch.assignedBy !== undefined) updateRow.assigned_by = patch.assignedBy;
    if (patch.hasFailedMessage !== undefined) {
      updateRow.has_failed_message = patch.hasFailedMessage;
    }

    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .update(updateRow)
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .eq("lock_version", expectedLockVersion)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      return {
        ok: true,
        row: mapConversationInbox(data as Record<string, unknown>),
      };
    }
    const current = await this.getById(conversationId, companyId);
    if (!current) return { ok: false, reason: "not_found", current: null };
    return { ok: false, reason: "conflict", current };
  }

  async applyStatusChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    toStatus: WhatsAppInboxConversationStatus;
    fromStatus: WhatsAppInboxConversationStatus | null;
    changedByUserId: string | null;
    metadata?: Record<string, unknown>;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult> {
    const companyId = this.access.companyId(input.companyId);
    const { data, error } = await this.client().rpc(
      "whatsapp_inbox_apply_status_change",
      {
        p_company_id: companyId,
        p_conversation_id: input.conversationId,
        p_expected_lock_version: input.expectedLockVersion,
        p_to_status: input.toStatus,
        p_from_status: input.fromStatus,
        p_changed_by_user_id: input.changedByUserId,
        p_metadata: input.metadata ?? {},
        p_event_id: input.eventId ?? newInboxId("wcse"),
        p_created_at: input.createdAt ?? nowIso(),
      }
    );
    if (error) throw new Error(error.message);
    if (!data) {
      const current = await this.getById(input.conversationId, companyId);
      if (!current) return { ok: false, reason: "not_found", current: null };
      return { ok: false, reason: "conflict", current };
    }
    return {
      ok: true,
      row: mapConversationInbox(data as Record<string, unknown>),
    };
  }

  async applyAssignmentChangeAtomic(input: {
    conversationId: string;
    expectedLockVersion: number;
    assignedUserId: string | null;
    assignedAt: string | null;
    assignedBy: string;
    companyId?: string;
    eventId?: string;
    createdAt?: string;
  }): Promise<ConversationCasResult> {
    const companyId = this.access.companyId(input.companyId);
    const { data, error } = await this.client().rpc(
      "whatsapp_inbox_apply_assignment_change",
      {
        p_company_id: companyId,
        p_conversation_id: input.conversationId,
        p_expected_lock_version: input.expectedLockVersion,
        p_assigned_user_id: input.assignedUserId,
        p_assigned_at: input.assignedAt,
        p_assigned_by: input.assignedBy,
        p_event_id: input.eventId ?? newInboxId("waae"),
        p_created_at: input.createdAt ?? nowIso(),
      }
    );
    if (error) throw new Error(error.message);
    if (!data) {
      const current = await this.getById(input.conversationId, companyId);
      if (!current) return { ok: false, reason: "not_found", current: null };
      return { ok: false, reason: "conflict", current };
    }
    return {
      ok: true,
      row: mapConversationInbox(data as Record<string, unknown>),
    };
  }

  async updateAssignmentFields(
    conversationId: string,
    fields: {
      assignedUserId: string | null;
      assignedAt: string | null;
      assignedBy: string | null;
      companyId?: string;
    }
  ): Promise<WhatsAppConversationInbox | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .update({
        assigned_user_id: fields.assignedUserId,
        assigned_at: fields.assignedAt,
        assigned_by: fields.assignedBy,
        updated_at: nowIso(),
      })
      .eq("company_id", this.access.companyId(fields.companyId))
      .eq("id", conversationId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapConversationInbox(data as Record<string, unknown>);
  }

  async updateStatusField(
    conversationId: string,
    fields: {
      status: WhatsAppInboxConversationStatus;
      companyId?: string;
      lockVersion?: number;
    }
  ): Promise<WhatsAppConversationInbox | null> {
    const patch: Record<string, unknown> = {
      status: fields.status,
      updated_at: nowIso(),
    };
    if (fields.lockVersion != null) patch.lock_version = fields.lockVersion;
    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .update(patch)
      .eq("company_id", this.access.companyId(fields.companyId))
      .eq("id", conversationId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapConversationInbox(data as Record<string, unknown>);
  }

  async setHasFailedMessage(
    conversationId: string,
    hasFailedMessage: boolean,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .update({
        has_failed_message: hasFailedMessage,
        updated_at: nowIso(),
      })
      .eq("company_id", this.access.companyId(companyId))
      .eq("id", conversationId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapConversationInbox(data as Record<string, unknown>);
  }

  async touchUpdatedAt(
    conversationId: string,
    companyId?: string
  ): Promise<WhatsAppConversationInbox | null> {
    const { data, error } = await this.client()
      .from("whatsapp_conversations")
      .update({ updated_at: nowIso() })
      .eq("company_id", this.access.companyId(companyId))
      .eq("id", conversationId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapConversationInbox(data as Record<string, unknown>);
  }
}
