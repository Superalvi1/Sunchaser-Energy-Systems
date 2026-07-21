import {
  SUPPORTED_STATUS_VALUES,
  type SupportedStatusValue,
} from "./whatsappConstants.ts";
import type {
  MetaWebhookEnvelope,
  MetaWebhookMessage,
  MetaWebhookStatus,
} from "./whatsappProviderTypes.ts";

export type NormalizedInboundText = {
  kind: "inbound_text";
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaEntryId: string | null;
  waMessageId: string;
  fromWaId: string;
  profileName: string | null;
  text: string;
  occurredAt: string;
  rawEvent: Record<string, unknown>;
};

export type NormalizedStatusEvent = {
  kind: "status";
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaEntryId: string | null;
  waMessageId: string;
  status: SupportedStatusValue;
  statusTimestamp: string;
  recipientWaId: string | null;
  rawEvent: Record<string, unknown>;
};

export type NormalizedUnsupported = {
  kind: "unsupported";
  phoneNumberId: string | null;
  waMessageId: string | null;
  messageType: string | null;
  rawEvent: Record<string, unknown>;
};

export type NormalizedWebhookEvent =
  | NormalizedInboundText
  | NormalizedStatusEvent
  | NormalizedUnsupported;

export type ParseEnvelopeResult =
  | { ok: true; envelope: MetaWebhookEnvelope; events: NormalizedWebhookEvent[] }
  | { ok: false; error: "malformed_json" | "invalid_shape" };

/** Digits-only international values as received from Meta (no locale normalizer). */
export function digitsOnlyPhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toIsoFromUnixSeconds(raw: unknown): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return new Date().toISOString();
  }
  return new Date(n * 1000).toISOString();
}

function isSupportedStatus(value: string): value is SupportedStatusValue {
  return (SUPPORTED_STATUS_VALUES as readonly string[]).includes(value);
}

function asContactList(
  contacts: unknown
): Array<{ wa_id?: string; profile?: { name?: string } }> {
  if (!Array.isArray(contacts)) return [];
  const out: Array<{ wa_id?: string; profile?: { name?: string } }> = [];
  for (const item of contacts) {
    if (!isPlainObject(item)) continue;
    const profile = isPlainObject(item.profile)
      ? { name: typeof item.profile.name === "string" ? item.profile.name : undefined }
      : undefined;
    out.push({
      wa_id: typeof item.wa_id === "string" ? item.wa_id : undefined,
      profile,
    });
  }
  return out;
}

function findProfileName(
  contacts: Array<{ wa_id?: string; profile?: { name?: string } }>,
  waId: string
): string | null {
  if (!contacts.length) return null;
  const match = contacts.find((c) => digitsOnlyPhone(c.wa_id || "") === waId);
  const name = match?.profile?.name;
  return name ? String(name) : null;
}

function normalizeMessage(
  message: unknown,
  ctx: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    wabaEntryId: string | null;
    contacts: Array<{ wa_id?: string; profile?: { name?: string } }>;
  }
): NormalizedWebhookEvent | null {
  if (!isPlainObject(message)) return null;
  const msg = message as MetaWebhookMessage;
  const waMessageId = String(msg.id || "").trim();
  const fromWaId = digitsOnlyPhone(typeof msg.from === "string" ? msg.from : "");
  if (!waMessageId || !fromWaId) return null;

  if (msg.type === "text" && isPlainObject(msg.text) && msg.text.body != null) {
    if (typeof msg.text.body !== "string") {
      return {
        kind: "unsupported",
        phoneNumberId: ctx.phoneNumberId,
        waMessageId,
        messageType: "text",
        rawEvent: message as Record<string, unknown>,
      };
    }
    return {
      kind: "inbound_text",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      text: msg.text.body,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  return {
    kind: "unsupported",
    phoneNumberId: ctx.phoneNumberId,
    waMessageId,
    messageType: msg.type ? String(msg.type) : null,
    rawEvent: message as Record<string, unknown>,
  };
}

function normalizeStatus(
  status: unknown,
  ctx: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    wabaEntryId: string | null;
  }
): NormalizedStatusEvent | null {
  if (!isPlainObject(status)) return null;
  const st = status as MetaWebhookStatus;
  const waMessageId = String(st.id || "").trim();
  const statusValue = String(st.status || "")
    .trim()
    .toLowerCase();
  if (!waMessageId || !isSupportedStatus(statusValue)) return null;

  return {
    kind: "status",
    phoneNumberId: ctx.phoneNumberId,
    displayPhoneNumber: ctx.displayPhoneNumber,
    wabaEntryId: ctx.wabaEntryId,
    waMessageId,
    status: statusValue,
    statusTimestamp: toIsoFromUnixSeconds(st.timestamp),
    recipientWaId:
      typeof st.recipient_id === "string"
        ? digitsOnlyPhone(st.recipient_id)
        : null,
    rawEvent: status as Record<string, unknown>,
  };
}

function normalizeChangeValue(
  value: unknown,
  wabaEntryId: string | null,
  events: NormalizedWebhookEvent[]
): void {
  if (!isPlainObject(value)) return;

  const metadata = isPlainObject(value.metadata) ? value.metadata : null;
  const phoneNumberId = metadata
    ? String(metadata.phone_number_id || "").trim()
    : "";
  const displayPhoneNumber =
    metadata && typeof metadata.display_phone_number === "string"
      ? digitsOnlyPhone(metadata.display_phone_number)
      : null;
  const contacts = asContactList(value.contacts);

  if (Array.isArray(value.messages)) {
    for (const message of value.messages) {
      const normalized = normalizeMessage(message, {
        phoneNumberId,
        displayPhoneNumber,
        wabaEntryId,
        contacts,
      });
      if (normalized) events.push(normalized);
    }
  }

  if (Array.isArray(value.statuses)) {
    for (const status of value.statuses) {
      const normalized = normalizeStatus(status, {
        phoneNumberId,
        displayPhoneNumber,
        wabaEntryId,
      });
      if (normalized) events.push(normalized);
    }
  }
}

/**
 * Parse and defensively normalize a Meta webhook envelope.
 * Never throws on malformed nested collections; skips bad siblings.
 */
export function parseWebhookRawBody(rawBody: Buffer): ParseEnvelopeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, error: "malformed_json" };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "invalid_shape" };
  }

  const envelope = parsed as MetaWebhookEnvelope;
  const events: NormalizedWebhookEvent[] = [];

  if (!Array.isArray(envelope.entry)) {
    // Signed but unusable structure — controlled parse failure (route → 400).
    return { ok: false, error: "invalid_shape" };
  }

  for (const entry of envelope.entry) {
    if (!isPlainObject(entry)) continue;
    const wabaEntryId =
      typeof entry.id === "string" && entry.id.trim() ? String(entry.id) : null;
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isPlainObject(change)) continue;
      normalizeChangeValue(change.value, wabaEntryId, events);
    }
  }

  return { ok: true, envelope, events };
}
