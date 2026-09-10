/**
 * Production outbound transport adapter for POST /api/inbox/messages/send.
 * Meta WhatsApp Cloud API only — no unofficial WhatsApp Web transport.
 */
import type { RequestActor } from "../middleware/actor.ts";
import {
  isValidGraphApiVersion,
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
 * Returns a send port when Meta outbound is available; otherwise null (caller
 * must disable the send endpoint).
 *
 * Credentials are NOT required here. They come from the Meta Embedded Signup
 * connection and are resolved per send, so an account connected after boot can
 * send without a restart. Sends without usable credentials fail closed with 503.
 */
export function createInboxOutboundSendPort(
  deps: InboxSendTransportDeps = {}
): InboxSendPort | null {
  const env = deps.env ?? process.env;
  const config = deps.config ?? readWhatsAppConfig(env);
  const metaReady =
    isWhatsAppEnabled(config) && isValidGraphApiVersion(config.graphApiVersion);
  if (!metaReady) {
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
    const result = await sendOutboundPlainText(input.conversationId, input.text, {
      repo,
      config,
      actor: input.actor,
      fetchImpl,
      messagingRepository,
      env,
    });

    if (isOutboundSuccess(result)) {
      return { ok: true, messageId: result.messageId };
    }
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
