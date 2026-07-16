import {
  AUDIT_EVENTS,
  MESSAGE_STATUSES,
  WHATSAPP_MAX_TEXT_LENGTH,
  WHATSAPP_OUTBOUND_DB_RETRY_ATTEMPTS,
  WHATSAPP_OUTBOUND_DB_RETRY_DELAY_MS,
} from "./whatsappConstants.ts";
import type { WhatsAppConfig } from "./whatsappConfig.ts";
import { sendWhatsAppTextMessage } from "./whatsappGraphClient.ts";
import type { WhatsAppRepository } from "./whatsappRepository.ts";
import { safeAudit } from "./whatsappRepository.ts";

export type OutboundSendDeps = {
  repo: WhatsAppRepository;
  config: WhatsAppConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type OutboundSendResult =
  | {
      httpStatus: 201;
      messageId: string;
      providerMessageId: string;
      status: "sent";
    }
  | {
      httpStatus: 400 | 404 | 503 | 500 | 502 | 504 | 202;
      messageId?: string;
      providerMessageId?: string;
      status?: string;
      error: string;
    };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateStatusWithRetry(
  deps: OutboundSendDeps,
  input: {
    messageId: string;
    status: string;
    waMessageId?: string | null;
    providerError?: string | null;
    sentAt?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sleep = deps.sleep ?? defaultSleep;
  let lastError = "status update failed";
  for (let attempt = 1; attempt <= WHATSAPP_OUTBOUND_DB_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await deps.repo.updateMessageStatus(input);
      return { ok: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "status update failed";
      if (attempt < WHATSAPP_OUTBOUND_DB_RETRY_ATTEMPTS) {
        await sleep(WHATSAPP_OUTBOUND_DB_RETRY_DELAY_MS);
      }
    }
  }
  return { ok: false, error: lastError };
}

export async function sendOutboundPlainText(
  conversationId: string,
  rawText: unknown,
  deps: OutboundSendDeps
): Promise<OutboundSendResult> {
  if (!deps.config.enabled) {
    return { httpStatus: 404, error: "Not found" };
  }
  if (!deps.repo.isActive()) {
    return { httpStatus: 503, error: "WhatsApp persistence unavailable" };
  }
  if (
    !deps.config.accessToken ||
    !deps.config.phoneNumberId ||
    !deps.config.graphApiVersion
  ) {
    return { httpStatus: 503, error: "WhatsApp send configuration incomplete" };
  }

  const text = String(rawText ?? "").trim();
  if (!text) {
    return { httpStatus: 400, error: "text is required" };
  }
  if (text.length > WHATSAPP_MAX_TEXT_LENGTH) {
    return {
      httpStatus: 400,
      error: `text exceeds maximum length of ${WHATSAPP_MAX_TEXT_LENGTH}`,
    };
  }

  const bundle = await deps.repo.getConversationBundle(conversationId);
  if (!bundle) {
    return { httpStatus: 404, error: "Conversation not found" };
  }

  if (bundle.channel.phoneNumberId !== deps.config.phoneNumberId) {
    await safeAudit(deps.repo, {
      eventType: AUDIT_EVENTS.OUTBOUND_FAILED,
      entityType: "conversation",
      entityId: conversationId,
      metadata: { reason: "channel_sender_mismatch" },
    });
    return {
      httpStatus: 503,
      error: "Configured WhatsApp sender does not match conversation channel",
    };
  }

  let message;
  try {
    message = await deps.repo.insertOutboundMessage({
      conversationId,
      textBody: text,
    });
  } catch {
    return { httpStatus: 500, error: "Failed to queue outbound message" };
  }

  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_QUEUED,
    entityType: "message",
    entityId: message.id,
    metadata: { conversationId },
  });

  try {
    await deps.repo.updateMessageStatus({
      messageId: message.id,
      status: MESSAGE_STATUSES.SENDING,
    });
  } catch {
    return {
      httpStatus: 500,
      messageId: message.id,
      status: MESSAGE_STATUSES.QUEUED,
      error: "Failed to transition message to sending",
    };
  }

  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_SENDING,
    entityType: "message",
    entityId: message.id,
    metadata: { conversationId },
  });

  const graphResult = await sendWhatsAppTextMessage({
    toWaId: bundle.contact.phoneE164,
    text,
    phoneNumberId: deps.config.phoneNumberId,
    accessToken: deps.config.accessToken,
    graphApiVersion: deps.config.graphApiVersion,
    fetchImpl: deps.fetchImpl,
  });

  if (graphResult.ok === true) {
    const providerMessageId = graphResult.providerMessageId;
    const sentAt = new Date().toISOString();
    const statusUpdate = await updateStatusWithRetry(deps, {
      messageId: message.id,
      status: MESSAGE_STATUSES.SENT,
      waMessageId: providerMessageId,
      sentAt,
      providerError: null,
    });

    if (statusUpdate.ok === false) {
      console.error(
        "[whatsapp-transport] Meta accepted message but DB status update failed",
        {
          messageId: message.id,
          providerMessageId,
          error: statusUpdate.error,
        }
      );
      await safeAudit(deps.repo, {
        eventType: AUDIT_EVENTS.OUTBOUND_SENT,
        entityType: "message",
        entityId: message.id,
        metadata: {
          conversationId,
          providerMessageId,
          degraded: true,
          persistError: statusUpdate.error,
        },
      });
      return {
        httpStatus: 202,
        messageId: message.id,
        providerMessageId,
        status: MESSAGE_STATUSES.SENDING,
        error: "Message accepted by provider; local status persistence degraded",
      };
    }

    await deps.repo.updateConversationLastMessageAt(conversationId, sentAt);
    await safeAudit(deps.repo, {
      eventType: AUDIT_EVENTS.OUTBOUND_SENT,
      entityType: "message",
      entityId: message.id,
      metadata: {
        conversationId,
        providerMessageId,
      },
    });

    return {
      httpStatus: 201,
      messageId: message.id,
      providerMessageId,
      status: "sent",
    };
  }

  const failure = graphResult;
  if (failure.kind === "timeout") {
    await updateStatusWithRetry(deps, {
      messageId: message.id,
      status: MESSAGE_STATUSES.TIMEOUT,
      providerError: failure.sanitizedError,
    });
    await safeAudit(deps.repo, {
      eventType: AUDIT_EVENTS.OUTBOUND_TIMEOUT,
      entityType: "message",
      entityId: message.id,
      metadata: { conversationId },
    });
    return {
      httpStatus: 504,
      messageId: message.id,
      status: MESSAGE_STATUSES.TIMEOUT,
      error: failure.sanitizedError,
    };
  }

  await updateStatusWithRetry(deps, {
    messageId: message.id,
    status: MESSAGE_STATUSES.FAILED,
    providerError: failure.sanitizedError,
  });
  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_FAILED,
    entityType: "message",
    entityId: message.id,
    metadata: {
      conversationId,
      httpStatus: failure.httpStatus,
    },
  });
  return {
    httpStatus: 502,
    messageId: message.id,
    status: MESSAGE_STATUSES.FAILED,
    error: failure.sanitizedError,
  };
}
