/**
 * WhatsApp Web contact + history sync contracts (Baileys-backed).
 * Source APIs are abstracted — tests inject fakes; production uses Baileys events.
 */

export const WHATSAPP_WEB_SYNC_WINDOW_DAYS = 7;
export const WHATSAPP_WEB_SYNC_MESSAGE_LIMIT_PER_CHAT = 80;
export const WHATSAPP_WEB_SYNC_CHAT_CONCURRENCY = 2;
export const WHATSAPP_WEB_SYNC_CHAT_BATCH_SIZE = 10;
/** Bounded Baileys on-demand history request size (not unlimited). */
export const WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT = 50;
/** Max wait for a matching messaging-history.set after on-demand request. */
export const WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS = 2500;

export type WhatsAppWebHistoryCoverage =
  | "unknown"
  | "empty"
  | "available_only"
  | "partial";

export type WhatsAppWebHistoryCoverageMeta = {
  sourceReady: boolean;
  coverage: WhatsAppWebHistoryCoverage;
  providerHistoryEventObserved: boolean;
  oldestAvailableAt: string | null;
  newestAvailableAt: string | null;
  onDemandHistorySupported: boolean;
};

export type WhatsAppContactNameSource =
  | "manual"
  | "whatsapp_saved"
  | "whatsapp_push"
  | "whatsapp_short"
  | "phone";

export const WHATSAPP_CONTACT_NAME_SOURCE_RANK: Record<
  WhatsAppContactNameSource,
  number
> = {
  manual: 50,
  whatsapp_saved: 40,
  whatsapp_push: 30,
  whatsapp_short: 20,
  phone: 10,
};

export type WhatsAppWebSyncContact = {
  jid: string;
  phoneE164: string;
  savedName: string | null;
  pushName: string | null;
  shortName: string | null;
  isBusiness: boolean;
};

export type WhatsAppWebSyncChat = {
  jid: string;
  phoneE164: string | null;
  name: string | null;
  isGroup: boolean;
  isStatusOrBroadcast: boolean;
  isChannel: boolean;
};

export type WhatsAppWebSyncMessage = {
  providerMessageId: string;
  chatJid: string;
  fromMe: boolean;
  text: string | null;
  messageType: string;
  /** Authoritative WhatsApp timestamp (ISO). */
  occurredAt: string;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
};

export type WhatsAppWebSyncSource = {
  isConnected: () => boolean;
  getSelfJid: () => string | null;
  listContacts: () => Promise<WhatsAppWebSyncContact[]>;
  listChats: () => Promise<WhatsAppWebSyncChat[]>;
  fetchMessages: (
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ) => Promise<WhatsAppWebSyncMessage[]>;
  /** Optional: truthfully report what history the session actually has. */
  getHistoryCoverageMeta?: (
    windowStartMs: number
  ) => WhatsAppWebHistoryCoverageMeta;
  /** Optional: bounded Baileys on-demand history request. */
  requestBoundedHistory?: (
    chatJid: string,
    opts?: { limit: number; waitMs?: number }
  ) => Promise<boolean>;
};

export type WhatsAppWebSyncJobStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed";

export type WhatsAppWebSyncJobSnapshot = {
  jobId: string | null;
  status: WhatsAppWebSyncJobStatus;
  contactsDiscovered: number;
  contactsCreated: number;
  contactsUpdated: number;
  chatsInspected: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  messagesImported: number;
  duplicatesSkipped: number;
  failedChats: number;
  startedAt: string | null;
  completedAt: string | null;
  /** Safe, non-PII error summary for admins. */
  errorSummary: string | null;
  windowDays: number;
  /** True when the session had any usable history cache/events. */
  historySourceReady: boolean;
  /**
   * Never "complete" — companion sessions only guarantee available history.
   * empty / available_only / partial / unknown.
   */
  historyCoverage: WhatsAppWebHistoryCoverage;
  historyProviderEventObserved: boolean;
  historyOldestAvailableAt: string | null;
  historyNewestAvailableAt: string | null;
  historyOnDemandSupported: boolean;
};

