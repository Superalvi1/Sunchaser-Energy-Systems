import type { RequestActor } from "../middleware/actor.ts";
import {
  AUDIT_EVENTS,
  MESSAGE_STATUSES,
  WHATSAPP_MAX_TEXT_LENGTH,
  WHATSAPP_OUTBOUND_DB_RETRY_ATTEMPTS,
  WHATSAPP_OUTBOUND_DB_RETRY_DELAY_MS,
} from "./whatsappConstants.ts";
import { hasOutboundSendConfig, type WhatsAppConfig } from "./whatsappConfig.ts";
import { sendWhatsAppTextMessage } from "./whatsappGraphClient.ts";
import {
  authorizeOutboundWhatsAppActor,
  canSendOutboundWhatsApp,
} from "./whatsappPermissions.ts";
import type { WhatsAppRepository } from "./whatsappRepository.ts";
import { safeAudit } from "./whatsappRepository.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";
import { isMessagingRepositoryError } from "../unifiedMessaging/messagingRepositoryErrors.ts";
import {
  bridgeClaimOutboundSend,
  bridgeInboxCompatibleMessageId,
  bridgePrepareOutboundMessage,
  bridgeProviderMessageId,
  bridgeRecordOutboundProviderResult,
  createWhatsAppMessagingBridge,
} from "./whatsappMessagingBridge.ts";
import { randomUUID } from "node:crypto";

export type OutboundSendDeps = {
  repo: WhatsAppRepository;
  config: WhatsAppConfig;
  actor: RequestActor | null | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Normalized messaging repository (Task 5B). When set, gates Meta via client idempotency. */
  messagingRepository?: MessagingRepository | null;
  /** Stable client idempotency key; generated when missing and messaging is enabled. */
  clientIdempotencyKey?: string | null;
};

export type OutboundSendResult =
  | {
      httpStatus: 201;
      messageId: string;
      providerMessageId: string;
      status: "sent";
    }
  | {
      httpStatus: 400 | 401 | 403 | 404 | 409 | 503 | 500 | 502 | 504 | 202;
      messageId?: string;
      providerMessageId?: string;
      status?: string;
      /** Present when local status persistence did not complete after a provider outcome. */
      persistenceStatus?: "incomplete";
      /** Known provider outcome when local persistence is incomplete. */
      providerOutcome?: "failed" | "timeout" | "accepted";
      error: string;
    };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strict plain-text validation — rejects non-strings before any coercion. */
export function validateOutboundText(
  rawText: unknown
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof rawText !== "string") {
    return { ok: false, error: "text must be a string" };
  }
  const text = rawText.trim();
  if (!text) {
    return { ok: false, error: "text is required" };
  }
  if (text.length > WHATSAPP_MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: `text exceeds maximum length of ${WHATSAPP_MAX_TEXT_LENGTH}`,
    };
  }
  return { ok: true, text };
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

async function recordPersistenceDegraded(
  deps: OutboundSendDeps,
  input: {
    messageId: string;
    conversationId: string;
    providerOutcome: "failed" | "timeout" | "accepted";
    persistError: string;
    sanitizedProviderError?: string;
  }
): Promise<void> {
  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_PERSISTENCE_DEGRADED,
    entityType: "message",
    entityId: input.messageId,
    metadata: {
      conversationId: input.conversationId,
      providerOutcome: input.providerOutcome,
      persistError: input.persistError.slice(0, 300),
      // Never include tokens or raw provider payloads.
      providerError: input.sanitizedProviderError
        ? input.sanitizedProviderError.slice(0, 300)
        : undefined,
    },
  });
}

