import { authorizedFetch } from "../../services/api";
import {
  InboxClientError,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxCrmLink,
  type InboxListFilters,
  type InboxListPage,
  type InboxMessage,
  type InboxMessagesPage,
  type InboxConversationStatus,
  type WhatsAppConnectionStatusPayload,
} from "../types";

type Envelope<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | {
      success: false;
      error: { code: string; message: string; details?: Record<string, unknown> };
    };

async function inboxRequest<T>(
  path: string,
  init?: RequestInit
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const res = await authorizedFetch(path, init);
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new InboxClientError(res.status, {
      code: "invalid_response",
      message: "Inbox API returned a non-JSON response",
    });
  }
  if (!body || typeof body !== "object") {
    throw new InboxClientError(res.status, {
      code: "invalid_response",
      message: "Inbox API returned an empty response",
    });
  }
  if (body.success !== true) {
    const err = (body as { error: { code: string; message: string; details?: Record<string, unknown> } })
      .error;
    throw new InboxClientError(res.status, err);
  }
  return { data: body.data, meta: body.meta };
}

function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function buildListQuery(
  filters: InboxListFilters,
  opts?: { cursor?: string | null; limit?: number }
): string {
  return toQuery({
    status: filters.status || undefined,
    assignedTo: filters.assignedTo || undefined,
    hasFailedMessage:
      filters.hasFailedMessage === true
        ? "true"
        : filters.hasFailedMessage === false
          ? "false"
          : undefined,
    cursor: opts?.cursor || undefined,
    limit: opts?.limit != null ? String(opts.limit) : undefined,
  });
}

export async function fetchInboxConversations(
  filters: InboxListFilters,
  opts?: { cursor?: string | null; limit?: number }
): Promise<InboxListPage> {
  const { data, meta } = await inboxRequest<{
    conversations: InboxConversation[];
  }>(`/api/inbox/conversations${buildListQuery(filters, opts)}`);
  return {
    conversations: data.conversations ?? [],
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
  };
}

export async function fetchInboxDelta(
  filters: InboxListFilters,
  since: { sinceAt: string; sinceId: string },
  opts?: { limit?: number }
): Promise<InboxListPage> {
  const { data, meta } = await inboxRequest<{
    conversations: InboxConversation[];
  }>(
    `/api/inbox/delta${toQuery({
      status: filters.status || undefined,
      assignedTo: filters.assignedTo || undefined,
      hasFailedMessage:
        filters.hasFailedMessage === true
          ? "true"
          : filters.hasFailedMessage === false
            ? "false"
            : undefined,
      sinceAt: since.sinceAt,
      sinceId: since.sinceId,
      limit: opts?.limit != null ? String(opts.limit) : undefined,
    })}`
  );
  return {
    conversations: data.conversations ?? [],
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
  };
}

export async function fetchInboxConversation(
  conversationId: string
): Promise<InboxConversationDetail> {
  const { data } = await inboxRequest<InboxConversationDetail>(
    `/api/inbox/conversations/${encodeURIComponent(conversationId)}`
  );
  return data;
}

export async function fetchInboxMessages(
  conversationId: string,
  opts?: { before?: string | null; limit?: number }
): Promise<InboxMessagesPage> {
  const { data, meta } = await inboxRequest<{ messages: InboxMessage[] }>(
    `/api/inbox/conversations/${encodeURIComponent(conversationId)}/messages${toQuery(
      {
        before: opts?.before || undefined,
        limit: opts?.limit != null ? String(opts.limit) : undefined,
      }
    )}`
  );
  return {
    messages: data.messages ?? [],
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
  };
}

export async function sendInboxMessage(input: {
  conversationId: string;
  text: string;
  idempotencyKey: string;
}): Promise<{
  state: string;
  messageId?: string | null;
  error?: string | null;
  replay: boolean;
}> {
  const { data } = await inboxRequest<{
    state: string;
    messageId?: string | null;
    error?: string | null;
    replay: boolean;
  }>("/api/inbox/messages/send", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function markInboxRead(input: {
  conversationId: string;
  lastSeenMessageId: string;
  lastSeenMessageCreatedAt: string;
}): Promise<unknown> {
  const { data } = await inboxRequest("/api/inbox/messages/read", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function assignInboxConversation(input: {
  conversationId: string;
  assigneeUserId: string;
  expectedLockVersion: number;
}): Promise<InboxConversation> {
  const { data } = await inboxRequest<{ conversation: InboxConversation }>(
    "/api/inbox/assign",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.conversation;
}

export async function unassignInboxConversation(input: {
  conversationId: string;
  expectedLockVersion: number;
}): Promise<InboxConversation> {
  const { data } = await inboxRequest<{ conversation: InboxConversation }>(
    "/api/inbox/unassign",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.conversation;
}

export async function updateInboxStatus(input: {
  conversationId: string;
  status: InboxConversationStatus;
  expectedLockVersion: number;
}): Promise<InboxConversation> {
  const { data } = await inboxRequest<{ conversation: InboxConversation }>(
    "/api/inbox/status",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.conversation;
}

export async function createInboxLead(input: {
  conversationId: string;
  forceCreate?: boolean;
}): Promise<unknown> {
  const { data } = await inboxRequest("/api/inbox/crm/create-lead", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function linkInboxCrm(input: {
  conversationId: string;
  linkedEntityType: "lead" | "customer";
  linkedEntityId: string;
  replaceExisting?: boolean;
}): Promise<InboxCrmLink> {
  const { data } = await inboxRequest<{ link: InboxCrmLink }>(
    "/api/inbox/crm/link",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.link;
}

export async function unlinkInboxCrm(input: {
  conversationId: string;
}): Promise<{ deleted: boolean }> {
  const { data } = await inboxRequest<{ deleted: boolean }>(
    "/api/inbox/crm/link",
    { method: "DELETE", body: JSON.stringify(input) }
  );
  return data;
}

export async function fetchWhatsAppConnectionStatus(): Promise<WhatsAppConnectionStatusPayload> {
  const { data } = await inboxRequest<WhatsAppConnectionStatusPayload>(
    "/api/inbox/admin/whatsapp/connection-status",
    { method: "GET" }
  );
  return data;
}

export async function submitEmbeddedSignup(input: {
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
}): Promise<WhatsAppConnectionStatusPayload> {
  const { data } = await inboxRequest<WhatsAppConnectionStatusPayload>(
    "/api/inbox/admin/whatsapp/embedded-signup",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data;
}
