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
/**
 * Deterministic per-chat in-memory cache cap for backfill bodies.
 * Aligns with the 50-message on-demand/import policy.
 */
export const WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT =
  WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT;
/** Max wait for a matching messaging-history.set after on-demand request. */
export const WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS = 2500;

/**
 * Baileys 6.7.23 `shouldSyncHistoryMessage` only decides whether a
 * HistorySyncNotification type is accepted for processing. It cannot filter
 * individual messages by age or enforce a seven-day bound. Window/cap
 * enforcement is applied at sync-source ingestion in this module.
 */

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

/**
 * Provenance for whatsapp_contacts.profile_name.
 * `phone` is deprecated (never store phone digits as profile_name).
 * `whatsapp_legacy` is an effective rank for nonempty profile_name + null name_source
 * (not written by SYNC-14B unless a migration allows it).
 */
export type WhatsAppContactNameSource =
  | "manual"
  | "whatsapp_verified"
  | "whatsapp_saved"
  | "whatsapp_legacy"
  | "whatsapp_push"
  | "whatsapp_short"
  | "phone";

/** Higher rank wins. Explicit manual is protected separately and never auto-overwritten. */
export const WHATSAPP_CONTACT_NAME_SOURCE_RANK: Record<
  WhatsAppContactNameSource,
  number
> = {
  manual: 100,
  whatsapp_verified: 50,
  whatsapp_saved: 40,
  whatsapp_legacy: 35,
  whatsapp_push: 30,
  whatsapp_short: 20,
  phone: 10,
};

export type WhatsAppWebSyncContact = {
  jid: string;
  phoneE164: string;
  savedName: string | null;
  /** Baileys Contact.verifiedName — never folded into push/notify. */
  verifiedName: string | null;
  pushName: string | null;
  shortName: string | null;
  /**
   * Business flag from provider proof.
   * `null` = absent on this event — persistence must preserve existing DB/memory value.
   */
  isBusiness: boolean | null;
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

/** Explicit terminal outcomes — zero-import is never ordinary success. */
export type WhatsAppWebSyncOutcome =
  | "completed_with_imports"
  | "completed_no_changes"
  | "history_not_available"
  | "partial"
  | "failed"
  | null;

export type WhatsAppWebHistoryAvailability =
  | "ready"
  | "empty_companion_cache"
  | "history_not_available"
  | "partially_available"
  | "unknown";

export type WhatsAppWebSyncJobSnapshot = {
  jobId: string | null;
  status: WhatsAppWebSyncJobStatus;
  /** Terminal outcome for durable/UI honesty. */
  outcome: WhatsAppWebSyncOutcome;
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
  historyAvailability: WhatsAppWebHistoryAvailability;
  historyProviderEventObserved: boolean;
  historyOldestAvailableAt: string | null;
  historyNewestAvailableAt: string | null;
  historyOnDemandSupported: boolean;
  /** True when cancel/disconnect interrupted the job. */
  cancelled: boolean;
  /**
   * Non-PII warning when durable Supabase persistence failed and only
   * in-memory fallback retained the latest result.
   */
  durabilityWarning: string | null;
};

export function emptySyncJobSnapshot(): WhatsAppWebSyncJobSnapshot {
  return {
    jobId: null,
    status: "idle",
    outcome: null,
    contactsDiscovered: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    contactsSkipped: 0,
    chatsInspected: 0,
    conversationsCreated: 0,
    conversationsUpdated: 0,
    messagesDiscovered: 0,
    messagesImported: 0,
    duplicatesSkipped: 0,
    messagesSkipped: 0,
    failedChats: 0,
    startedAt: null,
    completedAt: null,
    errorSummary: null,
    windowDays: WHATSAPP_WEB_SYNC_WINDOW_DAYS,
    historySourceReady: false,
    historyCoverage: "unknown",
    historyAvailability: "unknown",
    historyProviderEventObserved: false,
    historyOldestAvailableAt: null,
    historyNewestAvailableAt: null,
    historyOnDemandSupported: false,
    cancelled: false,
    durabilityWarning: null,
  };
}

export function deriveSyncOutcome(
  snapshot: WhatsAppWebSyncJobSnapshot
): WhatsAppWebSyncOutcome {
  if (snapshot.status === "failed") return "failed";
  if (snapshot.status !== "completed") return null;

  const importedOrUpdated =
    snapshot.messagesImported > 0 ||
    snapshot.contactsCreated > 0 ||
    snapshot.contactsUpdated > 0 ||
    snapshot.conversationsCreated > 0 ||
    snapshot.conversationsUpdated > 0 ||
    snapshot.duplicatesSkipped > 0;

  if (snapshot.cancelled) {
    if (importedOrUpdated || snapshot.failedChats > 0) return "partial";
    return "history_not_available";
  }

  if (snapshot.failedChats > 0 && snapshot.messagesImported > 0) return "partial";
  if (
    snapshot.historyAvailability === "empty_companion_cache" ||
    snapshot.historyAvailability === "history_not_available" ||
    (snapshot.contactsDiscovered === 0 &&
      snapshot.messagesDiscovered === 0 &&
      snapshot.messagesImported === 0 &&
      !snapshot.historySourceReady)
  ) {
    return "history_not_available";
  }
  if (snapshot.messagesImported > 0 || snapshot.contactsCreated > 0) {
    return "completed_with_imports";
  }
  if (
    snapshot.contactsUpdated > 0 ||
    snapshot.duplicatesSkipped > 0 ||
    snapshot.conversationsUpdated > 0
  ) {
    return "completed_no_changes";
  }
  if (snapshot.failedChats > 0) return "partial";
  return "history_not_available";
}

/** Group/status/broadcast/newsletter chats are never individual sync targets. */
export function isExcludedSyncRemoteJid(jid: string): boolean {
  const n = normalizeJid(jid);
  if (!n) return true;
  if (n.endsWith("@g.us")) return true;
  if (n === "status@broadcast" || n.includes("broadcast")) return true;
  if (n.endsWith("@newsletter")) return true;
  return false;
}

/**
 * Normalize/validate a candidate display name. Returns null when unsafe or blank.
 * Phone digits are never accepted as a profile name (phone is a UI fallback only).
 */
export function isValidWhatsAppDisplayName(
  raw: string | null | undefined,
  phoneE164?: string | null
): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  if (
    lower.includes("@s.whatsapp.net") ||
    lower.includes("@lid") ||
    lower.includes("@g.us") ||
    lower.includes("@newsletter") ||
    lower.includes("broadcast")
  ) {
    return null;
  }
  if (name.includes("@")) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) return null;
  if (/^Contact\s*·/i.test(name)) return null;
  if (/^\+?\d{6,}$/.test(name)) return null;
  const phoneDigits = String(phoneE164 ?? "").replace(/\D/g, "");
  const nameDigits = name.replace(/\D/g, "");
  if (phoneDigits && nameDigits && nameDigits === phoneDigits) return null;
  return name;
}

