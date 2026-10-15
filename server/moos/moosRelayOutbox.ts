/**
 * Moos WhatsApp agent — durable inbound relay outbox.
 *
 * The WhatsApp webhook must return 200 fast and must never lose an inbound
 * event when the Moos worker is down. So the webhook only ENQUEUES the
 * normalized event here (unique wamid — duplicates are no-ops), and a
 * periodic drain (`drainMoosRelayOutbox`, wired on an interval in server.ts)
 * delivers queued events to the worker with bounded retry/backoff.
 *
 * Delivery semantics per event:
 *  - legacy AI enabled (fresh, fail-closed read) → `suppressed`: dropped
 *    with a MOOS_RELAY_SUPPRESSED audit. Not a failure, not retried — the
 *    legacy agent owns the conversation.
 *  - worker 2xx → `delivered`.
 *  - worker non-2xx / network error → retried with backoff, up to
 *    MOOS_RELAY_OUTBOX_MAX_ATTEMPTS; then `dead_letter` + a
 *    MOOS_RELAY_DEAD_LETTER audit (the human alert — staff triage from the
 *    CRM audit log).
 *
 * This outbox is for the CRM→worker RELAY only. It never retries an outbound
 * WhatsApp send whose Meta outcome is unknown — those stay single-attempt
 * by design (see server/moos/moosRouter.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import {
  deliverRelayEvent,
  moosRelayEnabled,
  type MoosRelayEvent,
} from "./moosRelay.ts";

export const MOOS_RELAY_OUTBOX_MAX_ATTEMPTS = 5;
/** Backoff after attempts 1..4 (the 5th failure dead-letters). */
export const MOOS_RELAY_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000];

export type MoosRelayOutboxStatus =
  | "queued"
  | "delivered"
  | "suppressed"
  | "dead_letter";

