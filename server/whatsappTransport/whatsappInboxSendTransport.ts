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
import { sendOutboundPlainText } from "./whatsappOutboundService.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";

export type InboxSendTransportDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

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
      }
    );
    if (result.httpStatus === 201 && result.messageId) {
      return { ok: true, messageId: result.messageId };
    }
    const permanent =
      result.httpStatus >= 400 &&
      result.httpStatus < 500 &&
      result.httpStatus !== 408;
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
