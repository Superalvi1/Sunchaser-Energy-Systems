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
  messageType?: string;
  textBody?: string | null;
  metaMediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
  sha256?: string | null;
  voice?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  placeName?: string | null;
};

export type NormalizedInboundMessage = {
  kind: "inbound_message";
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaEntryId: string | null;
  waMessageId: string;
  fromWaId: string;
  profileName: string | null;
  messageType: string;
  textBody: string | null;
  metaMediaId: string | null;
  mimeType: string | null;
  caption: string | null;
  filename: string | null;
  sha256: string | null;
  voice: boolean;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  placeName: string | null;
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
  | NormalizedInboundMessage
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

export function sanitizeCoordinate(val: unknown, min: number, max: number): number | null {
  if (val == null) return null;
  const n = typeof val === "number" ? val : Number(val);
  if (Number.isFinite(n) && n >= min && n <= max) {
    return n;
  }
  return null;
}

export function truncateString(str: unknown, maxLen: number): string | null {
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function buildMinimizedMetadata(event: {
  messageType: string;
  waMessageId: string;
  metaMediaId?: string | null;
  mimeType?: string | null;
  sha256?: string | null;
  filename?: string | null;
  caption?: string | null;
  voice?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  placeName?: string | null;
  address?: string | null;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    messageType: event.messageType,
    waMessageId: event.waMessageId,
    parsedOutcome: "success",
  };
  if (event.metaMediaId) metadata.metaMediaId = event.metaMediaId;
  if (event.mimeType) metadata.mimeType = event.mimeType;
  if (event.sha256) metadata.sha256 = event.sha256;
  if (event.filename) metadata.filename = truncateString(event.filename, 255);
  if (event.caption) metadata.caption = truncateString(event.caption, 1024);
  if (event.voice) metadata.voice = true;
  if (event.latitude != null) metadata.latitude = event.latitude;
  if (event.longitude != null) metadata.longitude = event.longitude;
  if (event.placeName) metadata.placeName = truncateString(event.placeName, 255);
  if (event.address) metadata.address = truncateString(event.address, 500);

  return metadata;
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

  const type = msg.type ? String(msg.type).toLowerCase() : "unknown";

  if (type === "text" && isPlainObject(msg.text) && msg.text.body != null) {
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
      messageType: "text",
      text: msg.text.body,
      textBody: msg.text.body,
      metaMediaId: null,
      mimeType: null,
      caption: null,
      filename: null,
      sha256: null,
      voice: false,
      latitude: null,
      longitude: null,
      address: null,
      placeName: null,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  if (type === "image" && isPlainObject(msg.image)) {
    const img = msg.image;
    const caption = typeof img.caption === "string" ? img.caption : null;
    return {
      kind: "inbound_message",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      messageType: "image",
      textBody: caption,
      metaMediaId: typeof img.id === "string" ? img.id : null,
      mimeType: typeof img.mime_type === "string" ? img.mime_type : null,
      caption,
      filename: null,
      sha256: typeof img.sha256 === "string" ? img.sha256 : null,
      voice: false,
      latitude: null,
      longitude: null,
      address: null,
      placeName: null,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  if (type === "document" && isPlainObject(msg.document)) {
    const doc = msg.document;
    const caption = typeof doc.caption === "string" ? doc.caption : null;
    return {
      kind: "inbound_message",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      messageType: "document",
      textBody: caption,
      metaMediaId: typeof doc.id === "string" ? doc.id : null,
      mimeType: typeof doc.mime_type === "string" ? doc.mime_type : null,
      caption,
      filename: typeof doc.filename === "string" ? doc.filename : null,
      sha256: typeof doc.sha256 === "string" ? doc.sha256 : null,
      voice: false,
      latitude: null,
      longitude: null,
      address: null,
      placeName: null,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  if ((type === "audio" || type === "voice") && (isPlainObject(msg.audio) || isPlainObject(msg.voice))) {
    const aud = (isPlainObject(msg.voice) ? msg.voice : msg.audio) || {};
    const isVoice = type === "voice" || aud.voice === true;
    return {
      kind: "inbound_message",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      messageType: isVoice ? "voice" : "audio",
      textBody: null,
      metaMediaId: typeof aud.id === "string" ? aud.id : null,
      mimeType: typeof aud.mime_type === "string" ? aud.mime_type : null,
      caption: null,
      filename: null,
      sha256: typeof aud.sha256 === "string" ? aud.sha256 : null,
      voice: isVoice,
      latitude: null,
      longitude: null,
      address: null,
      placeName: null,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  if (type === "video" && isPlainObject(msg.video)) {
    const vid = msg.video;
    const caption = typeof vid.caption === "string" ? vid.caption : null;
    return {
      kind: "inbound_message",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      messageType: "video",
      textBody: caption,
      metaMediaId: typeof vid.id === "string" ? vid.id : null,
      mimeType: typeof vid.mime_type === "string" ? vid.mime_type : null,
      caption,
      filename: null,
      sha256: typeof vid.sha256 === "string" ? vid.sha256 : null,
      voice: false,
      latitude: null,
      longitude: null,
      address: null,
      placeName: null,
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  if (type === "location" && isPlainObject(msg.location)) {
    const loc = msg.location;
    const lat = typeof loc.latitude === "number" ? loc.latitude : Number(loc.latitude);
    const lng = typeof loc.longitude === "number" ? loc.longitude : Number(loc.longitude);
    return {
      kind: "inbound_message",
      phoneNumberId: ctx.phoneNumberId,
      displayPhoneNumber: ctx.displayPhoneNumber,
      wabaEntryId: ctx.wabaEntryId,
      waMessageId,
      fromWaId,
      profileName: findProfileName(ctx.contacts, fromWaId),
      messageType: "location",
      textBody: typeof loc.name === "string" ? loc.name : typeof loc.address === "string" ? loc.address : null,
      metaMediaId: null,
      mimeType: null,
      caption: null,
      filename: null,
      sha256: null,
      voice: false,
      latitude: sanitizeCoordinate(loc.latitude, -90, 90),
      longitude: sanitizeCoordinate(loc.longitude, -180, 180),
      address: truncateString(loc.address, 500),
      placeName: truncateString(loc.name, 255),
      occurredAt: toIsoFromUnixSeconds(msg.timestamp),
      rawEvent: message as Record<string, unknown>,
    };
  }

  // Unknown message types must never crash the webhook
  return {
    kind: "inbound_message",
    phoneNumberId: ctx.phoneNumberId,
    displayPhoneNumber: ctx.displayPhoneNumber,
    wabaEntryId: ctx.wabaEntryId,
    waMessageId,
    fromWaId,
    profileName: findProfileName(ctx.contacts, fromWaId),
    messageType: type || "unknown",
    textBody: null,
    metaMediaId: null,
    mimeType: null,
    caption: null,
    filename: null,
    sha256: null,
    voice: false,
    latitude: null,
    longitude: null,
    address: null,
    placeName: null,
    occurredAt: toIsoFromUnixSeconds(msg.timestamp),
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
