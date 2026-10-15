/**
 * Moos WhatsApp agent — signed inbound relay.
 *
 * Called by the CRM WhatsApp webhook AFTER an inbound text message has been
 * verified, recorded and deduplicated. Forwards a normalized event to the
 * separate Moos worker via HMAC-signed POST. Fire-and-forget: relay failures
 * are logged and audited by the caller but never block the webhook 200.
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

function relayEnabled(env: NodeJS.ProcessEnv): boolean {
  return /^(true|1|yes)$/i.test(String(env.MOOS_RELAY_ENABLED || ""));
}

export function moosRelaySignature(body: string, secret: string): string {
  return (
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex")
  );
}

/**
 * Mutual exclusion with the legacy CRM AI sales agent: Moos must never answer
 * a conversation the legacy agent is enabled for. The legacy switch
 * (`whatsapp-agent/settings.json → enabled`) wins ties — when it is on, the
 * relay stays silent so the two agents cannot simultaneously reply.
 *
 * Cached for 30s so the webhook does not hit object storage per message.
 */
let legacyAiCache: { at: number; enabled: boolean } | null = null;
export async function isLegacyAiEnabled(
  loadSettings: () => Promise<{ settings: { enabled: boolean } }> = loadAgentSettings
): Promise<boolean> {
  if (legacyAiCache && Date.now() - legacyAiCache.at < 30000) return legacyAiCache.enabled;
  try {
    const { settings } = await loadSettings();
    legacyAiCache = { at: Date.now(), enabled: settings.enabled === true };
  } catch {
    // Fail closed: if settings cannot be read we cannot prove the legacy
    // agent is off, so Moos does not take the conversation.
    legacyAiCache = { at: Date.now(), enabled: true };
  }
  return legacyAiCache.enabled;
}

/** Test seam: clear the isLegacyAiEnabled cache. */
export function resetMoosRelayCacheForTests(): void {
  legacyAiCache = null;
}

export type MoosRelayOptions = {
  /** Override the settings loader (tests). */
  loadSettings?: () => Promise<{ settings: { enabled: boolean } }>;
  /** fetch implementation for the worker POST (tests). */
  fetchImpl?: typeof fetch;
  /** Called when the relay is suppressed by mutual exclusion (webhook audits). */
  onSuppressed?: (reason: "legacy_ai_enabled") => void;
};

export async function relayInboundToMoos(
  env: NodeJS.ProcessEnv,
  event: MoosRelayEvent,
  opts: MoosRelayOptions = {}
): Promise<boolean> {
  if (!relayEnabled(env)) return false;
  if (await isLegacyAiEnabled(opts.loadSettings)) {
    console.warn(
      "[moos-relay] suppressed: legacy WhatsApp AI agent is enabled; Moos yields the conversation"
    );
    opts.onSuppressed?.("legacy_ai_enabled");
    return false;
  }
  const base = String(env.MOOS_WORKER_URL || "").replace(/\/$/, "");
  const secret = String(env.RELAY_SECRET || "");
  if (!base || !secret) {
    console.error("[moos-relay] MOOS_WORKER_URL or RELAY_SECRET not set; skipping relay");
    return false;
  }
  const body = JSON.stringify(event);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${base}/webhooks/crm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Signature-256": moosRelaySignature(body, secret),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[moos-relay] worker responded ${res.status}; event held for retry`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[moos-relay] forward failed:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
