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
import type {
  InboxSendPort,
  InboxTemplateCatalogPort,
  InboxTemplateSendPort,
} from "./whatsappInboxControllers.ts";
import {
  sendOutboundPlainText,
  sendOutboundTemplate,
  type OutboundSendResult,
} from "./whatsappOutboundService.ts";
import { getWhatsAppConnectionRepository } from "./whatsappConnectionService.ts";
import { resolveCompanyId } from "./whatsappConstants.ts";
import { WhatsAppTemplateCatalog } from "./whatsappTemplateCatalog.ts";
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

function toPortResult(result: OutboundSendResult) {
  if (isOutboundSuccess(result)) {
    return { ok: true as const, messageId: result.messageId };
  }
  const status = result.httpStatus as number;
  const permanent = status >= 400 && status < 500 && status !== 408;
  return {
    ok: false as const,
    error: result.error || "outbound_send_failed",
    permanent,
  };
}

/**
 * Production template send port. Same readiness gate and credential policy as
 * the text port; returns null when Meta outbound is unavailable.
 */
export function createInboxTemplateSendPort(
  deps: InboxSendTransportDeps = {}
): InboxTemplateSendPort | null {
  const env = deps.env ?? process.env;
  const config = deps.config ?? readWhatsAppConfig(env);
  if (!isWhatsAppEnabled(config) || !isValidGraphApiVersion(config.graphApiVersion)) {
    return null;
  }
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  return async (input) =>
    toPortResult(
      await sendOutboundTemplate(
        input.conversationId,
        {
          templateName: input.templateName,
          languageCode: input.languageCode,
          components: input.components,
          previewText: input.previewText,
        },
        {
          repo,
          config,
          actor: input.actor,
          fetchImpl: deps.fetchImpl,
          messagingRepository: deps.messagingRepository,
          env,
        }
      )
    );
}

/** Production template catalog; null when WhatsApp is disabled. */
export function createInboxTemplateCatalog(
  deps: Pick<InboxSendTransportDeps, "config" | "env" | "fetchImpl"> = {}
): InboxTemplateCatalogPort | null {
  const env = deps.env ?? process.env;
  const config = deps.config ?? readWhatsAppConfig(env);
  if (!isWhatsAppEnabled(config)) return null;
  return new WhatsAppTemplateCatalog({
    config,
    connectionLookup: getWhatsAppConnectionRepository(),
    companyId: resolveCompanyId(undefined),
    env,
    fetchImpl: deps.fetchImpl,
  });
}
