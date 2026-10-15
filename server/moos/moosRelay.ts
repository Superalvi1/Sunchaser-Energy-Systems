/**
 * Moos WhatsApp agent — signed inbound relay.
 *
 * Called AFTER an inbound text message has been verified, recorded and
 * deduplicated. Forwards a normalized event to the separate Moos worker via
 * HMAC-signed POST.
 *
 * Two delivery paths exist:
 *  - Direct: `deliverRelayEvent` — HMAC POST with a fresh, fail-closed
 *    legacy-agent check. Used by the durable outbox drain.
 *  - Durable: `server/moos/moosRelayOutbox.ts` — the webhook enqueues the
 *    event (unique wamid) and a periodic drain delivers it with bounded
 *    retry/backoff and dead-letter alerting, so a worker outage cannot
 *    silently lose the event while the WhatsApp webhook returns 200.
 *
 * Mutual exclusion with the legacy CRM AI sales agent: Moos must never answer
 * a conversation the legacy agent is enabled for. The legacy switch
 * (`whatsapp-agent/settings.json → enabled`) wins ties.
 */
import { createHmac } from "node:crypto";
import { loadAgentSettings } from "../whatsappAgent/agentSettings.ts";

export type MoosRelayEvent = {
  /** CRM conversation id (for ownership/handoff/outbound-log callbacks). */
  conversationId: string;
  /** Meta wamid of the inbound message. */
  messageId: string;
  /** Customer phone in CRM canonical form (phoneE164). */
  phone: string;
  /** Meta phone_number_id that received the message. */
  phoneNumberId: string;
  /** Normalized message type ("text" for the relayed path). */
  type: string;
  /** Message text (already length-capped by the webhook). */
  text: string;
  /** Inbound timestamp, epoch millis. */
  sentAt: number;
};

export function moosRelayEnabled(env: NodeJS.ProcessEnv): boolean {
  return /^(true|1|yes)$/i.test(String(env.MOOS_RELAY_ENABLED || ""));
}

export function moosRelaySignature(body: string, secret: string): string {
  return (
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex")
  );
}

/**
 * Fresh legacy-agent read — no cache. Used at send/delivery boundaries where
 * a stale 30s read is not an acceptable guarantee. Fail closed: when the
 * settings cannot be read we cannot prove the legacy agent is off, so Moos
 * yields the conversation.
 */
export async function isLegacyAiEnabledFresh(
  loadSettings: () => Promise<{ settings: { enabled: boolean } }> = loadAgentSettings
): Promise<boolean> {
  try {
    const { settings } = await loadSettings();
    return settings.enabled === true;
  } catch {
    return true;
  }
}

/**
 * Cached legacy-agent read (30s) for the hot inbound path. Fail closed on
 * read errors (cached as enabled).
 */
let legacyAiCache: { at: number; enabled: boolean } | null = null;
export async function isLegacyAiEnabled(
  loadSettings: () => Promise<{ settings: { enabled: boolean } }> = loadAgentSettings
): Promise<boolean> {
  if (legacyAiCache && Date.now() - legacyAiCache.at < 30000) return legacyAiCache.enabled;
  const enabled = await isLegacyAiEnabledFresh(loadSettings);
  legacyAiCache = { at: Date.now(), enabled };
  return enabled;
}

/** Test seam: clear the isLegacyAiEnabled cache. */
export function resetMoosRelayCacheForTests(): void {
  legacyAiCache = null;
}

export type MoosRelayResult =
  | { status: "delivered" }
  | { status: "suppressed"; reason: "legacy_ai_enabled" }
  | { status: "failed"; reason: string }
  | { status: "disabled"; reason: "relay_disabled" };

export type MoosRelayDeliverOptions = {
  /** Override the settings loader (tests). */
  loadSettings?: () => Promise<{ settings: { enabled: boolean } }>;
  /** fetch implementation for the worker POST (tests). */
  fetchImpl?: typeof fetch;
  /** Skip the legacy-agent check (tests that target the POST layer only). */
  skipLegacyCheck?: boolean;
};

/** Raw HMAC-signed POST to the worker. No legacy-agent check — callers decide. */
export async function postRelayEventToWorker(
  env: NodeJS.ProcessEnv,
  event: MoosRelayEvent,
  fetchImpl: typeof fetch = fetch
): Promise<{ delivered: boolean; reason?: string }> {
  const base = String(env.MOOS_WORKER_URL || "").replace(/\/$/, "");
  const secret = String(env.RELAY_SECRET || "");
  if (!base || !secret) {
    return { delivered: false, reason: "worker_not_configured" };
  }
  const body = JSON.stringify(event);
  try {
    const res = await fetchImpl(`${base}/webhooks/crm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Signature-256": moosRelaySignature(body, secret),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { delivered: false, reason: `worker_status_${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    return {
      delivered: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : "fetch_failed",
    };
  }
}

/**
 * Deliver one relay event: disabled → disabled; legacy AI on → suppressed
 * (not a failure, not retried — the legacy agent owns the conversation);
 * otherwise HMAC POST → delivered / failed.
 */
export async function deliverRelayEvent(
  env: NodeJS.ProcessEnv,
  event: MoosRelayEvent,
  opts: MoosRelayDeliverOptions = {}
): Promise<MoosRelayResult> {
  if (!moosRelayEnabled(env)) {
    return { status: "disabled", reason: "relay_disabled" };
  }
  if (!opts.skipLegacyCheck && (await isLegacyAiEnabledFresh(opts.loadSettings))) {
    console.warn(
      "[moos-relay] suppressed: legacy WhatsApp AI agent is enabled; Moos yields the conversation"
    );
    return { status: "suppressed", reason: "legacy_ai_enabled" };
  }
  const posted = await postRelayEventToWorker(env, event, opts.fetchImpl ?? fetch);
  if (posted.delivered) return { status: "delivered" };
  console.error(`[moos-relay] forward failed: ${posted.reason}; event held for retry`);
  return { status: "failed", reason: posted.reason || "forward_failed" };
}

/**
 * Legacy direct-relay entry point (kept for tests/consumers). Prefer the
 * durable outbox (`moosRelayOutbox.ts`) in production: it survives worker
 * outages with bounded retry/backoff and dead-letter alerting.
 */
export async function relayInboundToMoos(
  env: NodeJS.ProcessEnv,
  event: MoosRelayEvent,
  opts: MoosRelayDeliverOptions = {}
): Promise<MoosRelayResult> {
  return deliverRelayEvent(env, event, opts);
}
