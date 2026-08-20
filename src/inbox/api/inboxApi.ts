import { authorizedFetch } from "../../services/api";
import {
  InboxClientError,
  type InboxAiDraftOutcome,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxCrmLink,
  type InboxListFilters,
  type InboxListPage,
  type InboxMessage,
  type InboxMessagesPage,
  type InboxConversationStatus,
  type InboxAiDraftConfigStatus,
  type WhatsAppConnectionStatusPayload,
  type WhatsAppConnectionTestResult,
  type WhatsAppOnboardingDiagnostics,
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
  const quick =
    filters.quickFilter ??
    (filters.unreadOnly ? ("unread" as const) : undefined);
  return toQuery({
    status: filters.status || undefined,
    assignedTo: filters.assignedTo || undefined,
    hasFailedMessage:
      filters.hasFailedMessage === true
        ? "true"
        : filters.hasFailedMessage === false
          ? "false"
          : undefined,
    quickFilter: quick && quick !== "all" ? quick : undefined,
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
    totalUnreadCount:
      typeof meta?.totalUnreadCount === "number"
        ? meta.totalUnreadCount
        : undefined,
  };
}

export async function fetchInboxDelta(
  filters: InboxListFilters,
  since: { sinceAt: string; sinceId: string },
  opts?: { limit?: number }
): Promise<InboxListPage> {
  const quick =
    filters.quickFilter ??
    (filters.unreadOnly ? ("unread" as const) : undefined);
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
      quickFilter: quick && quick !== "all" ? quick : undefined,
      sinceAt: since.sinceAt,
      sinceId: since.sinceId,
      limit: opts?.limit != null ? String(opts.limit) : undefined,
    })}`
  );
  return {
    conversations: data.conversations ?? [],
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
    totalUnreadCount:
      typeof meta?.totalUnreadCount === "number"
        ? meta.totalUnreadCount
        : undefined,
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

/**
 * AI-03: request a human-reviewed draft. Never sends a WhatsApp message.
 * Separate from sendInboxMessage — callers must not auto-send the result.
 */
export async function generateInboxAiDraft(input: {
  conversationId: string;
  /** Preferred: server loads stored text for this message under the conversation. */
  messageId?: string;
  /** Ignored by server for generation context; kept for backward-compatible clients. */
  messageText?: string;
  locale?: string;
}): Promise<InboxAiDraftOutcome> {
  const { conversationId, messageId, messageText, locale } = input;
  const body: Record<string, string> = {};
  if (messageId) body.messageId = messageId;
  if (messageText) body.messageText = messageText;
  if (locale) body.locale = locale;
  try {
    const { data } = await inboxRequest<InboxAiDraftOutcome>(
      `/api/inbox/conversations/${encodeURIComponent(conversationId)}/ai-draft`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return data;
  } catch (err) {
    // Denied outcomes may arrive as error envelopes with draft metadata.
    if (err instanceof InboxClientError && err.details?.status === "denied") {
      return {
        status: "denied",
        companyId: String(err.details.companyId ?? ""),
        conversationId,
        reasonCode: err.code,
        message: err.message,
        requiresHumanReview: true,
        autoSendBlocked: true,
        escalate: true,
        escalationReasons: Array.isArray(err.details.escalationReasons)
          ? (err.details.escalationReasons as string[])
          : [err.code],
      };
    }
    throw err;
  }
}

/** Booleans-only AI draft configuration status (never secrets). */
export async function fetchInboxAiDraftConfig(): Promise<InboxAiDraftConfigStatus> {
  const { data } = await inboxRequest<InboxAiDraftConfigStatus>(
    "/api/inbox/ai-draft/config"
  );
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

export async function fetchEmbeddedSignupState(): Promise<{ state: string }> {
  const { data } = await inboxRequest<{ state: string }>(
    "/api/inbox/admin/whatsapp/embedded-signup/state",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

export async function submitEmbeddedSignup(input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  state: string;
  businessId?: string;
}): Promise<WhatsAppConnectionStatusPayload> {
  const { data } = await inboxRequest<WhatsAppConnectionStatusPayload>(
    "/api/inbox/admin/whatsapp/embedded-signup",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data;
}

export async function disconnectWhatsAppConnection(): Promise<WhatsAppConnectionStatusPayload> {
  const { data } = await inboxRequest<WhatsAppConnectionStatusPayload>(
    "/api/inbox/admin/whatsapp/disconnect",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

export async function fetchWhatsAppOnboardingDiagnostics(): Promise<WhatsAppOnboardingDiagnostics> {
  const { data } = await inboxRequest<WhatsAppOnboardingDiagnostics>(
    "/api/inbox/admin/whatsapp/diagnostics",
    { method: "GET" }
  );
  return data;
}

export async function testWhatsAppConnection(): Promise<WhatsAppConnectionTestResult> {
  const { data } = await inboxRequest<WhatsAppConnectionTestResult>(
    "/api/inbox/admin/whatsapp/test-connection",
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
  return data;
}

/** WhatsApp Web QR (Baileys) — Admin-only; never returns session credentials. */
export type WhatsAppWebSafeStatus = {
  enabled: boolean;
  state:
    | "DISCONNECTED"
    | "QR_READY"
    | "CONNECTING"
    | "CONNECTED"
    | "RECONNECTING"
    | "LOGGED_OUT"
    | "ERROR";
  phoneMasked: string | null;
  updatedAt: string;
  qrAvailable: boolean;
  qrExpiresAt: string | null;
  safeMessage: string | null;
  /** Privacy-safe inbound ops diagnostics (codes/timestamps only). */
  lastRawUpsertAt?: string | null;
  lastInboundEventAt?: string | null;
  lastInboundStoredAt?: string | null;
  lastIgnoredAt?: string | null;
  lastIgnoredReason?: string | null;
  lastPersistFailureAt?: string | null;
  lastPersistFailureCode?: string | null;
  socketOpen?: boolean;
  inboundListenerAttached?: boolean;
  inboundListenerOperational?: boolean;
  activeSocketGeneration?: number;
  activeSessionKey?: string;
  reconnectScheduled?: boolean;
  reconnectAttemptInProgress?: boolean;
  reconnectAttempt?: number;
  lastDisconnectClassification?: string | null;
  credentialsAvailable?: boolean;
  processInstanceId?: string;
  processPid?: number;
  hostHash?: string | null;
  lastConnectionUpdateAt?: string | null;
  lastConnectionState?: string | null;
  lastConnectionReason?: string | null;
  lastCredentialsUpdateAt?: string | null;
  authenticatedUserJidHash?: string | null;
  socketCreatedAt?: string | null;
  sessionLeaseStatus?: string | null;
  sessionLeaseOwnerMatch?: boolean;
  sessionLeaseOwnerId?: string | null;
  sessionLeaseFencingTokenHash?: string | null;
  sessionLeaseAcquiredAt?: string | null;
  sessionLeaseHeartbeatAt?: string | null;
  credentialsFilePresent?: boolean | null;
  authKeyFileCount?: number | null;
  listeningSilent?: boolean;
  inboundHealth?:
    | "CONNECTED_SOCKET"
    | "LISTENER_READY"
    | "LIVE_INBOUND_CONFIRMED"
    | "INBOUND_SILENT"
    | "LEASE_NOT_OWNED";
  servingProcessInstanceId?: string;
  ownerProcessInstanceId?: string | null;
  fencingVersion?: number | null;
  buildIdentity?: string | null;
  durableOwnerMatch?: boolean;
  leaseRetryGuidance?: string | null;
};

export type WhatsAppWebQrPayload = {
  qrDataUrl: string;
  expiresAt: string;
  state: WhatsAppWebSafeStatus["state"];
};

export async function fetchWhatsAppWebStatus(): Promise<WhatsAppWebSafeStatus> {
  const { data } = await inboxRequest<WhatsAppWebSafeStatus>(
    "/api/whatsapp-web/status",
    { method: "GET" }
  );
  return data;
}

export async function connectWhatsAppWeb(): Promise<WhatsAppWebSafeStatus> {
  const { data } = await inboxRequest<WhatsAppWebSafeStatus>(
    "/api/whatsapp-web/connect",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

export async function fetchWhatsAppWebQr(): Promise<WhatsAppWebQrPayload> {
  const { data } = await inboxRequest<WhatsAppWebQrPayload>(
    "/api/whatsapp-web/qr",
    { method: "GET" }
  );
  return data;
}

export async function disconnectWhatsAppWeb(): Promise<WhatsAppWebSafeStatus> {
  const { data } = await inboxRequest<WhatsAppWebSafeStatus>(
    "/api/whatsapp-web/disconnect",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

export async function logoutWhatsAppWeb(): Promise<WhatsAppWebSafeStatus> {
  const { data } = await inboxRequest<WhatsAppWebSafeStatus>(
    "/api/whatsapp-web/logout",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

/** Admin contact sync + available-history backfill job snapshot. */
export type WhatsAppWebSyncJobSnapshot = {
  jobId: string | null;
  status: "idle" | "starting" | "running" | "completed" | "failed";
  outcome:
    | "completed_with_imports"
    | "completed_no_changes"
    | "history_not_available"
    | "partial"
    | "failed"
    | null;
  contactsDiscovered: number;
  contactsCreated: number;
  contactsUpdated: number;
  contactsSkipped: number;
  chatsInspected: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  messagesDiscovered: number;
  messagesImported: number;
  duplicatesSkipped: number;
  messagesSkipped: number;
  failedChats: number;
  startedAt: string | null;
  completedAt: string | null;
  errorSummary: string | null;
  windowDays: number;
  joinedExisting?: boolean;
  historySourceReady: boolean;
  historyCoverage: "unknown" | "empty" | "available_only" | "partial";
  historyAvailability:
    | "ready"
    | "empty_companion_cache"
    | "history_not_available"
    | "partially_available"
    | "unknown";
  historyProviderEventObserved: boolean;
  historyOldestAvailableAt: string | null;
  historyNewestAvailableAt: string | null;
  historyOnDemandSupported: boolean;
  cancelled?: boolean;
  durabilityWarning?: string | null;
};

export async function startWhatsAppWebHistorySync(): Promise<WhatsAppWebSyncJobSnapshot> {
  const { data } = await inboxRequest<WhatsAppWebSyncJobSnapshot>(
    "/api/whatsapp-web/sync",
    { method: "POST", body: JSON.stringify({}) }
  );
  return data;
}

export async function fetchWhatsAppWebHistorySync(): Promise<WhatsAppWebSyncJobSnapshot> {
  const { data } = await inboxRequest<WhatsAppWebSyncJobSnapshot>(
    "/api/whatsapp-web/sync",
    { method: "GET" }
  );
  return data;
}
