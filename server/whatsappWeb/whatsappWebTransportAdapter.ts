/**
 * Baileys transport adapter implementing MessagingTransportAdapter for
 * whatsapp_web_qr. Lives outside unifiedMessaging/ (contract isolation).
 */
import { randomUUID } from "node:crypto";
import { exampleCapabilityProfile } from "../unifiedMessaging/transportCapabilities.ts";
import type { MessagingTransportAdapter } from "../unifiedMessaging/transportAdapter.ts";
import { errResult, okResult } from "../unifiedMessaging/transportErrors.ts";
import type {
  BrowserSafeConnectionStatus,
  NormalizedMessage,
  NormalizedMessagingEvent,
} from "../unifiedMessaging/transportTypes.ts";
import { WHATSAPP_WEB_QR_CONNECTION_ID } from "./whatsappWebConfig.ts";
import { normalizeBaileysInbound } from "./whatsappWebNormalize.ts";
import type { WhatsAppWebSession } from "./whatsappWebSession.ts";
import type { WhatsAppWebLifecycleState } from "./whatsappWebTypes.ts";

function mapLifecycleToConnectionState(
  state: WhatsAppWebLifecycleState
): BrowserSafeConnectionStatus["state"] {
  switch (state) {
    case "QR_READY":
      return "awaiting_qr";
    case "CONNECTING":
      return "connecting";
    case "CONNECTED":
      return "connected";
    case "RECONNECTING":
      return "reconnecting";
    case "LOGGED_OUT":
      return "expired";
    case "ERROR":
      return "failed";
    case "DISCONNECTED":
    default:
      return "disconnected";
  }
}

function toBrowserStatus(
  session: WhatsAppWebSession,
  connectionId: string
): BrowserSafeConnectionStatus {
  const status = session.getSafeStatus();
  return {
    connectionId,
    organizationId: "sunchaser",
    transport: "whatsapp_web_qr",
    state: status.enabled
      ? mapLifecycleToConnectionState(status.state)
      : "disabled",
    health: status.state === "CONNECTED" ? "healthy" : "unknown",
    lastSuccessfulActivityAt:
      status.state === "CONNECTED" ? status.updatedAt : null,
    lastErrorCategory: status.state === "ERROR" ? "internal_failure" : "none",
    reconnectEligible:
      status.state === "DISCONNECTED" ||
      status.state === "ERROR" ||
      status.state === "RECONNECTING",
    experimental: true,
    internalOnly: true,
    independentlyDisableable: true,
    transportMetadata: {
      displayPhoneMasked: status.phoneMasked,
      flags: {
        qrAvailable: status.qrAvailable,
        lifecycle: status.state,
      },
    },
    safeErrorSummary: status.safeMessage,
  };
}

