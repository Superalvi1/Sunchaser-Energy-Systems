/**
 * Normalize Baileys inbound messages for the existing Inbox persist path.
 * Ignores groups, status/newsletters, and fromMe messages.
 */
import { digitsOnlyPhone } from "../whatsappTransport/whatsappEnvelope.ts";
import type { NormalizedInboundText } from "../whatsappTransport/whatsappEnvelope.ts";
import { WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID } from "./whatsappWebConfig.ts";

export type BaileysInboundLike = {
  providerMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  text: string | null;
  pushName: string | null;
  occurredAt: string;
  isGroup: boolean;
  isStatusOrNewsletter: boolean;
  rawType: string | null;
};

export type NormalizeBaileysResult =
  | { kind: "accept"; event: NormalizedInboundText }
  | {
      kind: "ignore";
      reason:
        | "from_me"
        | "group"
        | "status_or_newsletter"
        | "no_text"
        | "bad_jid"
        | "missing_provider_id";
    };

/**
 * Convert a remote JID (e.g. 92300...@s.whatsapp.net) to digits-only phone id.
 */
export function jidToWaId(remoteJid: string): string | null {
  const bare = String(remoteJid || "").trim();
  if (!bare || bare.endsWith("@g.us")) return null;
  if (bare === "status@broadcast" || bare.endsWith("@newsletter")) return null;
  const user = bare.split("@")[0] ?? "";
  const digits = digitsOnlyPhone(user.split(":")[0] ?? "");
  return digits.length >= 6 ? digits : null;
}

export function normalizeBaileysInbound(
  message: BaileysInboundLike
): NormalizeBaileysResult {
  if (!message.providerMessageId?.trim()) {
    return { kind: "ignore", reason: "missing_provider_id" };
  }
  if (message.fromMe) {
    return { kind: "ignore", reason: "from_me" };
  }
  if (message.isGroup) {
    return { kind: "ignore", reason: "group" };
  }
  if (message.isStatusOrNewsletter) {
    return { kind: "ignore", reason: "status_or_newsletter" };
  }
  const text = message.text?.trim() ?? "";
  if (!text) {
    return { kind: "ignore", reason: "no_text" };
  }
  const fromWaId = jidToWaId(message.remoteJid);
  if (!fromWaId) {
    return { kind: "ignore", reason: "bad_jid" };
  }

  const event: NormalizedInboundText = {
    kind: "inbound_text",
    phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
    displayPhoneNumber: null,
    wabaEntryId: null,
    waMessageId: message.providerMessageId.trim(),
    fromWaId,
    profileName: message.pushName,
    text,
    occurredAt: message.occurredAt,
    rawEvent: {
      transport: "whatsapp_web_qr",
      messageType: message.rawType ?? "text",
    },
    messageType: "text",
    textBody: text,
  };
  return { kind: "accept", event };
}

/** Build chat JID for outbound send from digits-only wa id. */
export function waIdToChatJid(waId: string): string {
  const digits = digitsOnlyPhone(waId);
  return `${digits}@s.whatsapp.net`;
}