export type ResolvedWhatsAppDisplayName = {
  name: string | null;
  source: WhatsAppContactNameSource | null;
};

/**
 * Select the strongest valid WhatsApp name candidate.
 * Phone is intentionally not a profile_name candidate.
 */
export function resolveWhatsAppDisplayName(input: {
  verifiedName?: string | null;
  savedName?: string | null;
  pushName?: string | null;
  shortName?: string | null;
  phoneE164?: string | null;
}): ResolvedWhatsAppDisplayName {
  const phone = input.phoneE164 ?? null;
  const verified = isValidWhatsAppDisplayName(input.verifiedName, phone);
  if (verified) return { name: verified, source: "whatsapp_verified" };
  const saved = isValidWhatsAppDisplayName(input.savedName, phone);
  if (saved) return { name: saved, source: "whatsapp_saved" };
  const push = isValidWhatsAppDisplayName(input.pushName, phone);
  if (push) return { name: push, source: "whatsapp_push" };
  const short = isValidWhatsAppDisplayName(input.shortName, phone);
  if (short) return { name: short, source: "whatsapp_short" };
  return { name: null, source: null };
}

/**
 * Effective ranking source for an existing stored name.
 * - explicit manual stays protected
 * - nonempty + null provenance → whatsapp_legacy (not manual)
 * - deprecated phone provenance remains weakest WhatsApp tier
 */
export function effectiveWhatsAppContactNameSource(
  existingName: string | null | undefined,
  existingSource: string | null | undefined
): WhatsAppContactNameSource | null {
  const name = String(existingName ?? "").trim();
  if (!name) return null;
  if (existingSource === "manual") return "manual";
  if (
    existingSource &&
    Object.prototype.hasOwnProperty.call(
      WHATSAPP_CONTACT_NAME_SOURCE_RANK,
      existingSource
    )
  ) {
    return existingSource as WhatsAppContactNameSource;
  }
  return "whatsapp_legacy";
}

/**
 * Upgrade-only name policy shared by memory, Supabase, sync, and contact events.
 */
export function shouldApplyWhatsAppContactName(input: {
  existingName: string | null | undefined;
  existingSource: WhatsAppContactNameSource | string | null | undefined;
  nextName: string | null | undefined;
  nextSource: WhatsAppContactNameSource | null | undefined;
  phoneE164?: string | null;
}): boolean {
  const next = isValidWhatsAppDisplayName(input.nextName, input.phoneE164);
  if (!next || !input.nextSource) return false;
  if (input.nextSource === "manual") {
    // Automatic paths never claim manual; only explicit manual writers set it.
    return false;
  }
  if (input.nextSource === "phone" || input.nextSource === "whatsapp_legacy") {
    // phone/legacy are not winning write sources from automatic capture.
    return false;
  }

  const existing = String(input.existingName ?? "").trim();
  if (!existing) return true;

  const existingSource = effectiveWhatsAppContactNameSource(
    existing,
    input.existingSource
  );
  if (existingSource === "manual") return false;

  const existingRank =
    WHATSAPP_CONTACT_NAME_SOURCE_RANK[existingSource ?? "whatsapp_legacy"] ?? 0;
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
