/**
 * OpenAPI-friendly inbox API DTOs + validators (PR2 Step 4A).
 * Pure parse/validate — no I/O, no business rules.
 */
import {
  WHATSAPP_CRM_LINK_ENTITY_TYPES,
  WHATSAPP_INBOX_CONVERSATION_STATUSES,
  type WhatsAppCrmLinkEntityType,
  type WhatsAppInboxConversationStatus,
} from "./whatsappInboxDatabaseTypes.ts";
import type { KeysetCursor } from "./whatsappInboxRepoSupport.ts";

export type DtoOk<T> = { ok: true; value: T };
export type DtoErr = { ok: false; message: string; field?: string };
export type DtoResult<T> = DtoOk<T> | DtoErr;

function asRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function requireNonEmptyString(
  value: unknown,
  field: string
): DtoResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${field} is required`, field };
  }
  return { ok: true, value: value.trim() };
}

function optionalNonEmptyString(
  value: unknown,
  field: string
): DtoResult<string | undefined> {
  if (value == null || value === "") return { ok: true, value: undefined };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${field} must be a non-empty string`, field };
  }
  return { ok: true, value: value.trim() };
}

function requireInt(
  value: unknown,
  field: string,
  opts?: { min?: number; max?: number }
): DtoResult<number> {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n)) {
    return { ok: false, message: `${field} must be an integer`, field };
  }
  if (opts?.min != null && n < opts.min) {
    return { ok: false, message: `${field} must be >= ${opts.min}`, field };
  }
  if (opts?.max != null && n > opts.max) {
    return { ok: false, message: `${field} must be <= ${opts.max}`, field };
  }
  return { ok: true, value: n };
}

function parseBool(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

/** ISO-8601 / RFC3339-parsable timestamp — rejects malformed values before services. */
export function requireIsoTimestamp(
  value: unknown,
  field: string
): DtoResult<string> {
  const raw = requireNonEmptyString(value, field);
  if (!raw.ok) return raw;
  const ms = Date.parse(raw.value);
  if (!Number.isFinite(ms)) {
    return {
      ok: false,
      message: `${field} must be a valid ISO-8601 timestamp`,
      field,
    };
  }
  return { ok: true, value: raw.value };
}

function rejectUnknownKeys(
  rec: Record<string, unknown>,
  allowed: readonly string[]
): DtoErr | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(rec).filter((k) => !allowedSet.has(k));
  if (unknown.length === 0) return null;
  return {
    ok: false,
    message: `Unknown field(s): ${unknown.sort().join(", ")}`,
    field: unknown[0],
  };
}

export function encodeInboxCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeInboxCursor(raw: unknown): DtoResult<KeysetCursor | null> {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, message: "cursor must be a string", field: "cursor" };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as Partial<KeysetCursor>;
    if (
      typeof parsed?.at !== "string" ||
      !parsed.at ||
      typeof parsed?.id !== "string"
    ) {
      return { ok: false, message: "cursor is malformed", field: "cursor" };
    }
    const at = requireIsoTimestamp(parsed.at, "cursor.at");
    if (!at.ok) return at;
    return { ok: true, value: { at: at.value, id: parsed.id } };
  } catch {
    return { ok: false, message: "cursor is malformed", field: "cursor" };
  }
}

export type ListConversationsQuery = {
  status?: WhatsAppInboxConversationStatus;
  assignedTo?: string | "unassigned";
  channelId?: string;
  hasFailedMessage?: boolean;
  cursor?: KeysetCursor | null;
  limit?: number;
};

const LIST_QUERY_KEYS = [
  "status",
  "assignedTo",
  "channelId",
  "hasFailedMessage",
  "cursor",
  "limit",
] as const;

const DELTA_QUERY_KEYS = [
  ...LIST_QUERY_KEYS,
  "since",
  "sinceAt",
  "sinceId",
] as const;

