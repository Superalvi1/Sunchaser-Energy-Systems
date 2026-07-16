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

function toIsoFromUnixSeconds(raw: string | undefined): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return new Date().toISOString();
  }
  return new Date(n * 1000).toISOString();
}

function isSupportedStatus(value: string): value is SupportedStatusValue {
  return (SUPPORTED_STATUS_VALUES as readonly string[]).includes(value);
}

function findProfileName(
  contacts: Array<{ wa_id?: string; profile?: { name?: string } }> | undefined,
  waId: string
): string | null {
  if (!contacts?.length) return null;
  const match = contacts.find((c) => digitsOnlyPhone(c.wa_id || "") === waId);
  const name = match?.profile?.name;
  return name ? String(name) : null;
}

function normalizeMessage(
  message: MetaWebhookMessage,
  ctx: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    wabaEntryId: string | null;
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  }
): NormalizedWebhookEvent | null {
  const waMessageId = String(message.id || "").trim();
  const fromWaId = digitsOnlyPhone(message.from || "");
  if (!waMessageId || !fromWaId) return null;

  if (message.type === "text" && message.text?.body != null) {
    const text = String(message.text.body);
    return {
      kind: "inbound_text",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      text,
      occurredAt: toIsoFromUnixSeconds(message.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  return {
    kind: "unsupported",
    phoneNumberId: ctx.phoneNumberId,
    waMessageId,
    messageType: message.type ? String(message.type) : null,
    rawEvent: message as Record<string, unknown>,
  };
}

function normalizeStatus(
  status: MetaWebhookStatus,
  ctx: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    wabaEntryId: string | null;
  }
): NormalizedStatusEvent | null {
  const waMessageId = String(status.id || "").trim();
  const statusValue = String(status.status || "").trim().toLowerCase();
  if (!waMessageId || !isSupportedStatus(statusValue)) return null;

  return {
    kind: "status",
    phoneNumberId: ctx.phoneNumberId,
    displayPhoneNumber: ctx.displayPhoneNumber,
    wabaEntryId: ctx.wabaEntryId,
    waMessageId,
    status: statusValue,
    statusTimestamp: toIsoFromUnixSeconds(status.timestamp),
    recipientWaId: status.recipient_id
      ? digitsOnlyPhone(status.recipient_id)
      : null,
    rawEvent: status as Record<string, unknown>,
  };
}

export function parseWebhookRawBody(rawBody: Buffer): ParseEnvelopeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, error: "malformed_json" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "invalid_shape" };
  }

  const envelope = parsed as MetaWebhookEnvelope;
  const events: NormalizedWebhookEvent[] = [];

  for (const entry of envelope.entry || []) {
    const wabaEntryId = entry.id ? String(entry.id) : null;
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = String(value.metadata?.phone_number_id || "").trim();
      const displayPhoneNumber = value.metadata?.display_phone_number
        ? digitsOnlyPhone(value.metadata.display_phone_number)
        : null;

      for (const message of value.messages || []) {
        const normalized = normalizeMessage(message, {
          phoneNumberId,
          displayPhoneNumber,
          wabaEntryId,
          contacts: value.contacts,
        });
        if (normalized) events.push(normalized);
      }

      for (const status of value.statuses || []) {
        const normalized = normalizeStatus(status, {
          phoneNumberId,
          displayPhoneNumber,
          wabaEntryId,
        });
        if (normalized) events.push(normalized);
      }
    }
  }

  return { ok: true, envelope, events };
}
