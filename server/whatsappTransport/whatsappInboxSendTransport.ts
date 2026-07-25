/**
 * Production outbound transport adapter for POST /api/inbox/messages/send.
 * Routes WhatsApp Web QR channel conversations to Baileys; otherwise Meta Cloud API.
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
import { readWhatsAppWebConfig } from "../whatsappWeb/whatsappWebConfig.ts";
import {
  getSharedWhatsAppWebSession,
  type WhatsAppWebSession,
} from "../whatsappWeb/whatsappWebSession.ts";
import {
  isWhatsAppWebQrChannel,
  sendWhatsAppWebPlainText,
} from "../whatsappWeb/whatsappWebOutbound.ts";

export type InboxSendTransportDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  messagingRepository?: MessagingRepository | null;
  /** Test seam for WhatsApp Web session. */
  whatsappWebSession?: WhatsAppWebSession;
};

function isOutboundSuccess(
  result: OutboundSendResult
): result is Extract<OutboundSendResult, { httpStatus: 201 }> {
  return result.httpStatus === 201;
}

/**
 * Returns a send port when Meta outbound is configured and/or WhatsApp Web QR
 * is enabled; otherwise null (caller must disable the send endpoint).
 */
export function createInboxOutboundSendPort(
  deps: InboxSendTransportDeps = {}
): InboxSendPort | null {
  const env = deps.env ?? process.env;
  const config = deps.config ?? readWhatsAppConfig(env);
  const webConfig = readWhatsAppWebConfig(env);
  const metaReady = isWhatsAppEnabled(config) && hasOutboundSendConfig(config);
  const webReady = webConfig.enabled === true;
  if (!metaReady && !webReady) {
    return null;
  }

  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  const fetchImpl = deps.fetchImpl;
  const messagingRepository = deps.messagingRepository;
  const session = deps.whatsappWebSession ?? getSharedWhatsAppWebSession({ env });

  return async (input: {
    conversationId: string;
    text: string;
    actor: RequestActor;
  }) => {
    const bundle = await repo.getConversationBundle(input.conversationId);
    const useWeb =
      webReady &&
      bundle != null &&
      isWhatsAppWebQrChannel(bundle.channel.phoneNumberId);

    const result = useWeb
      ? await sendWhatsAppWebPlainText(input.conversationId, input.text, {
          repo,
          session,
          actor: input.actor,
          messagingRepository,
        })
      : metaReady
        ? await sendOutboundPlainText(input.conversationId, input.text, {
            repo,
            config,
            actor: input.actor,
            fetchImpl,
            messagingRepository,
          })
        : ({
            httpStatus: 503 as const,
            error: "No WhatsApp outbound transport is available",
          } satisfies OutboundSendResult);

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