export function parseListConversationsQuery(
  query: Record<string, unknown>
): DtoResult<ListConversationsQuery> {
  const unknown = rejectUnknownKeys(query, LIST_QUERY_KEYS);
  if (unknown) return unknown;

  let status: WhatsAppInboxConversationStatus | undefined;
  if (query.status != null && query.status !== "") {
    if (
      typeof query.status !== "string" ||
      !(WHATSAPP_INBOX_CONVERSATION_STATUSES as readonly string[]).includes(
        query.status
      )
    ) {
      return {
        ok: false,
        message: `status must be one of: ${WHATSAPP_INBOX_CONVERSATION_STATUSES.join(", ")}`,
        field: "status",
      };
    }
    status = query.status as WhatsAppInboxConversationStatus;
  }

  const assignedTo = optionalNonEmptyString(query.assignedTo, "assignedTo");
  if (!assignedTo.ok) return assignedTo;
  const channelId = optionalNonEmptyString(query.channelId, "channelId");
  if (!channelId.ok) return channelId;

  const hasFailedRaw = parseBool(query.hasFailedMessage);
  if (
    query.hasFailedMessage != null &&
    query.hasFailedMessage !== "" &&
    hasFailedRaw === undefined
  ) {
    return {
      ok: false,
      message: "hasFailedMessage must be a boolean",
      field: "hasFailedMessage",
    };
  }

  const cursor = decodeInboxCursor(query.cursor);
  if (!cursor.ok) return cursor;

  let limit: number | undefined;
  if (query.limit != null && query.limit !== "") {
    const parsed = requireInt(query.limit, "limit", { min: 1, max: 100 });
    if (!parsed.ok) return parsed;
    limit = parsed.value;
  }

  return {
    ok: true,
    value: {
      status,
      assignedTo: assignedTo.value as string | "unassigned" | undefined,
      channelId: channelId.value,
      hasFailedMessage: hasFailedRaw,
      cursor: cursor.value,
      limit,
    },
  };
}

export type DeltaQuery = ListConversationsQuery & {
  since: KeysetCursor;
};

export function parseDeltaQuery(
  query: Record<string, unknown>
): DtoResult<DeltaQuery> {
  const unknown = rejectUnknownKeys(query, DELTA_QUERY_KEYS);
  if (unknown) return unknown;

  // Reuse list filters without re-checking list-only unknown keys.
  const base = parseListConversationsQuery({
    status: query.status,
    assignedTo: query.assignedTo,
    channelId: query.channelId,
    hasFailedMessage: query.hasFailedMessage,
    cursor: query.cursor,
    limit: query.limit,
  });
  if (!base.ok) return base;

  // Accept opaque `since` cursor OR explicit sinceAt/sinceId pair.
  if (query.since != null && query.since !== "") {
    const decoded = decodeInboxCursor(query.since);
    if (!decoded.ok) return decoded;
    if (!decoded.value) {
      return { ok: false, message: "since cursor is required", field: "since" };
    }
    return { ok: true, value: { ...base.value, since: decoded.value } };
  }

  const sinceAt = requireIsoTimestamp(query.sinceAt, "sinceAt");
  if (!sinceAt.ok) {
    if (query.sinceAt == null || query.sinceAt === "") {
      return {
        ok: false,
        message: "since or sinceAt is required",
        field: "since",
      };
    }
    return sinceAt;
  }
  const sinceId =
    query.sinceId == null || query.sinceId === ""
      ? { ok: true as const, value: "" }
      : requireNonEmptyString(query.sinceId, "sinceId");
  if (!sinceId.ok) return sinceId;

  return {
    ok: true,
    value: {
      ...base.value,
      since: { at: sinceAt.value, id: sinceId.value },
    },
  };
}

export type SendMessageBody = {
  conversationId: string;
  text: string;
  idempotencyKey: string;
};

export function parseSendMessageBody(body: unknown): DtoResult<SendMessageBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "text",
    "idempotencyKey",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  const text = requireNonEmptyString(rec.text, "text");
  if (!text.ok) return text;
  const idempotencyKey = requireNonEmptyString(
    rec.idempotencyKey,
    "idempotencyKey"
  );
  if (!idempotencyKey.ok) return idempotencyKey;
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      text: text.value,
      idempotencyKey: idempotencyKey.value,
    },
  };
}

export type ReadWatermarkBody = {
  conversationId: string;
  lastSeenMessageId: string;
  lastSeenMessageCreatedAt: string;
};

export function parseReadWatermarkBody(
  body: unknown
): DtoResult<ReadWatermarkBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "lastSeenMessageId",
    "lastSeenMessageCreatedAt",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  const lastSeenMessageId = requireNonEmptyString(
    rec.lastSeenMessageId,
    "lastSeenMessageId"
  );
  if (!lastSeenMessageId.ok) return lastSeenMessageId;
  const lastSeenMessageCreatedAt = requireIsoTimestamp(
    rec.lastSeenMessageCreatedAt,
    "lastSeenMessageCreatedAt"
  );
  if (!lastSeenMessageCreatedAt.ok) return lastSeenMessageCreatedAt;
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      lastSeenMessageId: lastSeenMessageId.value,
      lastSeenMessageCreatedAt: lastSeenMessageCreatedAt.value,
    },
  };
}

export type AssignBody = {
  conversationId: string;
  assigneeUserId: string;
  expectedLockVersion: number;
};