export type MoosRelayOutboxRow = MoosRelayEvent & {
  attempts: number;
  /** Epoch millis when the next delivery attempt may run. */
  nextAttemptAt: number;
  status: MoosRelayOutboxStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MoosRelayOutboxEnqueueResult = {
  enqueued: boolean;
  duplicate: boolean;
};

export interface MoosRelayOutboxStore {
  enqueue(event: MoosRelayEvent): Promise<MoosRelayOutboxEnqueueResult>;
  /** Rows due for delivery, oldest first. Single-drainer assumption. */
  claimDue(now: number, limit: number): Promise<MoosRelayOutboxRow[]>;
  markDelivered(wamid: string, now: number): Promise<void>;
  markSuppressed(wamid: string, now: number, reason: string): Promise<void>;
  markFailed(
    wamid: string,
    nextAttemptAt: number,
    now: number,
    error: string
  ): Promise<void>;
  markDeadLetter(wamid: string, now: number, error: string): Promise<void>;
  get(wamid: string): Promise<MoosRelayOutboxRow | null>;
}

export class InMemoryMoosRelayOutboxStore implements MoosRelayOutboxStore {
  private readonly rows = new Map<string, MoosRelayOutboxRow>();

  async enqueue(event: MoosRelayEvent): Promise<MoosRelayOutboxEnqueueResult> {
    if (this.rows.has(event.messageId)) return { enqueued: false, duplicate: true };
    const now = Date.now();
    this.rows.set(event.messageId, {
      ...event,
      attempts: 0,
      nextAttemptAt: now,
      status: "queued",
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    return { enqueued: true, duplicate: false };
  }

  async claimDue(now: number, limit: number): Promise<MoosRelayOutboxRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === "queued" && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, Math.max(1, limit));
  }

  private touch(wamid: string, patch: Partial<MoosRelayOutboxRow>, now: number): void {
    const row = this.rows.get(wamid);
    if (!row) return;
    this.rows.set(wamid, { ...row, ...patch, updatedAt: now });
  }

  async markDelivered(wamid: string, now: number): Promise<void> {
    this.touch(wamid, { status: "delivered", lastError: null }, now);
  }

  async markSuppressed(wamid: string, now: number, reason: string): Promise<void> {
    this.touch(wamid, { status: "suppressed", lastError: reason }, now);
  }

  async markFailed(
    wamid: string,
    nextAttemptAt: number,
    now: number,
    error: string
  ): Promise<void> {
    const row = this.rows.get(wamid);
    if (!row) return;
    this.touch(
      wamid,
      { attempts: row.attempts + 1, nextAttemptAt, lastError: error },
      now
    );
  }

  async markDeadLetter(wamid: string, now: number, error: string): Promise<void> {
    const row = this.rows.get(wamid);
    if (!row) return;
    this.touch(
      wamid,
      { status: "dead_letter", attempts: row.attempts + 1, lastError: error },
      now
    );
  }

  async get(wamid: string): Promise<MoosRelayOutboxRow | null> {
    return this.rows.get(wamid) ?? null;
  }
}

type OutboxDbRow = {
  wamid: string;
  company_id: string;
  conversation_id: string;
  phone: string;
  phone_number_id: string;
  type: string;
  text: string;
  sent_at: number;
  attempts: number;
  next_attempt_at: string;
  status: MoosRelayOutboxStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapOutboxRow(r: OutboxDbRow): MoosRelayOutboxRow {
  return {
    messageId: r.wamid,
    conversationId: r.conversation_id,
    phone: r.phone,
    phoneNumberId: r.phone_number_id,
    type: r.type,
    text: r.text,
    sentAt: Number(r.sent_at),
    attempts: Number(r.attempts),
    nextAttemptAt: Date.parse(r.next_attempt_at),
    status: r.status,
    lastError: r.last_error,
    createdAt: Date.parse(r.created_at),
    updatedAt: Date.parse(r.updated_at),
  };
}

/**
 * Production Supabase backing store. Requires the `moos_relay_outbox` table
 * (see scripts/moos-relay-outbox-schema.sql). Follows the existing
 * SupabaseWhatsAppInbox* repository pattern.
 */
export class SupabaseMoosRelayOutboxStore implements MoosRelayOutboxStore {
  constructor(
    private readonly clientFactory: () => SupabaseClient | null = getSupabase,
    private readonly companyId: string = "sunchaser"
  ) {}

  private client(): SupabaseClient {
    const c = this.clientFactory();
    if (!c) throw new Error("Supabase is not active for the Moos relay outbox.");
    return c;
  }

  async enqueue(event: MoosRelayEvent): Promise<MoosRelayOutboxEnqueueResult> {
    const { error } = await this.client()
      .from("moos_relay_outbox")
      .insert({
        wamid: event.messageId,
        company_id: this.companyId,
        conversation_id: event.conversationId,
        phone: event.phone,
        phone_number_id: event.phoneNumberId,
        type: event.type,
        text: event.text,
        sent_at: event.sentAt,
      });
    if (!error) return { enqueued: true, duplicate: false };
    // Unique-violation on wamid → already queued (idempotent enqueue).
    if (String((error as { code?: string }).code) === "23505") {
      return { enqueued: false, duplicate: true };
    }
    throw new Error(`Outbox enqueue failed: ${error.message}`);
  }

  async claimDue(now: number, limit: number): Promise<MoosRelayOutboxRow[]> {
    const { data, error } = await this.client()
      .from("moos_relay_outbox")
      .select("*")
      .eq("company_id", this.companyId)
      .eq("status", "queued")
      .lte("next_attempt_at", new Date(now).toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(Math.max(1, limit));
    if (error) throw new Error(`Outbox claimDue failed: ${error.message}`);
    return (data as OutboxDbRow[]).map(mapOutboxRow);
  }

  private async update(
    wamid: string,
    patch: Partial<OutboxDbRow>
  ): Promise<void> {
    const { error } = await this.client()
      .from("moos_relay_outbox")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("company_id", this.companyId)
      .eq("wamid", wamid);
    if (error) throw new Error(`Outbox update failed: ${error.message}`);
  }

  async markDelivered(wamid: string): Promise<void> {
    await this.update(wamid, { status: "delivered", last_error: null });
  }

  async markSuppressed(wamid: string, _now: number, reason: string): Promise<void> {
    await this.update(wamid, { status: "suppressed", last_error: reason });
  }

  async markFailed(
    wamid: string,
    nextAttemptAt: number,
    _now: number,
    error: string
  ): Promise<void> {
    const row = await this.get(wamid);
    await this.update(wamid, {
      attempts: (row?.attempts ?? 0) + 1,
      next_attempt_at: new Date(nextAttemptAt).toISOString(),
      last_error: error.slice(0, 500),
    });
  }

  async markDeadLetter(wamid: string, _now: number, error: string): Promise<void> {
    const row = await this.get(wamid);
    await this.update(wamid, {
      status: "dead_letter",
      attempts: (row?.attempts ?? 0) + 1,
      last_error: error.slice(0, 500),
    });
  }

  async get(wamid: string): Promise<MoosRelayOutboxRow | null> {
    const { data, error } = await this.client()
      .from("moos_relay_outbox")
      .select("*")
      .eq("company_id", this.companyId)
      .eq("wamid", wamid)
      .maybeSingle();
    if (error) throw new Error(`Outbox get failed: ${error.message}`);
    return data ? mapOutboxRow(data as OutboxDbRow) : null;
  }
}

let defaultStore: MoosRelayOutboxStore | null = null;
/** Production default: Supabase when active, otherwise in-memory. */
export function getDefaultMoosRelayOutboxStore(): MoosRelayOutboxStore {
  if (!defaultStore) {
    defaultStore =
      isSupabaseActive() && getSupabase()
        ? new SupabaseMoosRelayOutboxStore()
        : new InMemoryMoosRelayOutboxStore();
  }
  return defaultStore;
}
/** Test seam. */
export function setDefaultMoosRelayOutboxStoreForTests(
  store: MoosRelayOutboxStore | null
): void {
  defaultStore = store;
}

export type MoosRelayDrainDeps = {
  store: MoosRelayOutboxStore;
  env: NodeJS.ProcessEnv;
  loadSettings?: () => Promise<{ settings: { enabled: boolean } }>;
  fetchImpl?: typeof fetch;
  /** Human-visible alert sink (dead-letter + suppression audits). */
  audit?: (
    eventType: string,
    entityId: string,
    metadata: Record<string, unknown>
  ) => Promise<void>;
  now?: () => number;
  batchLimit?: number;
};

export type MoosRelayDrainReport = {
  delivered: number;
  suppressed: number;
  retried: number;
  deadLettered: number;
  skipped: boolean;
};

function toEvent(row: MoosRelayOutboxRow): MoosRelayEvent {
  return {
    conversationId: row.conversationId,
    messageId: row.messageId,
    phone: row.phone,
    phoneNumberId: row.phoneNumberId,
    type: row.type,
    text: row.text,
    sentAt: row.sentAt,
  };
}

/**
 * Deliver due outbox events. Never throws for per-event failures (they are
 * retried or dead-lettered); throws only when the store itself is unusable.
 */
export async function drainMoosRelayOutbox(
  deps: MoosRelayDrainDeps
): Promise<MoosRelayDrainReport> {
  const report: MoosRelayDrainReport = {
    delivered: 0,
    suppressed: 0,
    retried: 0,
    deadLettered: 0,
    skipped: false,
  };
  const now = deps.now ?? Date.now;
  if (!moosRelayEnabled(deps.env)) {
    report.skipped = true;
    return report;
  }
  const audit =
    deps.audit ??
    (async () => {
      /* no alert sink configured */
    });
  const due = await deps.store.claimDue(now(), deps.batchLimit ?? 25);
  for (const row of due) {
    const result = await deliverRelayEvent(deps.env, toEvent(row), {
      loadSettings: deps.loadSettings,
      fetchImpl: deps.fetchImpl,
    });
    if (result.status === "delivered") {
      await deps.store.markDelivered(row.messageId, now());
      report.delivered += 1;
      continue;
    }
    if (result.status === "suppressed") {
      await deps.store.markSuppressed(row.messageId, now(), result.reason);
      await audit("MOOS_RELAY_SUPPRESSED", row.conversationId, {
        wamid: row.messageId,
        reason: result.reason,
        via: "outbox_drain",
      });
      report.suppressed += 1;
      continue;
    }
    if (result.status === "disabled") {
      // Relay was disabled between the drain check and delivery; leave the
      // row queued for the next enabled drain.
      continue;
    }
    const attempts = row.attempts + 1;
    const reason = result.reason || "forward_failed";
    if (attempts >= MOOS_RELAY_OUTBOX_MAX_ATTEMPTS) {
      await deps.store.markDeadLetter(row.messageId, now(), reason);
      await audit("MOOS_RELAY_DEAD_LETTER", row.conversationId, {
        wamid: row.messageId,
        attempts,
        error: reason,
        textPreview: row.text.slice(0, 200),
      });
      console.error(
        `[moos-relay-outbox] dead-lettered wamid ${row.messageId} after ${attempts} attempts: ${reason}`
      );
      report.deadLettered += 1;
    } else {
      const delay =
        MOOS_RELAY_RETRY_DELAYS_MS[
          Math.min(attempts - 1, MOOS_RELAY_RETRY_DELAYS_MS.length - 1)
        ];
      await deps.store.markFailed(row.messageId, now() + delay, now(), reason);
      report.retried += 1;
    }
  }
  return report;
}
