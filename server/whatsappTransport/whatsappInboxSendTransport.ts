/**
 * Production outbound transport adapter for POST /api/inbox/messages/send.
 * Wraps PR1 sendOutboundPlainText — no inbox business rules.
 */
import type { RequestActor } from "../middleware/actor.ts";
import {
  hasOutboundSendConfig,
  isWhatsAppEnabled,
  readWhatsAppConfig,
  type WhatsAppConfig,
} from "./whatsappConfig.ts";
import type { InboxSendPort } from "./whatsappInboxControllers.ts";
import {
  sendOutboundPlainText,
  type OutboundSendResult,
} from "./whatsappOutboundService.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";

export type InboxSendTransportDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  messagingRepository?: MessagingRepository | null;
};

function isOutboundSuccess(
  result: OutboundSendResult
): result is Extract<OutboundSendResult, { httpStatus: 201 }> {
  return result.httpStatus === 201;
}

/**
 * Returns a send port when WhatsApp outbound is enabled and configured;
 * otherwise null (caller must disable the send endpoint).
 */
export function createInboxOutboundSendPort(
  deps: InboxSendTransportDeps = {}
): InboxSendPort | null {
  const config = deps.config ?? readWhatsAppConfig(deps.env ?? process.env);
  if (!isWhatsAppEnabled(config) || !hasOutboundSendConfig(config)) {
    return null;
  }
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  const fetchImpl = deps.fetchImpl;
  const messagingRepository = deps.messagingRepository;

  return async (input: {
    conversationId: string;
    text: string;
    actor: RequestActor;
  }) => {
    const result = await sendOutboundPlainText(
      input.conversationId,
      input.text,
      {
        repo,
        config,
        actor: input.actor,
        fetchImpl,
        messagingRepository,
      }
    );
    if (isOutboundSuccess(result)) {
      return { ok: true, messageId: result.messageId };
    }
    // Treat classic client errors as permanent; keep timeouts/retryables soft.
    // 408 is not in OutboundSendResult today; guard via numeric status for safety.
    const status = result.httpStatus as number;
    const permanent = status >= 400 && status < 500 && status !== 408;
    return {
      ok: false,
      error: result.error || "outbound_send_failed",
      permanent,
    };
  };
}

export function isInboxSendTransportReady(
  deps: InboxSendTransportDeps = {}
): boolean {
  return createInboxOutboundSendPort(deps) !== null;
}