export function parseAssignBody(body: unknown): DtoResult<AssignBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "assigneeUserId",
    "expectedLockVersion",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  const assigneeUserId = requireNonEmptyString(
    rec.assigneeUserId,
    "assigneeUserId"
  );
  if (!assigneeUserId.ok) return assigneeUserId;
  const expectedLockVersion = requireInt(
    rec.expectedLockVersion,
    "expectedLockVersion",
    { min: 0 }
  );
  if (!expectedLockVersion.ok) return expectedLockVersion;
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      assigneeUserId: assigneeUserId.value,
      expectedLockVersion: expectedLockVersion.value,
    },
  };
}

export type UnassignBody = {
  conversationId: string;
  expectedLockVersion: number;
};

export function parseUnassignBody(body: unknown): DtoResult<UnassignBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "expectedLockVersion",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  const expectedLockVersion = requireInt(
    rec.expectedLockVersion,
    "expectedLockVersion",
    { min: 0 }
  );
  if (!expectedLockVersion.ok) return expectedLockVersion;
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      expectedLockVersion: expectedLockVersion.value,
    },
  };
}

export type StatusBody = {
  conversationId: string;
  status: WhatsAppInboxConversationStatus;
  expectedLockVersion: number;
};

export function parseStatusBody(body: unknown): DtoResult<StatusBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "status",
    "expectedLockVersion",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  if (
    typeof rec.status !== "string" ||
    !(WHATSAPP_INBOX_CONVERSATION_STATUSES as readonly string[]).includes(
      rec.status
    )
  ) {
    return {
      ok: false,
      message: `status must be one of: ${WHATSAPP_INBOX_CONVERSATION_STATUSES.join(", ")}`,
      field: "status",
    };
  }
  const expectedLockVersion = requireInt(
    rec.expectedLockVersion,
    "expectedLockVersion",
    { min: 0 }
  );
  if (!expectedLockVersion.ok) return expectedLockVersion;
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      status: rec.status as WhatsAppInboxConversationStatus,
      expectedLockVersion: expectedLockVersion.value,
    },
  };
}

export type CrmLinkBody = {
  conversationId: string;
  linkedEntityType: WhatsAppCrmLinkEntityType;
  linkedEntityId: string;
  replaceExisting?: boolean;
};

export function parseCrmLinkBody(body: unknown): DtoResult<CrmLinkBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, [
    "conversationId",
    "linkedEntityType",
    "linkedEntityId",
    "replaceExisting",
  ]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  if (
    typeof rec.linkedEntityType !== "string" ||
    !(WHATSAPP_CRM_LINK_ENTITY_TYPES as readonly string[]).includes(
      rec.linkedEntityType
    )
  ) {
    return {
      ok: false,
      message: `linkedEntityType must be one of: ${WHATSAPP_CRM_LINK_ENTITY_TYPES.join(", ")}`,
      field: "linkedEntityType",
    };
  }
  const linkedEntityId = requireNonEmptyString(
    rec.linkedEntityId,
    "linkedEntityId"
  );
  if (!linkedEntityId.ok) return linkedEntityId;
  const replace =
    rec.replaceExisting == null ? undefined : parseBool(rec.replaceExisting);
  if (rec.replaceExisting != null && replace === undefined) {
    return {
      ok: false,
      message: "replaceExisting must be a boolean",
      field: "replaceExisting",
    };
  }
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      linkedEntityType: rec.linkedEntityType as WhatsAppCrmLinkEntityType,
      linkedEntityId: linkedEntityId.value,
      replaceExisting: replace,
    },
  };
}

export type CreateLeadBody = {
  conversationId: string;
  forceCreate?: boolean;
};

export function parseCreateLeadBody(body: unknown): DtoResult<CreateLeadBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, ["conversationId", "forceCreate"]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  const force =
    rec.forceCreate == null ? undefined : parseBool(rec.forceCreate);
  if (rec.forceCreate != null && force === undefined) {
    return {
      ok: false,
      message: "forceCreate must be a boolean",
      field: "forceCreate",
    };
  }
  return {
    ok: true,
    value: {
      conversationId: conversationId.value,
      forceCreate: force,
    },
  };
}

export type ConversationIdBody = {
  conversationId: string;
};

export function parseConversationIdBody(
  body: unknown
): DtoResult<ConversationIdBody> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, message: "JSON body is required" };
  const unknown = rejectUnknownKeys(rec, ["conversationId"]);
  if (unknown) return unknown;
  const conversationId = requireNonEmptyString(
    rec.conversationId,
    "conversationId"
  );
  if (!conversationId.ok) return conversationId;
  return { ok: true, value: { conversationId: conversationId.value } };
}

export function parseConversationIdParam(
  value: unknown
): DtoResult<string> {
  return requireNonEmptyString(value, "conversationId");
}