export function emptySyncJobSnapshot(): WhatsAppWebSyncJobSnapshot {
  return {
    jobId: null,
    status: "idle",
    contactsDiscovered: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    chatsInspected: 0,
    conversationsCreated: 0,
    conversationsUpdated: 0,
    messagesImported: 0,
    duplicatesSkipped: 0,
    failedChats: 0,
    startedAt: null,
    completedAt: null,
    errorSummary: null,
    windowDays: WHATSAPP_WEB_SYNC_WINDOW_DAYS,
    historySourceReady: false,
    historyCoverage: "unknown",
    historyProviderEventObserved: false,
    historyOldestAvailableAt: null,
    historyNewestAvailableAt: null,
    historyOnDemandSupported: false,
  };
}

export function resolveWhatsAppDisplayName(input: {
  savedName?: string | null;
  pushName?: string | null;
  shortName?: string | null;
  phoneE164: string;
}): { name: string; source: WhatsAppContactNameSource } {
  const saved = String(input.savedName || "").trim();
  if (saved) return { name: saved, source: "whatsapp_saved" };
  const push = String(input.pushName || "").trim();
  if (push) return { name: push, source: "whatsapp_push" };
  const short = String(input.shortName || "").trim();
  if (short) return { name: short, source: "whatsapp_short" };
  const phone = String(input.phoneE164 || "").trim() || "Unknown";
  return { name: phone, source: "phone" };
}

/**
 * Upgrade-only name policy — never replace a stronger/manual name.
 * Legacy populated profile_name with null/unknown name_source is treated as
 * manual (conservative) unless provenance is explicitly proven.
 */
export function shouldApplyWhatsAppContactName(input: {
  existingName: string | null | undefined;
  existingSource: WhatsAppContactNameSource | null | undefined;
  nextName: string;
  nextSource: WhatsAppContactNameSource;
}): boolean {
  const existing = String(input.existingName || "").trim();
  if (!existing) return Boolean(String(input.nextName || "").trim());
  const existingSource =
    input.existingSource &&
    input.existingSource in WHATSAPP_CONTACT_NAME_SOURCE_RANK
      ? input.existingSource
      : "manual";
  const existingRank = WHATSAPP_CONTACT_NAME_SOURCE_RANK[existingSource] ?? 50;
  const nextRank = WHATSAPP_CONTACT_NAME_SOURCE_RANK[input.nextSource] ?? 0;
  return nextRank > existingRank;
}

export function isEligibleSyncChat(
  chat: WhatsAppWebSyncChat,
  selfJid: string | null
): boolean {
  if (chat.isGroup || chat.isStatusOrBroadcast || chat.isChannel) return false;
  if (!chat.phoneE164) return false;
  if (selfJid && normalizeJid(chat.jid) === normalizeJid(selfJid)) return false;
  return true;
}

export function isEligibleSyncContact(
  contact: WhatsAppWebSyncContact,
  selfJid: string | null
): boolean {
  if (!contact.phoneE164) return false;
  if (selfJid && normalizeJid(contact.jid) === normalizeJid(selfJid)) {
    return false;
  }
  const jid = normalizeJid(contact.jid);
  if (jid.endsWith("@g.us")) return false;
  if (jid === "status@broadcast" || jid.includes("broadcast")) return false;
  if (jid.endsWith("@newsletter")) return false;
  return true;
}

export function normalizeJid(jid: string): string {
  const bare = String(jid || "").trim();
  const [userHost] = bare.split("/");
  const [user, host] = String(userHost || "").split("@");
  const userPart = String(user || "").split(":")[0] || "";
  return host ? `${userPart}@${host}` : userPart;
}

export function syncWindowStartMs(
  nowMs: number,
  days = WHATSAPP_WEB_SYNC_WINDOW_DAYS
): number {
  return nowMs - days * 24 * 60 * 60 * 1000;
}