export function createWhatsAppWebTransportAdapter(input: {
  session: WhatsAppWebSession;
}): MessagingTransportAdapter {
  const session = input.session;
  const connectionId = WHATSAPP_WEB_QR_CONNECTION_ID;
  const capabilities = exampleCapabilityProfile("whatsapp_web_qr");

  const unsupported = (operation: string) =>
    errResult({
      category: "capability_unsupported",
      retryable: false,
      safeMessage: `${operation} is not supported on WhatsApp Web QR in this phase`,
      diagnostic: { operation },
    });

  return {
    transport: "whatsapp_web_qr",

    async connect() {
      try {
        await session.connect();
        return okResult(toBrowserStatus(session, connectionId));
      } catch (err) {
        const code = (err as { code?: string })?.code;
        return errResult({
          category:
            code === "feature_disabled" ? "forbidden" : "internal_failure",
          retryable: false,
          safeMessage:
            code === "feature_disabled"
              ? "WhatsApp Web QR is disabled"
              : "Failed to start WhatsApp Web connection",
          diagnostic: { operation: "connect" },
        });
      }
    },

    async disconnect() {
      await session.disconnect();
      return okResult(toBrowserStatus(session, connectionId));
    },

    async reconnect() {
      await session.disconnect();
      try {
        await session.connect();
        return okResult(toBrowserStatus(session, connectionId));
      } catch {
        return errResult({
          category: "internal_failure",
          retryable: true,
          safeMessage: "Reconnect failed",
          diagnostic: { operation: "reconnect" },
        });
      }
    },

    async getConnectionStatus() {
      return okResult(toBrowserStatus(session, connectionId));
    },

    async getCapabilities() {
      return okResult(capabilities);
    },

    async verifyInboundRequest() {
      return okResult({
        kind: "rejected" as const,
        statusCode: 404,
        reason: "WhatsApp Web QR does not use webhook verification",
      });
    },

    async normalizeInbound(req) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(req.rawBody).toString("utf8"));
      } catch {
        return errResult({
          category: "invalid_request",
          retryable: false,
          safeMessage: "Invalid inbound payload",
          diagnostic: { operation: "normalizeInbound" },
        });
      }
      const msg = parsed as {
        providerMessageId?: string;
        remoteJid?: string;
        fromMe?: boolean;
        text?: string | null;
        pushName?: string | null;
        occurredAt?: string;
        isGroup?: boolean;
        isStatusOrNewsletter?: boolean;
        rawType?: string | null;
      };
      const result = normalizeBaileysInbound({
        providerMessageId: String(msg.providerMessageId ?? ""),
        remoteJid: String(msg.remoteJid ?? ""),
        fromMe: msg.fromMe === true,
        text: msg.text ?? null,
        pushName: msg.pushName ?? null,
        occurredAt: msg.occurredAt ?? new Date().toISOString(),
        isGroup: msg.isGroup === true,
        isStatusOrNewsletter: msg.isStatusOrNewsletter === true,
        rawType: msg.rawType ?? null,
      });
      if (result.kind === "ignore") {
        return okResult([] as const);
      }

      const now = result.event.occurredAt;
      const message: NormalizedMessage = {
        messageId: randomUUID(),
        organizationId: "sunchaser",
        conversationId: "",
        connectionId,
        transport: "whatsapp_web_qr",
        externalMessageId: result.event.waMessageId,
        direction: "inbound",
        sender: {
          kind: "customer_contact",
          id: result.event.fromWaId,
          externalHandleRef: result.event.fromWaId,
        },
        recipient: {
          kind: "system",
          id: connectionId,
        },
        messageType: "text",
        text: result.event.text,
        structuredContent: { kind: "none" },
        replyToMessageId: null,
        clientIdempotencyKey: null,
        providerTimestamp: now,
        receivedAt: now,
        createdAt: now,
        processingStatus: "processed",
        deliveryStatus: "received",
        origin: "customer",
        aiRunRef: null,
        providerMetadata: {
          transport: "whatsapp_web_qr",
        },
      };

      const event: NormalizedMessagingEvent = {
        kind: "inbound_message_received",
        eventId: randomUUID(),
        transport: "whatsapp_web_qr",
        connectionId,
        occurredAt: now,
        dedupeKey: req.dedupeKey || result.event.waMessageId,
        metadata: { transport: "whatsapp_web_qr" },
        message,
      };
      return okResult([event] as const);
    },

    async sendMessage() {
      return unsupported("sendMessage");
    },
    async sendTemplate() {
      return unsupported("sendTemplate");
    },
    async downloadMedia() {
      return unsupported("downloadMedia");
    },
    async uploadMedia() {
      return unsupported("uploadMedia");
    },
    async normalizeStatus() {
      return unsupported("normalizeStatus");
    },
    async resolveIdentity(input) {
      return okResult({
        kind: "customer_contact" as const,
        id: input.externalHandle,
        externalHandleRef: input.externalHandle,
      });
    },
    async healthCheck() {
      const status = session.getSafeStatus();
      return okResult({
        transport: "whatsapp_web_qr" as const,
        connectionId,
        healthy: status.state === "CONNECTED",
        checkedAt: new Date().toISOString(),
        safeDetails: status.safeMessage,
      });
    },
  };
}
