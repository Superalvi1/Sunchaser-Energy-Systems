/**
 * Canonical WhatsApp identity resolution for Baileys 6.7.x.
 *
 * Phone identities come only from @s.whatsapp.net (or Contact.jid / *Pn fields).
 * Numeric LID user parts are never treated as phone numbers.
 */
import { jidToWaId, waIdToChatJid } from "./whatsappWebNormalize.ts";
import { normalizeJid } from "./whatsappWebSyncTypes.ts";

export type WhatsAppIdentitySource =
  | "phone_jid"
  | "remote_jid_alt"
  | "participant_alt"
  | "sender_pn"
  | "participant_pn"
  | "contact_jid"
  | "ephemeral_lid_map";

export type ResolvedWhatsAppIdentity = {
  phoneE164: string;
  /** Canonical phone JID (@s.whatsapp.net). */
  phoneJid: string;
  /** LID JID when known (@lid), never used as phone. */
  lidJid: string | null;
  source: WhatsAppIdentitySource;
};

export type WhatsAppIdentityInput = {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
  senderPn?: string | null;
  senderLid?: string | null;
  participantPn?: string | null;
  participantLid?: string | null;
  /** Baileys Contact.id */
  contactId?: string | null;
  /** Baileys Contact.jid (PN format when present). */
  contactJid?: string | null;
  /** Baileys Contact.lid */
  contactLid?: string | null;
};

function isLidJid(jid: string): boolean {
  return normalizeJid(jid).endsWith("@lid");
}

function isPhoneJid(jid: string): boolean {
  return jidToWaId(jid) != null;
}

function firstPhoneFromCandidates(
  candidates: Array<{ jid: string; source: WhatsAppIdentitySource }>
): { phoneE164: string; phoneJid: string; source: WhatsAppIdentitySource } | null {
  for (const c of candidates) {
    const jid = normalizeJid(c.jid);
    if (!jid || isLidJid(jid)) continue;
    const phone = jidToWaId(jid);
    if (!phone) continue;
    return { phoneE164: phone, phoneJid: waIdToChatJid(phone), source: c.source };
  }
  return null;
}

/** Extract the first normalized @lid JID from candidate fields. */
export function collectLidJid(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const jid = normalizeJid(String(value || ""));
    if (jid && isLidJid(jid)) return jid;
  }
  return null;
}

/**
 * Resolve a canonical phone identity from Baileys key/contact fields.
 * Returns null when no verified phone JID/PN mapping is available.
 */
export function resolveWhatsAppIdentity(
  input: WhatsAppIdentityInput
): ResolvedWhatsAppIdentity | null {
  const phone = firstPhoneFromCandidates([
    { jid: String(input.contactJid || ""), source: "contact_jid" },
    { jid: String(input.remoteJidAlt || ""), source: "remote_jid_alt" },
    { jid: String(input.participantAlt || ""), source: "participant_alt" },
    { jid: String(input.senderPn || ""), source: "sender_pn" },
    { jid: String(input.participantPn || ""), source: "participant_pn" },
    { jid: String(input.remoteJid || ""), source: "phone_jid" },
    { jid: String(input.participant || ""), source: "phone_jid" },
    { jid: String(input.contactId || ""), source: "phone_jid" },
  ]);
  if (!phone) return null;

  const lidJid = collectLidJid(
    input.contactLid,
    input.senderLid,
    input.participantLid,
    input.remoteJid,
    input.participant,
    input.contactId
  );

  return {
    phoneE164: phone.phoneE164,
    phoneJid: phone.phoneJid,
    lidJid,
    source: phone.source,
  };
}

/** True when a JID is exclusively LID with no phone host. */
export function isUnresolvedLidJid(jid: string): boolean {
  const n = normalizeJid(jid);
  return Boolean(n && isLidJid(n) && !isPhoneJid(n));
}

/**
 * In-memory LID → phone JID map populated from contacts/messages that carry both.
 */
export class WhatsAppLidPhoneMap {
  private readonly lidToPhoneJid = new Map<string, string>();

  remember(lidJid: string | null | undefined, phoneJid: string | null | undefined): void {
    const lid = normalizeJid(String(lidJid || ""));
    const phone = normalizeJid(String(phoneJid || ""));
    if (!lid || !isLidJid(lid)) return;
    if (!phone || !isPhoneJid(phone)) return;
    this.lidToPhoneJid.set(lid, phone);
  }

  resolvePhoneJid(jidOrLid: string): string | null {
    const n = normalizeJid(jidOrLid);
    if (!n) return null;
    if (isPhoneJid(n)) return waIdToChatJid(jidToWaId(n)!);
    if (isLidJid(n)) return this.lidToPhoneJid.get(n) ?? null;
    return null;
  }

  resolveIdentity(input: WhatsAppIdentityInput): ResolvedWhatsAppIdentity | null {
    const direct = resolveWhatsAppIdentity(input);
    if (direct) {
      this.remember(direct.lidJid, direct.phoneJid);
      return direct;
    }
    const lid = collectLidJid(
      input.remoteJid,
      input.participant,
      input.contactId,
      input.contactLid,
      input.senderLid,
      input.participantLid
    );
    if (!lid) return null;
    const mapped = this.lidToPhoneJid.get(lid);
    if (!mapped) return null;
    const phone = jidToWaId(mapped);
    if (!phone) return null;
    return {
      phoneE164: phone,
      phoneJid: waIdToChatJid(phone),
      lidJid: lid,
      source: "ephemeral_lid_map",
    };
  }
}
