/**
 * Normalize Baileys inbound messages for the existing Inbox persist path.
 * Ignores groups, status/newsletters, and fromMe messages.
 */
import { digitsOnlyPhone } from "../whatsappTransport/whatsappEnvelope.ts";
import type { NormalizedInboundText } from "../whatsappTransport/whatsappEnvelope.ts";
import { WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID } from "./whatsappWebConfig.ts";
import {
  resolveWhatsAppIdentity,
  type WhatsAppLidPhoneMap,
} from "./whatsappWebIdentity.ts";

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
  remoteJidAlt?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
  senderPn?: string | null;
  senderLid?: string | null;
  participantPn?: string | null;
  participantLid?: string | null;
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

/** Hosts that may yield a phoneE164 identity. Never treat @lid / unknown hosts as phones. */
export const WHATSAPP_PHONE_JID_HOSTS = new Set(["s.whatsapp.net"]);

/**
 * Convert a remote JID (e.g. 92300...@s.whatsapp.net) to digits-only phone id.
 * Only @s.whatsapp.net user JIDs are accepted. Device suffixes (user:device@host) are stripped.
 * @lid, groups, status/broadcast, newsletters, and unknown hosts return null.
 */
export function jidToWaId(remoteJid: string): string | null {
  const bare = String(remoteJid || "").trim().split("/")[0] ?? "";
  if (!bare) return null;
  const at = bare.lastIndexOf("@");
  if (at <= 0) return null;
  const userPart = bare.slice(0, at);
  const host = bare.slice(at + 1).toLowerCase();
  if (!WHATSAPP_PHONE_JID_HOSTS.has(host)) return null;
  if (bare.endsWith("@g.us")) return null;
  if (bare === "status@broadcast" || host.includes("broadcast")) return null;
  if (host.endsWith("newsletter") || bare.endsWith("@newsletter")) return null;
  const user = userPart.split(":")[0] ?? "";
  const digits = digitsOnlyPhone(user);
  return digits.length >= 6 ? digits : null;
}

export type NormalizeBaileysOptions = {
  /** Optional shared LID map (process-local). Never creates fake phones from @lid. */
  lidMap?: WhatsAppLidPhoneMap | null;
};

export function normalizeBaileysInbound(
  message: BaileysInboundLike,
  options?: NormalizeBaileysOptions
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
  const identityInput = {
    remoteJid: message.remoteJid,
    remoteJidAlt: message.remoteJidAlt,
    participant: message.participant,
    participantAlt: message.participantAlt,
    senderPn: message.senderPn,
    senderLid: message.senderLid,
    participantPn: message.participantPn,
    participantLid: message.participantLid,
  };
  // Prefer shared map so verified Contact.jid / *Alt / *Pn learned earlier
  // can resolve later LID-only notify events. Never treat @lid digits as phones.
  const identity = options?.lidMap
    ? options.lidMap.resolveIdentity(identityInput)
    : resolveWhatsAppIdentity(identityInput);
  const fromWaId = identity?.phoneE164 ?? jidToWaId(message.remoteJid);
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