export async function sendOutboundPlainText(
  conversationId: string,
  rawText: unknown,
  deps: OutboundSendDeps
): Promise<OutboundSendResult> {
  if (!deps.config.enabled) {
    return { httpStatus: 404, error: "Not found" };
  }

  // Fail closed on role before loading conversation details.
  if (!deps.actor) {
    return { httpStatus: 401, error: "Unauthorized" };
  }
  if (!canSendOutboundWhatsApp(deps.actor)) {
    return { httpStatus: 403, error: "Forbidden" };
  }

  if (!deps.repo.isActive()) {
    return { httpStatus: 503, error: "WhatsApp persistence unavailable" };
  }
  if (!hasOutboundSendConfig(deps.config)) {
    return { httpStatus: 503, error: "WhatsApp send configuration incomplete" };
  }

  const textValidation = validateOutboundText(rawText);
  if (textValidation.ok === false) {
    return { httpStatus: 400, error: textValidation.error };
  }
  const text = textValidation.text;

  const bundle = await deps.repo.getConversationBundle(conversationId);
  const auth = authorizeOutboundWhatsAppActor(deps.actor, bundle);
  if (auth.ok === false) {
    return { httpStatus: auth.status, error: auth.error };
  }
  const conversationBundle = bundle!;

  if (conversationBundle.channel.phoneNumberId !== deps.config.phoneNumberId) {
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

  const messagingBridge = deps.messagingRepository
    ? createWhatsAppMessagingBridge({
        repository: deps.messagingRepository,
        config: deps.config,
      })
    : null;

  const clientIdempotencyKey =
    (deps.clientIdempotencyKey && deps.clientIdempotencyKey.trim()) ||
    (messagingBridge ? randomUUID() : "");

  let messagingMessageId: string | null = null;
  let claimedSend = false;

  if (messagingBridge) {
    try {
      const prepared = await bridgePrepareOutboundMessage(messagingBridge, {
        recipientWaId: conversationBundle.contact.phoneE164,
        text,
        clientIdempotencyKey,
        actorId: deps.actor.id,
      });
      messagingMessageId = prepared.message.messageId;

      const claim = await bridgeClaimOutboundSend(
        messagingBridge,
        prepared.message.messageId
      );

      if (claim.kind === "completed") {
        return {
          httpStatus: 201,
          messageId: bridgeInboxCompatibleMessageId(claim.row),
          providerMessageId:
            bridgeProviderMessageId(claim.row) ??
            bridgeInboxCompatibleMessageId(claim.row),
          status: "sent",
        };
      }
      if (claim.kind === "in_flight") {
        return {
          httpStatus: 202,
          messageId: bridgeInboxCompatibleMessageId(claim.row),
          providerMessageId: bridgeProviderMessageId(claim.row) ?? undefined,
          status: MESSAGE_STATUSES.SENDING,
          persistenceStatus: "incomplete",
          providerOutcome: "accepted",
          error: "Outbound send already in progress for this idempotency key",
        };
      }
      if (claim.kind === "terminal") {
        return {
          httpStatus: 409,
          messageId: bridgeInboxCompatibleMessageId(claim.row),
          status: claim.row.deliveryStatus,
          error:
            "Idempotency key is not eligible for automatic resend; use a new key",
        };
      }
      claimedSend = true;
      messagingMessageId = claim.row.messageId;
    } catch (err) {
      if (
        isMessagingRepositoryError(err) &&
        err.detail === "idempotency_conflict"
      ) {
        return {
          httpStatus: 409,
          error: "Idempotency key reused with different request content",
        };
      }
      return {
        httpStatus: 500,
        error: "Failed to persist normalized outbound message",
      };
    }
  }

  // Without messaging wiring, or after winning the atomic claim, create one legacy row.
  let message;
  try {
    message = await deps.repo.insertOutboundMessage({
      conversationId,
      textBody: text,
    });
  } catch {
    return { httpStatus: 500, error: "Failed to queue outbound message" };
  }

  if (messagingBridge && messagingMessageId && claimedSend) {
    try {
      await messagingBridge.repository.bindOutboundLegacyMessageId({
        organizationId: messagingBridge.organizationId,
        messageId: messagingMessageId,
        whatsappMessageId: message.id,
      });
    } catch {
      /* binding failure must not double-send; continue and surface via response IDs */
    }
  }

  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_QUEUED,
    entityType: "message",
    entityId: message.id,
    metadata: {
      conversationId,
      actorId: deps.actor.id,
      actorRole: deps.actor.role,
    },
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

  // Meta is called at most once for this request. Never retry after response/timeout.
  const graphResult = await sendWhatsAppTextMessage({
    toWaId: conversationBundle.contact.phoneE164,
    text,
    phoneNumberId: deps.config.phoneNumberId,
    accessToken: deps.config.accessToken,
    graphApiVersion: deps.config.graphApiVersion,
    fetchImpl: deps.fetchImpl,
  });

  if (graphResult.ok === true) {
    const providerMessageId = graphResult.providerMessageId;
    const sentAt = new Date().toISOString();

    if (messagingBridge && messagingMessageId) {
      try {
        await bridgeRecordOutboundProviderResult(messagingBridge, {
          messageId: messagingMessageId,
          outcome: "accepted",
          providerMessageId,
        });
      } catch {
        // Provider already accepted — record degraded but do not resend.
        console.error(
          JSON.stringify({
            scope: "unified-messaging-runtime",
            event: "normalized_persistence_failed",
            code: "provider_accepted_status_persist",
            messageId: messagingMessageId,
          })
        );
      }
    }

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
      await recordPersistenceDegraded(deps, {
        messageId: message.id,
        conversationId,
        providerOutcome: "accepted",
        persistError: statusUpdate.error,
      });
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
        persistenceStatus: "incomplete",
        providerOutcome: "accepted",
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
    if (messagingBridge && messagingMessageId) {
      try {
        await bridgeRecordOutboundProviderResult(messagingBridge, {
          messageId: messagingMessageId,
          outcome: "timeout",
          errorCategory: "timeout",
        });
      } catch {
        /* logged inside bridge */
      }
    }
    const statusUpdate = await updateStatusWithRetry(deps, {
      messageId: message.id,
      status: MESSAGE_STATUSES.TIMEOUT,
      providerError: failure.sanitizedError,
    });

    if (statusUpdate.ok === false) {
      await recordPersistenceDegraded(deps, {
        messageId: message.id,
        conversationId,
        providerOutcome: "timeout",
        persistError: statusUpdate.error,
        sanitizedProviderError: failure.sanitizedError,
      });
      // Provider outcome is uncertain (timeout); do not claim local timeout persisted.
      return {
        httpStatus: 504,
        messageId: message.id,
        status: MESSAGE_STATUSES.SENDING,
        persistenceStatus: "incomplete",
        providerOutcome: "timeout",
        error:
          "Provider request timed out; local timeout status persistence incomplete",
      };
    }

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

  if (messagingBridge && messagingMessageId) {
    try {
      await bridgeRecordOutboundProviderResult(messagingBridge, {
        messageId: messagingMessageId,
        outcome: "failed",
        errorCategory: "provider_rejected",
      });
    } catch {
      /* logged inside bridge */
    }
  }

  const statusUpdate = await updateStatusWithRetry(deps, {
    messageId: message.id,
    status: MESSAGE_STATUSES.FAILED,
    providerError: failure.sanitizedError,
  });

  if (statusUpdate.ok === false) {
    await recordPersistenceDegraded(deps, {
      messageId: message.id,
      conversationId,
      providerOutcome: "failed",
      persistError: statusUpdate.error,
      sanitizedProviderError: failure.sanitizedError,
    });
    // Provider outcome is known failed; do not claim local failed status persisted.
    return {
      httpStatus: 502,
      messageId: message.id,
      status: MESSAGE_STATUSES.SENDING,
      persistenceStatus: "incomplete",
      providerOutcome: "failed",
      error:
        "Provider rejected the message; local failed status persistence incomplete",
    };
  }

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
