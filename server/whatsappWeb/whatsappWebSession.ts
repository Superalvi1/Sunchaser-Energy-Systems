/**
 * Single-organization WhatsApp Web (Baileys) connection manager.
 *
 * Lifecycle hardening (QR-1A):
 * - Explicit connectionDesired / manual-stop state
 * - Terminal vs retryable disconnect classification
 * - Capped exponential reconnect (one timer at a time)
 * - Startup resume from saved credentials
 * - QR race + connected-phone resolution on open
 *
 * Credentials stay on disk under WHATSAPP_WEB_AUTH_DIR only.
 */
import QRCode from "qrcode";
import {
  assertWhatsAppWebAuthDirReady,
  readWhatsAppWebConfig,
  WHATSAPP_WEB_QR_CONNECTION_ID,
  WHATSAPP_WEB_QR_TTL_MS,
  type WhatsAppWebConfig,
} from "./whatsappWebConfig.ts";
import {
  deleteWhatsAppWebSessionDir,
  ensureWhatsAppWebAuthDirWritable,
  hasSavedBaileysCredentials,
  resolveWhatsAppWebAuthPaths,
  type ResolvedAuthPaths,
} from "./whatsappWebAuthDir.ts";
import { createSilentBaileysLogger, logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  maskPhoneNumber,
  type WhatsAppWebLifecycleState,
  type WhatsAppWebQrPayload,
  type WhatsAppWebSafeStatus,
} from "./whatsappWebTypes.ts";
import { BaileysInMemorySyncSource } from "./whatsappWebBaileysSyncSource.ts";
import { WhatsAppWebHistorySyncService } from "./whatsappWebHistorySync.ts";
import {
  getWhatsAppWebInboundDiagnostics,
  noteInboundIgnored,
  noteInboundRawUpsert,
  clearWhatsAppWebInboundLiveTimestamps,
} from "./whatsappWebInboundDiagnostics.ts";
import {
  clearProtocolReadinessForNewGeneration,
  getWhatsAppWebConnectionDiagnostics,
  noteAuthenticatedUserJidHash,
  noteConnectionOpenDiagnostic,
  noteConnectionReadiness,
  noteConnectionUpdateDiagnostic,
  noteCredentialsUpdateDiagnostic,
  noteProtocolEvent,
  noteSocketCreatedDiagnostic,
  refreshAuthSessionIntegrity,
} from "./whatsappWebConnectionDiagnostics.ts";
import { getWhatsAppWebProcessInstanceId } from "./whatsappWebProcessIdentity.ts";
import { WhatsAppWebSessionLease } from "./whatsappWebSessionLease.ts";
import { tryCreateWhatsAppWebSessionLeaseSqlStore } from "./whatsappWebSessionLeaseSql.ts";
import {
  getSharedInMemoryWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
  type WhatsAppWebLeaseRow,
  type WhatsAppWebSessionLeaseStore,
} from "./whatsappWebSessionLeaseStore.ts";
import {
  deriveWhatsAppWebInboundHealth,
  getWhatsAppWebBuildIdentity,
  type WhatsAppWebOwnerDiagnosticsStore,
} from "./whatsappWebOwnerDiagnosticsStore.ts";
import { resolveDefaultWhatsAppWebOwnerDiagnosticsStore } from "./whatsappWebOwnerDiagnosticsSql.ts";
import {
  createLeaseNotOwnedError,
  isLeaseRowActive,
  mergeOwnerAwareSafeStatus,
} from "./whatsappWebOwnerControl.ts";
import { getSharedWhatsAppLidPhoneMap } from "./whatsappWebSharedLidMap.ts";
import type {
  WhatsAppWebSyncJobSnapshot,
  WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";

function resolveDefaultSessionLeaseStore(
  env: NodeJS.ProcessEnv
): WhatsAppWebSessionLeaseStore {
  return (
    tryCreateWhatsAppWebSessionLeaseSqlStore(env) ??
    getSharedInMemoryWhatsAppWebSessionLeaseStore()
  );
}

/** Delegates to the active socket sync source (or disconnected stub). */
class SessionBoundSyncSource implements WhatsAppWebSyncSource {
  constructor(
    private readonly getLive: () => WhatsAppWebSyncSource | null
  ) {}

  private live(): WhatsAppWebSyncSource | null {
    return this.getLive();
  }

  isConnected(): boolean {
    return this.live()?.isConnected() ?? false;
  }

  getSelfJid(): string | null {
    return this.live()?.getSelfJid() ?? null;
  }

  listContacts() {
    return this.live()?.listContacts() ?? Promise.resolve([]);
  }

  listChats() {
    return this.live()?.listChats() ?? Promise.resolve([]);
  }

  fetchMessages(
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ) {
    return (
      this.live()?.fetchMessages(chatJid, opts) ?? Promise.resolve([])
    );
  }

  getHistoryCoverageMeta(windowStartMs: number) {
    return (
      this.live()?.getHistoryCoverageMeta?.(windowStartMs) ?? {
        sourceReady: false,
        coverage: "unknown" as const,
        providerHistoryEventObserved: false,
        oldestAvailableAt: null,
        newestAvailableAt: null,
        onDemandHistorySupported: false,
      }
    );
  }

  requestBoundedHistory(
    chatJid: string,
    opts?: { limit: number; waitMs?: number }
  ) {
    return (
      this.live()?.requestBoundedHistory?.(chatJid, opts) ??
      Promise.resolve(false)
    );
  }
}

/** Capped exponential-ish reconnect delays (ms). */
export const WHATSAPP_WEB_RECONNECT_DELAYS_MS = [
  2_000, 5_000, 10_000, 30_000, 60_000,
] as const;

/** Baileys DisconnectReason values we treat as non-retryable. */
export const WHATSAPP_WEB_TERMINAL_STATUS_CODES = new Set<number>([
  401, // loggedOut
  403, // forbidden
  411, // multideviceMismatch
  440, // connectionReplaced
  500, // badSession
]);

export type DisconnectClassification =
  | "logged_out"
  | "terminal"
  | "retryable";

/**
 * Policy classification used for reconnect decisions.
 * Do not change behavior here without proven disconnect evidence.
 */
export function classifyDisconnect(
  statusCode: number | undefined | null
): DisconnectClassification {
  if (statusCode === 401) return "logged_out";
  if (statusCode != null && WHATSAPP_WEB_TERMINAL_STATUS_CODES.has(statusCode)) {
    return "terminal";
  }
  return "retryable";
}

/** Sanitized diagnostic labels for connection_closed logs (not reconnect policy). */
export type DisconnectDiagnosticClassification =
  | "logged_out"
  | "restart_required"
  | "connection_closed"
  | "timed_out"
  | "bad_session"
  | "connection_replaced"
  | "retryable"
  | "unknown";

export function classifyDisconnectDiagnostic(
  statusCode: number | undefined | null
): DisconnectDiagnosticClassification {
  if (statusCode == null || !Number.isFinite(Number(statusCode))) {
    return "unknown";
  }
  switch (Number(statusCode)) {
    case 401:
      return "logged_out";
    case 515:
      return "restart_required";
    case 428:
      return "connection_closed";
    case 408:
      return "timed_out";
    case 500:
      return "bad_session";
    case 440:
      return "connection_replaced";
    default:
      return classifyDisconnect(statusCode) === "retryable"
        ? "retryable"
        : "unknown";
  }
}

export function sanitizeDisconnectStatusCode(
  statusCode: number | undefined | null
): number | null {
  if (statusCode == null) return null;
  const n = Number(statusCode);
  return Number.isFinite(n) ? n : null;
}

/** Fixed-field payload for connection_closed diagnostics — no secrets. */
export function buildConnectionClosedDiagnostic(input: {
  statusCode: number | undefined | null;
  willRetry: boolean;
  nextState: WhatsAppWebLifecycleState;
}): {
  statusCode: number | null;
  classification: DisconnectDiagnosticClassification;
  willRetry: boolean;
  nextState: WhatsAppWebLifecycleState;
} {
  return {
    statusCode: sanitizeDisconnectStatusCode(input.statusCode),
    classification: classifyDisconnectDiagnostic(input.statusCode),
    willRetry: input.willRetry === true,
    nextState: input.nextState,
  };
}

export function terminalDisconnectSafeMessage(
  statusCode: number | undefined | null
): string {
  switch (Number(statusCode)) {
    case 440:
      return "Session replaced by another WhatsApp connection. Admin must reconnect from this CRM.";
    case 500:
      return "Saved WhatsApp session is invalid. Admin must scan a new QR.";
    case 403:
      return "WhatsApp rejected this companion session. Admin must repair linking.";
    case 411:
      return "WhatsApp multi-device mismatch. Admin must repair linking.";
    case 401:
      return "WhatsApp session logged out. Admin must scan a new QR.";
    default:
      return "WhatsApp Web session ended. Admin action required.";
  }
}

export function reconnectDelayMs(
  attemptIndex: number,
  delays: readonly number[] = WHATSAPP_WEB_RECONNECT_DELAYS_MS
): number {
  if (delays.length === 0) return 60_000;
  if (attemptIndex <= 0) return delays[0]!;
  if (attemptIndex >= delays.length) return delays[delays.length - 1]!;
  return delays[attemptIndex]!;
}

export type WhatsAppWebInboundHandler = (
  message: import("./whatsappWebNormalize.ts").BaileysInboundLike
) => Promise<void>;

export type WhatsAppWebConnectionUpdate = {
  connection?: "open" | "close" | "connecting" | "logged_out";
  statusCode?: number;
  /** Resolved at open time — not captured before connect. */
  userId?: string | null;
  /**
   * Baileys readiness fields from connection.update — Phase 1 observability only.
   * Never includes phones, credentials, session keys, or raw errors.
   * All fields are optional; absent means Baileys did not include them.
   */
  receivedPendingNotifications?: boolean | null;
  isOnline?: boolean | null;
  isNewLogin?: boolean | null;
  phoneConnected?: boolean | null;
};

/** Upsert types that may carry live customer inbound (Baileys online/offline). */
export const WHATSAPP_WEB_LIVE_UPSERT_TYPES = new Set(["notify", "append"]);

/**
 * Production-shaped Baileys event bus for messages.upsert binding.
 * Baileys 6.7.23 exposes on/off/emit but not listenerCount — never rely on it.
 */
export type WhatsAppWebBaileysUpsertEventBus = {
  on(
    event: "messages.upsert",
    listener: (upsert: WhatsAppWebMessagesUpsert) => void
  ): void;
  off(
    event: "messages.upsert",
    listener: (upsert: WhatsAppWebMessagesUpsert) => void
  ): void;
};

export type WhatsAppWebMessagesUpsert = {
  messages?: Array<{
    key?: {
      remoteJid?: string | null;
      id?: string | null;
      fromMe?: boolean | null;
      remoteJidAlt?: string | null;
      participant?: string | null;
      participantAlt?: string | null;
      senderPn?: string | null;
      senderLid?: string | null;
      participantPn?: string | null;
      participantLid?: string | null;
    };
    message?: Record<string, unknown> | null;
    pushName?: string | null;
    messageTimestamp?: number | LongLike | null;
  }>;
  type?: string;
};

type LongLike = { low: number; high?: number; unsigned?: boolean };

export type TrackedMessagesUpsertBinding = {
  /** Tracked attachment count for this handle (0 or 1). Never invents a fallback. */
  getInboundListenerCount: () => number;
  /** Detach only the registered named upsert handler for this binding. */
  detach: () => void;
  /** Socket generation this listener was bound for. */
  generation: number;
};

/**
 * Register a named messages.upsert handler and track attachment without
 * relying on EventEmitter.listenerCount (unavailable on Baileys sock.ev).
 * Detach only removes THIS binding — never another generation's listener.
 */
export function attachTrackedMessagesUpsertListener(
  ev: WhatsAppWebBaileysUpsertEventBus,
  onMessagesUpsert: (upsert: WhatsAppWebMessagesUpsert) => void,
  generation = 0
): TrackedMessagesUpsertBinding {
  let attached = false;
  ev.on("messages.upsert", onMessagesUpsert);
  attached = true;
  return {
    generation,
    getInboundListenerCount: () => (attached ? 1 : 0),
    detach: () => {
      if (!attached) return;
      try {
        ev.off("messages.upsert", onMessagesUpsert);
      } catch {
        /* ignore */
      }
      attached = false;
    },
  };
}

export type WhatsAppWebSocketHandle = {
  end: () => void;
  logout: () => Promise<void>;
  sendText: (jid: string, text: string) => Promise<{ providerMessageId: string }>;
  /** Current Baileys user id; call after connection opens. */
  getUserId?: () => string | null;
  /** Contact/chat/history source for admin sync (Baileys in-memory). */
  getSyncSource?: () => import("./whatsappWebSyncTypes.ts").WhatsAppWebSyncSource;
  /**
   * Tracked messages.upsert attachment count for this handle (0 or 1).
   * Must not invent a fallback of 1 when unverified.
   */
  getInboundListenerCount?: () => number;
};

export type WhatsAppWebSocketFactory = (input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: WhatsAppWebConnectionUpdate) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
  /** Return false to drop the upsert (stale generation). */
  onRawUpsert?: () => boolean;
  /** Socket generation for tracked listener binding. */
  socketGeneration?: number;
}) => Promise<WhatsAppWebSocketHandle>;

export type WhatsAppWebSessionOptions = {
  env?: NodeJS.ProcessEnv;
  config?: WhatsAppWebConfig;
  socketFactory?: WhatsAppWebSocketFactory;
  now?: () => Date;
  qrTtlMs?: number;
  inboundHandler?: WhatsAppWebInboundHandler | null;
  /** Injectable reconnect delay sequence (tests). */
  reconnectDelaysMs?: readonly number[];
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Repository used by admin contact/history sync (defaults to createDefault). */
  syncRepo?: WhatsAppRepository;
  /** Override process instance id (tests). */
  processInstanceId?: string;
  /** Disable exclusive session lease (tests only). */
  disableSessionLease?: boolean;
  /** Injectable lease stale/heartbeat timing (tests). */
  sessionLeaseHeartbeatMs?: number;
  sessionLeaseStaleMs?: number;
  /** Injectable lease store (tests share an in-memory CAS store). */
  sessionLeaseStore?: WhatsAppWebSessionLeaseStore;
  /** Injectable owner diagnostics store (tests share CAS store). */
  ownerDiagnosticsStore?: WhatsAppWebOwnerDiagnosticsStore;
};

async function defaultSocketFactory(input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: WhatsAppWebConnectionUpdate) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
  onRawUpsert?: () => boolean;
  socketGeneration?: number;
}): Promise<WhatsAppWebSocketHandle> {
  const baileys = await import("@whiskeysockets/baileys");
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(input.sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: createSilentBaileysLogger() as never,
    printQRInTerminal: false,
    // Request companion history asynchronously when the phone offers it.
    // Baileys 6.7.23 shouldSyncHistoryMessage only accepts/rejects HistorySyncNotification
    // types — it cannot enforce a seven-day message window. Window/cap bounds are applied
    // in BaileysInMemorySyncSource.ingestMessages (see WHATSAPP_WEB_SYNC_WINDOW_DAYS /
    // WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT).
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false,
  });
  // Share one process-local LID→phone map with live inbound persist so
  // contacts/chats/history can resolve later @lid notify events.
  const syncSource = new BaileysInMemorySyncSource({
    lidMap: getSharedWhatsAppLidPhoneMap(),
  });
  syncSource.setHistoryFetcher(async (count, oldestMsgKey, oldestMsgTimestamp) =>
    sock.fetchMessageHistory(count, oldestMsgKey as never, oldestMsgTimestamp)
  );

  const gen = input.socketGeneration ?? 0;

  sock.ev.on("creds.update", () => {
    noteProtocolEvent({ eventName: "creds.update", generation: gen });
    void saveCreds().then(() => input.onCredentialsSaved());
  });

  sock.ev.on("connection.update", (update) => {
    noteProtocolEvent({ eventName: "connection.update", generation: gen });

    const qr = (update as { qr?: string }).qr;
    if (typeof qr === "string" && qr.trim()) {
      input.onQr(qr);
    }

    if (update.connection === "open") {
      syncSource.setConnected(true, sock.user?.id ?? null);
      syncSource.setHistoryFetcher(
        async (count, oldestMsgKey, oldestMsgTimestamp) =>
          sock.fetchMessageHistory(
            count,
            oldestMsgKey as never,
            oldestMsgTimestamp
          )
      );
      // Record connection-open timestamp and readiness fields. Phase 1 observability only.
      noteConnectionOpenDiagnostic({ generation: gen });
      const rawUpdate = update as {
        receivedPendingNotifications?: boolean;
        isOnline?: boolean;
        isNewLogin?: boolean;
        legacy?: { phoneConnected?: boolean };
      };
      noteConnectionReadiness({
        generation: gen,
        receivedPendingNotifications: rawUpdate.receivedPendingNotifications ?? null,
        isOnline: rawUpdate.isOnline ?? null,
        isNewLogin: rawUpdate.isNewLogin ?? null,
        phoneConnected: rawUpdate.legacy?.phoneConnected ?? null,
      });
      input.onConnectionUpdate({
        connection: "open",
        userId: sock.user?.id ?? null,
        receivedPendingNotifications: rawUpdate.receivedPendingNotifications ?? null,
        isOnline: rawUpdate.isOnline ?? null,
        isNewLogin: rawUpdate.isNewLogin ?? null,
        phoneConnected: rawUpdate.legacy?.phoneConnected ?? null,
      });
      return;
    }

    if (update.connection === "close") {
      syncSource.setConnected(false);
      const statusCode = (
        update.lastDisconnect as { error?: { output?: { statusCode?: number } } }
      )?.error?.output?.statusCode;

      // Logged-out is exclusive — never also emit ordinary "close".
      if (statusCode === DisconnectReason.loggedOut) {
        input.onConnectionUpdate({
          connection: "logged_out",
          statusCode,
        });
        return;
      }

      input.onConnectionUpdate({
        connection: "close",
        statusCode,
      });
      return;
    }

    // Subsequent connection.update events may carry receivedPendingNotifications=true
    // after the initial open event. Capture without changing connection lifecycle.
    const rawUpdateAny = update as {
      receivedPendingNotifications?: boolean;
      isOnline?: boolean;
      isNewLogin?: boolean;
      legacy?: { phoneConnected?: boolean };
    };
    if (
      update.connection == null &&
      (rawUpdateAny.receivedPendingNotifications != null ||
       rawUpdateAny.isOnline != null ||
       rawUpdateAny.isNewLogin != null ||
       rawUpdateAny.legacy?.phoneConnected != null)
    ) {
      noteConnectionReadiness({
        generation: gen,
        receivedPendingNotifications: rawUpdateAny.receivedPendingNotifications ?? null,
        isOnline: rawUpdateAny.isOnline ?? null,
        isNewLogin: rawUpdateAny.isNewLogin ?? null,
        phoneConnected: rawUpdateAny.legacy?.phoneConnected ?? null,
      });
      input.onConnectionUpdate({
        receivedPendingNotifications: rawUpdateAny.receivedPendingNotifications ?? null,
        isOnline: rawUpdateAny.isOnline ?? null,
        isNewLogin: rawUpdateAny.isNewLogin ?? null,
        phoneConnected: rawUpdateAny.legacy?.phoneConnected ?? null,
      });
    }
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    noteProtocolEvent({ eventName: "contacts.upsert", generation: gen });
    syncSource.ingestContacts(
      (contacts ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("contacts.update", (contacts) => {
    noteProtocolEvent({ eventName: "contacts.update", generation: gen });
    syncSource.ingestContacts(
      (contacts ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("chats.upsert", (chats) => {
    noteProtocolEvent({ eventName: "chats.upsert", generation: gen });
    syncSource.ingestChats(
      (chats ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("chats.update", (chats) => {
    noteProtocolEvent({ eventName: "chats.update", generation: gen });
    syncSource.ingestChats(
      (chats ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("messages.update", () => {
    // Record protocol activity. messages.update covers read receipts, delivery status,
    // and reactions — it does NOT count as accepted/stored inbound delivery.
    noteProtocolEvent({ eventName: "messages.update", generation: gen });
  });
  sock.ev.on("messaging-history.set", (payload) => {
    noteProtocolEvent({ eventName: "messaging-history.set", generation: gen });
    const p = payload as unknown as {
      chats?: Array<Record<string, unknown>>;
      contacts?: Array<Record<string, unknown>>;
      messages?: Array<Record<string, unknown>>;
      peerDataRequestSessionId?: string | null;
    };
    // Ingest then correlate by request id (null/unrelated ids do not release waiters).
    syncSource.handleHistorySet(p);
  });

  // Named handler so sock.ev.off can detach exactly this listener.
  function onMessagesUpsert(upsert: WhatsAppWebMessagesUpsert): void {
    if (input.onRawUpsert && !input.onRawUpsert()) {
      noteInboundIgnored("stale_socket");
      return;
    }
    noteProtocolEvent({ eventName: "messages.upsert", generation: gen });
    if (!input.onRawUpsert) {
      noteInboundRawUpsert();
    }
    const messages = upsert.messages ?? [];
    // Baileys online receipts use "notify"; offline-flagged nodes use "append".
    // Both must reach the live inbound pipeline; unsupported types are ignored.
    const upsertType = String(upsert.type || "notify");
    syncSource.ingestMessages(
      messages as unknown as Array<Record<string, unknown>>
    );
    if (!WHATSAPP_WEB_LIVE_UPSERT_TYPES.has(upsertType)) {
      noteInboundIgnored("unsupported_upsert_type");
      return;
    }
    for (const msg of messages) {
      void (async () => {
        const remoteJid = String(msg.key?.remoteJid ?? "");
        const providerMessageId = String(msg.key?.id ?? "");
        if (!remoteJid) {
          noteInboundIgnored("missing_remote_jid");
          return;
        }
        if (!providerMessageId) {
          noteInboundIgnored("missing_provider_id");
          return;
        }
        const fromMe = msg.key?.fromMe === true;
        const isGroup = remoteJid.endsWith("@g.us");
        const isStatusOrNewsletter =
          remoteJid === "status@broadcast" ||
          remoteJid.endsWith("@newsletter") ||
          remoteJid.includes("broadcast");
        const messageBody = msg.message as
          | {
              conversation?: string;
              extendedTextMessage?: { text?: string };
            }
          | null
          | undefined;
        const text =
          messageBody?.conversation ||
          messageBody?.extendedTextMessage?.text ||
          null;
        const occurredAt = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString();
        const key = msg.key ?? {};
        await input.onInbound({
          providerMessageId,
          remoteJid,
          fromMe,
          text: text ? String(text) : null,
          pushName: msg.pushName ? String(msg.pushName) : null,
          occurredAt,
          isGroup,
          isStatusOrNewsletter,
          rawType: msg.message ? Object.keys(msg.message)[0] ?? null : null,
          remoteJidAlt: key.remoteJidAlt ?? null,
          participant: key.participant ?? null,
          participantAlt: key.participantAlt ?? null,
          senderPn: key.senderPn ?? null,
          senderLid: key.senderLid ?? null,
          participantPn: key.participantPn ?? null,
          participantLid: key.participantLid ?? null,
        });
      })().catch(() => {
        logWhatsAppWeb("warn", "inbound_handler_failed");
      });
    }
  }

  const upsertBinding = attachTrackedMessagesUpsertListener(
    sock.ev as unknown as WhatsAppWebBaileysUpsertEventBus,
    onMessagesUpsert,
    input.socketGeneration ?? 0
  );

  return {
    end: () => {
      syncSource.setConnected(false);
      upsertBinding.detach();
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    },
    logout: async () => {
      syncSource.setConnected(false);
      upsertBinding.detach();
      await sock.logout();
    },
    sendText: async (jid, text) => {
      const sent = await sock.sendMessage(jid, { text });
      const providerMessageId = String(sent?.key?.id ?? "");
      if (!providerMessageId) {
        throw new Error("Baileys send did not return a provider message id");
      }
      return { providerMessageId };
    },
    getUserId: () => sock.user?.id ?? null,
    getSyncSource: () => syncSource,
    getInboundListenerCount: () => upsertBinding.getInboundListenerCount(),
  };
}

// ─── Test seam ───────────────────────────────────────────────────────────────
// Exported only for integration-level tests. Not called by production paths.

/** Minimal mock event bus accepted by __registerDefaultSocketHandlersForTest. */
export type TestBaileysEventBus = {
  on(event: string, handler: (...args: unknown[]) => void): void;
};

/**
 * Registers the exact same Baileys event handlers that defaultSocketFactory
 * wires onto a real Baileys sock, but using a controllable mock event bus.
 * Allows integration-level tests to exercise the handler logic without
 * importing Baileys.
 * @internal DO NOT call from production code.
 */
export function __registerDefaultSocketHandlersForTest(
  ev: TestBaileysEventBus,
  input: {
    gen: number;
    onConnectionUpdate: (update: WhatsAppWebConnectionUpdate) => void;
    onCredentialsSaved?: () => void;
    onRawUpsert?: () => boolean;
    onInbound?: WhatsAppWebInboundHandler;
  }
): void {
  const gen = input.gen;

  ev.on("creds.update", () => {
    noteProtocolEvent({ eventName: "creds.update", generation: gen });
    input.onCredentialsSaved?.();
  });

  ev.on("connection.update", (rawUpdate: unknown) => {
    noteProtocolEvent({ eventName: "connection.update", generation: gen });
    const update = rawUpdate as {
      connection?: string;
      receivedPendingNotifications?: boolean;
      isOnline?: boolean;
      isNewLogin?: boolean;
      legacy?: { phoneConnected?: boolean };
    };
    if (update.connection === "open") {
      noteConnectionOpenDiagnostic({ generation: gen });
      noteConnectionReadiness({
        generation: gen,
        receivedPendingNotifications: update.receivedPendingNotifications ?? null,
        isOnline: update.isOnline ?? null,
        isNewLogin: update.isNewLogin ?? null,
        phoneConnected: update.legacy?.phoneConnected ?? null,
      });
      input.onConnectionUpdate({
        connection: "open",
        userId: null,
        receivedPendingNotifications: update.receivedPendingNotifications ?? null,
        isOnline: update.isOnline ?? null,
        isNewLogin: update.isNewLogin ?? null,
        phoneConnected: update.legacy?.phoneConnected ?? null,
      });
      return;
    }
    // Subsequent readiness-only updates (connection field absent/null)
    if (
      update.connection == null &&
      (update.receivedPendingNotifications != null ||
        update.isOnline != null ||
        update.isNewLogin != null ||
        update.legacy?.phoneConnected != null)
    ) {
      noteConnectionReadiness({
        generation: gen,
        receivedPendingNotifications: update.receivedPendingNotifications ?? null,
        isOnline: update.isOnline ?? null,
        isNewLogin: update.isNewLogin ?? null,
        phoneConnected: update.legacy?.phoneConnected ?? null,
      });
      input.onConnectionUpdate({
        receivedPendingNotifications: update.receivedPendingNotifications ?? null,
        isOnline: update.isOnline ?? null,
        isNewLogin: update.isNewLogin ?? null,
        phoneConnected: update.legacy?.phoneConnected ?? null,
      });
    }
  });

  ev.on("contacts.upsert", () => {
    noteProtocolEvent({ eventName: "contacts.upsert", generation: gen });
  });
  ev.on("contacts.update", () => {
    noteProtocolEvent({ eventName: "contacts.update", generation: gen });
  });
  ev.on("chats.upsert", () => {
    noteProtocolEvent({ eventName: "chats.upsert", generation: gen });
  });
  ev.on("chats.update", () => {
    noteProtocolEvent({ eventName: "chats.update", generation: gen });
  });
  ev.on("messaging-history.set", () => {
    noteProtocolEvent({ eventName: "messaging-history.set", generation: gen });
  });

  // messages.update — covers read receipts, delivery status, reactions.
  // MUST call noteProtocolEvent but MUST NOT be treated as new inbound delivery.
  ev.on("messages.update", () => {
    noteProtocolEvent({ eventName: "messages.update", generation: gen });
  });

  ev.on("messages.upsert", (upsert: unknown) => {
    noteProtocolEvent({ eventName: "messages.upsert", generation: gen });
    if (input.onRawUpsert && !input.onRawUpsert()) return;
    if (!input.onRawUpsert) {
      noteInboundRawUpsert();
    }
    input.onInbound?.(upsert as never);
  });
}

export class WhatsAppWebSession {
  private readonly env: NodeJS.ProcessEnv;
  private readonly socketFactory: WhatsAppWebSocketFactory;
  private readonly now: () => Date;
  private readonly qrTtlMs: number;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private inboundHandler: WhatsAppWebInboundHandler | null;
  private readonly historySync: WhatsAppWebHistorySyncService;

  private state: WhatsAppWebLifecycleState = "DISCONNECTED";
  private phoneRaw: string | null = null;
  private updatedAt: string;
  private safeMessage: string | null = null;
  private qrRaw: string | null = null;
  private qrExpiresAt: string | null = null;
  private qrDataUrl: string | null = null;
  private qrGeneration = 0;

  private socket: WhatsAppWebSocketHandle | null = null;
  /** Monotonic socket instance id — stale close/open events are ignored. */
  private socketGeneration = 0;
  private startLock = false;
  /** Process-level shutdown (SIGTERM) or explicit stop. */
  private shuttingDown = false;
  /** Operator wants an active connection (connect/resume). */
  private connectionDesired = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectAttemptInProgress = false;
  private lastDisconnectClassification: DisconnectDiagnosticClassification | null =
    null;
  private credentialsAvailable = false;
  private paths: ResolvedAuthPaths | null = null;
  /** Test observability: delays scheduled for reconnect. */
  private readonly scheduledReconnectDelays: number[] = [];
  private readonly processInstanceId: string;
  private readonly sessionLease: WhatsAppWebSessionLease | null;
  private readonly ownerDiagnosticsStore: WhatsAppWebOwnerDiagnosticsStore;
  private leaseLostHandled = false;
  /** Generation of the currently authoritative upsert binding. */
  private activeUpsertGeneration = 0;
  /**
   * Socket generation that last confirmed live inbound on the current process.
   * A newer generation starts without LIVE_INBOUND_CONFIRMED until it observes
   * its own upsert/accepted/stored events.
   */
  private liveInboundSocketGeneration: number | null = null;

  constructor(options: WhatsAppWebSessionOptions = {}) {
    this.env = options.env ?? process.env;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date());
    this.qrTtlMs = options.qrTtlMs ?? WHATSAPP_WEB_QR_TTL_MS;
    this.inboundHandler = options.inboundHandler ?? null;
    this.reconnectDelaysMs =
      options.reconnectDelaysMs ?? WHATSAPP_WEB_RECONNECT_DELAYS_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.updatedAt = this.now().toISOString();
    this.processInstanceId =
      options.processInstanceId ?? getWhatsAppWebProcessInstanceId(this.env);
    this.ownerDiagnosticsStore =
      options.ownerDiagnosticsStore ??
      resolveDefaultWhatsAppWebOwnerDiagnosticsStore(this.env);
    this.sessionLease =
      options.disableSessionLease === true
        ? null
        : new WhatsAppWebSessionLease(this.processInstanceId, {
            now: this.now,
            heartbeatMs: options.sessionLeaseHeartbeatMs,
            staleMs: options.sessionLeaseStaleMs,
            store:
              options.sessionLeaseStore ??
              resolveDefaultSessionLeaseStore(this.env),
            onLeaseLost: (reason) => {
              this.handleLeaseLost(reason);
            },
          });
    const boundSource = new SessionBoundSyncSource(
      () => this.socket?.getSyncSource?.() ?? null
    );
    this.historySync = new WhatsAppWebHistorySyncService({
      source: boundSource,
      repo: options.syncRepo ?? createDefaultWhatsAppRepository(),
      now: this.now,
    });
  }

  setInboundHandler(handler: WhatsAppWebInboundHandler | null): void {
    this.inboundHandler = handler;
  }

  getConfig(): WhatsAppWebConfig {
    return readWhatsAppWebConfig(this.env);
  }

  getSafeStatus(): WhatsAppWebSafeStatus {
    const config = this.getConfig();
    const qrAvailable = Boolean(
      this.qrDataUrl &&
        this.qrExpiresAt &&
        Date.parse(this.qrExpiresAt) > this.now().getTime() &&
        this.state === "QR_READY"
    );
    const inbound = getWhatsAppWebInboundDiagnostics();
    const liveInboundConfirmed =
      this.liveInboundSocketGeneration === this.socketGeneration;
    const lastRawUpsertAt = liveInboundConfirmed
      ? inbound.lastRawUpsertAt
      : null;
    const lastInboundEventAt = liveInboundConfirmed
      ? inbound.lastInboundEventAt
      : null;
    const lastInboundStoredAt = liveInboundConfirmed
      ? inbound.lastInboundStoredAt
      : null;
    const socketOpen = this.state === "CONNECTED" && this.socket != null;
    // Never invent attachment: missing/unverified tracking reports 0 (not operational).
    const listenerCount = this.socket?.getInboundListenerCount?.() ?? 0;
    const inboundListenerAttached = socketOpen && listenerCount >= 1;
    const inboundListenerOperational =
      socketOpen && inboundListenerAttached && listenerCount === 1;
    const lease = this.sessionLease?.getSnapshot() ?? null;
    const connection = getWhatsAppWebConnectionDiagnostics({
      env: this.env,
      lease,
      connected: socketOpen,
      lastRawUpsertAt,
      nowMs: this.now().getTime(),
    });
    return {
      enabled: config.enabled,
      state: this.state,
      phoneMasked: maskPhoneNumber(this.phoneRaw),
      updatedAt: this.updatedAt,
      qrAvailable,
      qrExpiresAt: qrAvailable ? this.qrExpiresAt : null,
      safeMessage: this.safeMessage,
      lastRawUpsertAt,
      lastInboundEventAt,
      lastInboundStoredAt,
      lastIgnoredAt: inbound.lastIgnoredAt,
      lastIgnoredReason: inbound.lastIgnoredReason,
      lastPersistFailureAt: inbound.lastPersistFailureAt,
      lastPersistFailureCode: inbound.lastPersistFailureCode,
      socketOpen,
      inboundListenerAttached,
      inboundListenerOperational,
      activeSocketGeneration: this.socketGeneration,
      activeSessionKey: `web_qr:${WHATSAPP_WEB_QR_CONNECTION_ID}:g${this.socketGeneration}`,
      reconnectScheduled: this.reconnectTimer != null,
      reconnectAttemptInProgress: this.reconnectAttemptInProgress === true,
      reconnectAttempt: this.reconnectAttempt,
      lastDisconnectClassification: this.lastDisconnectClassification,
      credentialsAvailable: this.credentialsAvailable === true,
      processInstanceId: this.processInstanceId,
      processPid: connection.processPid,
      hostHash: connection.hostHash,
      lastConnectionUpdateAt: connection.lastConnectionUpdateAt,
      lastConnectionState: connection.lastConnectionState,
      lastConnectionReason: connection.lastConnectionReason,
      lastCredentialsUpdateAt: connection.lastCredentialsUpdateAt,
      authenticatedUserJidHash: connection.authenticatedUserJidHash,
      socketCreatedAt: connection.socketCreatedAt,
      sessionLeaseStatus: connection.sessionLeaseStatus,
      sessionLeaseOwnerMatch: connection.sessionLeaseOwnerMatch,
      sessionLeaseOwnerId: connection.sessionLeaseOwnerId,
      sessionLeaseFencingTokenHash: connection.sessionLeaseFencingTokenHash,
      sessionLeaseAcquiredAt: connection.sessionLeaseAcquiredAt,
      sessionLeaseHeartbeatAt: connection.sessionLeaseHeartbeatAt,
      credentialsFilePresent: connection.credentialsFilePresent,
      authKeyFileCount: connection.authKeyFileCount,
      listeningSilent: connection.listeningSilent,
      protocolReadiness: connection.protocolReadiness,
      inboundHealth: deriveWhatsAppWebInboundHealth({
        leaseOwned: connection.sessionLeaseOwnerMatch === true,
        socketOpen,
        inboundListenerOperational,
        liveInboundConfirmed,
        lastRawUpsertAt,
        lastStoredMessageAt: liveInboundConfirmed ? inbound.lastInboundStoredAt : null,
        protocolEventActive:
          connection.protocolReadiness.lastProtocolEventAt !== null &&
          connection.protocolReadiness.protocolEventCounts["messages.upsert"] === 0,
      }),
      servingProcessInstanceId: this.processInstanceId,
      ownerProcessInstanceId: connection.sessionLeaseOwnerId,
      fencingVersion: this.sessionLease?.getFence()?.fencingVersion ?? null,
      buildIdentity: getWhatsAppWebBuildIdentity(this.env),
      durableOwnerMatch: connection.sessionLeaseOwnerMatch === true,
      leaseRetryGuidance: null,
    };
  }

  /**
   * Browser/CRM status: merges durable owner diagnostics so non-owner processes
   * report the lease owner's truth instead of local zombie CONNECTED state.
   */
  async getPublicStatus(): Promise<WhatsAppWebSafeStatus> {
    const local = this.getSafeStatus();
    const durable = await this.readDurableLeaseAndDiagnostics();
    const merged = mergeOwnerAwareSafeStatus({
      local,
      servingProcessInstanceId: this.processInstanceId,
      durableLease: durable.lease,
      durableDiagnostics: durable.diagnostics,
      nowMs: this.now().getTime(),
      env: this.env,
      liveInboundConfirmed:
        this.liveInboundSocketGeneration === this.socketGeneration,
    });
    if (merged.durableOwnerMatch) {
      void this.publishOwnerDiagnostics();
    }
    return merged;
  }

  async getQrPayload(): Promise<WhatsAppWebQrPayload | null> {
    const status = this.getSafeStatus();
    if (!status.qrAvailable || !this.qrDataUrl || !this.qrExpiresAt) {
      return null;
    }
    return {
      qrDataUrl: this.qrDataUrl,
      expiresAt: this.qrExpiresAt,
      state: this.state,
    };
  }

  /**
   * Startup init for Render/process boot.
   * - Flag off → no-op (current behavior).
   * - Flag on → validate writable auth dir; resume if creds exist; else stay DISCONNECTED.
   * Fail closed when enabled but auth directory is unusable.
   */
  async initializeAtStartup(): Promise<{
    resumed: boolean;
    state: WhatsAppWebLifecycleState;
  }> {
    const config = this.getConfig();
    if (!config.enabled) {
      return { resumed: false, state: this.state };
    }

    assertWhatsAppWebAuthDirReady(config);
    this.paths = resolveWhatsAppWebAuthPaths(config);
    await ensureWhatsAppWebAuthDirWritable(this.paths);
    await refreshAuthSessionIntegrity(this.paths.sessionDir);

    const hasCreds = await hasSavedBaileysCredentials(this.paths.sessionDir);
    this.credentialsAvailable = hasCreds;
    if (!hasCreds) {
      this.connectionDesired = false;
      this.setState("DISCONNECTED", "Waiting for Admin to generate QR");
      logWhatsAppWeb("info", "startup_awaiting_admin_qr");
      return { resumed: false, state: this.state };
    }

    const leaseOk = await this.ensureSessionLease();
    if (!leaseOk) {
      this.connectionDesired = false;
      this.setState(
        "ERROR",
        "Another process holds the WhatsApp session lease; keep a single Render instance"
      );
      logWhatsAppWeb("error", "session_lease_contested_at_startup");
      return { resumed: false, state: this.state };
    }

    this.connectionDesired = true;
    this.shuttingDown = false;
    await this.startSocket("CONNECTING");
    logWhatsAppWeb("info", "startup_resume_attempted");
    return { resumed: true, state: this.state };
  }

  /**
   * Start / resume connection. Marks connection as desired.
   * Refuses to steal a healthy unexpired foreign lease (409 whatsapp_lease_not_owned).
   */
  async connect(): Promise<WhatsAppWebSafeStatus> {
    const config = this.getConfig();
    if (!config.enabled) {
      throw Object.assign(new Error("WhatsApp Web QR is disabled"), {
        code: "feature_disabled",
      });
    }
    assertWhatsAppWebAuthDirReady(config);
    this.paths = resolveWhatsAppWebAuthPaths(config);
    await ensureWhatsAppWebAuthDirWritable(this.paths);
    await refreshAuthSessionIntegrity(this.paths.sessionDir);

    await this.assertNoForeignActiveLease();

    const leaseOk = await this.ensureSessionLease();
    if (!leaseOk) {
      this.connectionDesired = false;
      this.setState(
        "ERROR",
        "Another process holds the WhatsApp session lease; keep a single Render instance"
      );
      throw await this.buildLeaseNotOwnedError("contested");
    }

    this.connectionDesired = true;
    this.shuttingDown = false;

    if (this.startLock) {
      throw Object.assign(new Error("Connection start already in progress"), {
        code: "start_in_progress",
      });
    }

    if (
      this.state === "CONNECTED" ||
      this.state === "QR_READY" ||
      this.state === "CONNECTING" ||
      this.state === "RECONNECTING"
    ) {
      await this.publishOwnerDiagnostics();
      return this.getPublicStatus();
    }

    await this.startSocket("CONNECTING");
    await this.publishOwnerDiagnostics();
    return this.getPublicStatus();
  }

  /** Soft disconnect — not desired; never auto-reconnect; keep credentials. */
  async disconnect(): Promise<WhatsAppWebSafeStatus> {
    await this.assertCompleteActiveFence();
    this.connectionDesired = false;
    this.cancelHistorySync("disconnect");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectAttemptInProgress = false;
    this.socketGeneration += 1;
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
    await this.releaseSessionLease();
    this.setState("DISCONNECTED", "Disconnected (session retained)");
    await this.publishOwnerDiagnostics();
    return this.getPublicStatus();
  }

  /**
   * Logout — not desired; never reconnect; delete only contained session dir.
   */
  async logout(): Promise<WhatsAppWebSafeStatus> {
    await this.assertCompleteActiveFence();
    this.connectionDesired = false;
    this.cancelHistorySync("logout");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectAttemptInProgress = false;
    this.socketGeneration += 1;

    const config = this.getConfig();
    if (!config.enabled && !config.authDir) {
      this.phoneRaw = null;
      this.credentialsAvailable = false;
      this.clearQr();
      this.setState("LOGGED_OUT", "Logged out");
      return this.getPublicStatus();
    }
    assertWhatsAppWebAuthDirReady({
      ...config,
      enabled: true,
      authDir: config.authDir,
    });
    const paths = resolveWhatsAppWebAuthPaths(config);

    if (this.socket) {
      try {
        await this.socket.logout();
      } catch {
        logWhatsAppWeb("warn", "logout_remote_failed");
      }
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }

    await deleteWhatsAppWebSessionDir(paths);
    this.paths = paths;
    this.phoneRaw = null;
    this.credentialsAvailable = false;
    this.clearQr();
    await this.releaseSessionLease();
    await refreshAuthSessionIntegrity(paths.sessionDir);
    this.setState("LOGGED_OUT", "Logged out; session removed");
    await this.publishOwnerDiagnostics();
    return this.getPublicStatus();
  }

  async sendText(
    jid: string,
    text: string
  ): Promise<{ providerMessageId: string }> {
    await this.assertCompleteActiveFence();
    if (this.state !== "CONNECTED" || !this.socket) {
      throw Object.assign(new Error("WhatsApp Web is not connected"), {
        code: "not_connected",
      });
    }
    return this.socket.sendText(jid, text);
  }

  isConnected(): boolean {
    return this.state === "CONNECTED" && this.socket != null;
  }

  /**
   * Admin contact + 7-day history sync (single-flight).
   * Never sends messages or triggers AI.
   * Prefer startHistorySyncOwned() from HTTP routes (lease gate).
   */
  startHistorySync(): {
    accepted: boolean;
    joinedExisting: boolean;
    snapshot: WhatsAppWebSyncJobSnapshot;
  } {
    const result = this.historySync.startOrJoin();
    return {
      accepted: result.accepted,
      joinedExisting: result.joinedExisting,
      snapshot: result.snapshot,
    };
  }

  async startHistorySyncOwned(): Promise<{
    accepted: boolean;
    joinedExisting: boolean;
    snapshot: WhatsAppWebSyncJobSnapshot;
  }> {
    await this.assertCompleteActiveFence();
    return this.startHistorySync();
  }

  async getHistorySyncSnapshot(): Promise<WhatsAppWebSyncJobSnapshot> {
    return this.historySync.getDurableSnapshot();
  }

  private cancelHistorySync(reason: string): void {
    this.historySync.requestCancel();
    logWhatsAppWeb("info", "history_sync_cancel_requested", { reason });
  }

  /** Graceful shutdown — not desired; cancel reconnect; preserve credentials. */
  async shutdown(): Promise<void> {
    this.connectionDesired = false;
    this.shuttingDown = true;
    this.cancelHistorySync("shutdown");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectAttemptInProgress = false;
    this.socketGeneration += 1;
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
    await this.releaseSessionLease();
    if (
      this.state === "CONNECTED" ||
      this.state === "RECONNECTING" ||
      this.state === "CONNECTING" ||
      this.state === "QR_READY"
    ) {
      this.setState("DISCONNECTED", "Shutdown");
    }
  }

  /** Test seam: inject lifecycle/QR without Baileys. */
  __testSetState(
    state: WhatsAppWebLifecycleState,
    opts?: {
      phoneRaw?: string | null;
      qrRaw?: string | null;
      safeMessage?: string | null;
      connectionDesired?: boolean;
    }
  ): void {
    if (opts?.connectionDesired !== undefined) {
      this.connectionDesired = opts.connectionDesired;
    }
    if (opts?.phoneRaw !== undefined) this.phoneRaw = opts.phoneRaw;
    if (opts?.safeMessage !== undefined) this.safeMessage = opts.safeMessage;
    if (opts?.qrRaw) {
      void this.acceptQr(opts.qrRaw);
    } else if (opts?.qrRaw === null) {
      this.clearQr();
    }
    this.setState(state, opts?.safeMessage ?? this.safeMessage);
  }

  __testIsConnectionDesired(): boolean {
    return this.connectionDesired;
  }

  __testHasReconnectTimer(): boolean {
    return this.reconnectTimer != null;
  }

  __testGetReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  __testGetScheduledReconnectDelays(): readonly number[] {
    return this.scheduledReconnectDelays;
  }

  __testHandleConnectionUpdate(
    update: WhatsAppWebConnectionUpdate,
    generation?: number
  ): Promise<void> {
    return this.handleConnectionUpdate(
      update,
      generation ?? this.socketGeneration
    );
  }

  __testGetSocketGeneration(): number {
    return this.socketGeneration;
  }

  __testBumpSocketGeneration(): number {
    this.socketGeneration += 1;
    return this.socketGeneration;
  }

  /** Test-only: invoke lease-loss teardown path. */
  __testHandleLeaseLost(reason = "ownership_lost"): void {
    this.handleLeaseLost(reason);
  }

  /** Test-only: access lease for concurrency/heartbeat races. */
  __testGetSessionLease(): WhatsAppWebSessionLease | null {
    return this.sessionLease;
  }

  __testAcceptQr(qr: string): Promise<void> {
    return this.acceptQr(qr);
  }

  private setState(
    state: WhatsAppWebLifecycleState,
    safeMessage?: string | null
  ): void {
    this.state = state;
    this.updatedAt = this.now().toISOString();
    if (safeMessage !== undefined) this.safeMessage = safeMessage;
    logWhatsAppWeb("info", "lifecycle", { state });
  }

  private clearQr(): void {
    this.qrGeneration += 1;
    this.qrRaw = null;
    this.qrExpiresAt = null;
    this.qrDataUrl = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private shouldReconnect(): boolean {
    return (
      this.connectionDesired === true &&
      this.shuttingDown === false &&
      this.getConfig().enabled === true
    );
  }

  private async acceptQr(qr: string): Promise<void> {
    // Invalidate older in-flight QR conversions.
    const generation = ++this.qrGeneration;
    const expires = new Date(this.now().getTime() + this.qrTtlMs);
    const dataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });

    // Stale conversion must not overwrite CONNECTED or a newer QR.
    if (generation !== this.qrGeneration) return;
    if (this.state === "CONNECTED") return;
    if (!this.connectionDesired || this.shuttingDown) return;

    this.qrRaw = qr;
    this.qrExpiresAt = expires.toISOString();
    this.qrDataUrl = dataUrl;
    this.setState("QR_READY", "Scan the QR code in WhatsApp Linked Devices");
  }

  private async startSocket(
    initialState: "CONNECTING" | "RECONNECTING"
  ): Promise<void> {
    if (this.startLock) {
      throw Object.assign(new Error("Connection start already in progress"), {
        code: "start_in_progress",
      });
    }
    if (this.shuttingDown || !this.connectionDesired) {
      throw Object.assign(new Error("WhatsApp Web connection is not desired"), {
        code: "not_desired",
      });
    }
    if (!this.paths) {
      throw new Error("Auth paths not resolved");
    }

    const leaseOk = await this.ensureSessionLease();
    if (!leaseOk) {
      this.connectionDesired = false;
      this.setState(
        "ERROR",
        "Another process holds the WhatsApp session lease; keep a single Render instance"
      );
      throw Object.assign(
        new Error("WhatsApp Web session lease is held by another process"),
        { code: "session_lease_contested" }
      );
    }

    this.startLock = true;
    this.reconnectAttemptInProgress = initialState === "RECONNECTING";
    this.clearReconnectTimer();
    this.setState(
      initialState,
      initialState === "RECONNECTING"
        ? "Reconnect attempt in progress"
        : "Starting WhatsApp Web connection"
    );

    const generation = ++this.socketGeneration;
    clearProtocolReadinessForNewGeneration(generation);
    // New generation starts without live-inbound confirmation from history.
    clearWhatsAppWebInboundLiveTimestamps();
    this.liveInboundSocketGeneration = null;

    try {
      if (this.socket) {
        this.cancelHistorySync("socket_replace");
        try {
          this.socket.end();
        } catch {
          /* ignore */
        }
        this.socket = null;
      }

      const sessionDir = this.paths.sessionDir;
      noteSocketCreatedDiagnostic();
      const handle = await this.socketFactory({
        sessionDir,
        onQr: (qr) => {
          if (generation !== this.socketGeneration) return;
          void this.acceptQr(qr);
        },
        onConnectionUpdate: (update) => {
          void this.handleConnectionUpdate(update, generation);
        },
        onCredentialsSaved: () => {
          noteCredentialsUpdateDiagnostic();
          void refreshAuthSessionIntegrity(sessionDir);
          if (generation !== this.socketGeneration) return;
          this.credentialsAvailable = true;
          logWhatsAppWeb("info", "credentials_saved");
        },
        onRawUpsert: () => {
          if (generation !== this.socketGeneration) {
            return false;
          }
          noteInboundRawUpsert();
          this.liveInboundSocketGeneration = generation;
          void this.publishOwnerDiagnostics();
          return true;
        },
        socketGeneration: generation,
        onInbound: async (message) => {
          if (generation !== this.socketGeneration) {
            // Privacy-safe: prove events arrived but belonged to a closed socket.
            noteInboundIgnored("stale_socket");
            return;
          }
          this.liveInboundSocketGeneration = generation;
          if (this.inboundHandler) {
            await this.inboundHandler(message);
          }
          void this.publishOwnerDiagnostics();
        },
      });

      // A newer start superseded this one while the factory was awaiting.
      if (generation !== this.socketGeneration) {
        try {
          handle.end();
        } catch {
          /* ignore */
        }
        return;
      }

      this.activeUpsertGeneration = generation;
      this.socket = handle;
      await this.publishOwnerDiagnostics();
    } catch (err) {
      if (generation === this.socketGeneration) {
        this.socket = null;
        // Leave ERROR only when not about to schedule another retry.
        if (this.shouldReconnect()) {
          this.setState("RECONNECTING", "Reconnect failed; retrying");
        } else {
          this.setState("ERROR", "Connection failed");
        }
      }
      // Reconnect scheduling is owned by the reconnect timer callback / close handler
      // (avoids double-scheduling when startSocket rejects).
      throw err;
    } finally {
      if (generation === this.socketGeneration) {
        this.startLock = false;
        this.reconnectAttemptInProgress = false;
      } else {
        this.startLock = false;
      }
    }
  }

  private async ensureSessionLease(): Promise<boolean> {
    if (!this.sessionLease || !this.paths) return true;
    const snap = await this.sessionLease.acquire(this.paths);
    const ok = this.sessionLease.isHeld();
    if (ok) {
      this.leaseLostHandled = false;
      await this.publishOwnerDiagnostics();
    }
    logWhatsAppWeb(ok ? "info" : "warn", "session_lease_acquire", {
      status: snap.status,
      ownerMatch: snap.ownerMatch,
    });
    return ok;
  }

  private async releaseSessionLease(): Promise<void> {
    if (!this.sessionLease) return;
    await this.sessionLease.release();
  }

  private resolveSessionKeyOrNull(): string | null {
    try {
      if (this.paths) {
        return resolveWhatsAppWebSessionLeaseKey(this.paths.sessionDir);
      }
      const config = this.getConfig();
      if (!config.authDir) return null;
      const paths = resolveWhatsAppWebAuthPaths(config);
      return resolveWhatsAppWebSessionLeaseKey(paths.sessionDir);
    } catch {
      return null;
    }
  }

  private async readDurableLeaseAndDiagnostics(): Promise<{
    lease: WhatsAppWebLeaseRow | null;
    diagnostics: Awaited<
      ReturnType<WhatsAppWebOwnerDiagnosticsStore["read"]>
    >;
  }> {
    const sessionKey = this.resolveSessionKeyOrNull();
    if (!sessionKey || !this.sessionLease) {
      return { lease: null, diagnostics: null };
    }
    const lease = await this.sessionLease.readDurableLease(sessionKey);
    const diagnostics = await this.ownerDiagnosticsStore.read(sessionKey);
    return { lease, diagnostics };
  }

  private async assertNoForeignActiveLease(): Promise<void> {
    if (!this.sessionLease) return;
    const { lease } = await this.readDurableLeaseAndDiagnostics();
    if (
      isLeaseRowActive(lease, this.now().getTime()) &&
      lease.ownerId !== this.processInstanceId
    ) {
      throw await this.buildLeaseNotOwnedError("contested", lease);
    }
  }

  /**
   * Require the complete active fence before HTTP/socket mutations.
   * Internal shutdown / lease-loss teardown must NOT call this.
   */
  private async assertCompleteActiveFence(): Promise<void> {
    if (!this.sessionLease) return;
    if (!this.paths) {
      const config = this.getConfig();
      if (config.authDir) {
        this.paths = resolveWhatsAppWebAuthPaths(config);
      }
    }
    const sessionKey = this.resolveSessionKeyOrNull();
    const localFence = this.sessionLease.getFence();
    const nowMs = this.now().getTime();

    if (!sessionKey || !localFence || !this.sessionLease.isHeld()) {
      throw await this.buildLeaseNotOwnedError("absent");
    }
    if (localFence.sessionKey !== sessionKey) {
      throw await this.buildLeaseNotOwnedError("contested");
    }

    const lease = await this.sessionLease.readDurableLease(sessionKey);
    if (!isLeaseRowActive(lease, nowMs)) {
      throw await this.buildLeaseNotOwnedError(
        lease ? "absent" : "absent",
        lease
      );
    }
    if (lease.ownerId !== this.processInstanceId) {
      throw await this.buildLeaseNotOwnedError("contested", lease);
    }
    if (lease.ownerToken !== localFence.ownerToken) {
      throw await this.buildLeaseNotOwnedError("contested", lease);
    }
    if (lease.fencingVersion !== localFence.fencingVersion) {
      throw await this.buildLeaseNotOwnedError("contested", lease);
    }
  }

  private async buildLeaseNotOwnedError(
    status: string,
    lease?: WhatsAppWebLeaseRow | null
  ): Promise<Error> {
    const durable = lease
      ? { lease, diagnostics: null }
      : await this.readDurableLeaseAndDiagnostics();
    const row = durable.lease;
    return createLeaseNotOwnedError({
      servingProcessInstanceId: this.processInstanceId,
      ownerProcessInstanceId: row?.ownerId ?? null,
      sessionLeaseStatus: status,
      fencingVersion: row?.fencingVersion ?? null,
    });
  }

  private async publishOwnerDiagnostics(): Promise<void> {
    if (!this.sessionLease) return;
    const fence = this.sessionLease.getFence();
    if (!fence) return;
    const local = this.getSafeStatus();
    const inbound = getWhatsAppWebInboundDiagnostics();
    const liveInboundConfirmed =
      this.liveInboundSocketGeneration === this.socketGeneration;
    const inboundHealth = deriveWhatsAppWebInboundHealth({
      leaseOwned: true,
      socketOpen: local.socketOpen,
      inboundListenerOperational: local.inboundListenerOperational,
      liveInboundConfirmed,
      lastRawUpsertAt: liveInboundConfirmed ? inbound.lastRawUpsertAt : null,
      lastStoredMessageAt: liveInboundConfirmed ? inbound.lastInboundStoredAt : null,
      protocolEventActive: local.protocolReadiness.lastProtocolEventAt !== null &&
        local.protocolReadiness.protocolEventCounts["messages.upsert"] === 0,
    });
    await this.ownerDiagnosticsStore.write(
      fence,
      this.processInstanceId,
      {
        ownerProcessInstanceId: this.processInstanceId,
        connectionGeneration: this.socketGeneration,
        lifecycleState: this.state,
        socketOpen: local.socketOpen,
        inboundListenerAttached: local.inboundListenerAttached,
        inboundListenerOperational: local.inboundListenerOperational,
        inboundHealth,
        lastConnectionAt: local.lastConnectionUpdateAt,
        lastHeartbeatAt:
          this.sessionLease.getSnapshot().heartbeatAt ??
          this.now().toISOString(),
        lastRawUpsertAt: liveInboundConfirmed ? inbound.lastRawUpsertAt : null,
        lastAcceptedEventAt: liveInboundConfirmed
          ? inbound.lastInboundEventAt
          : null,
        lastStoredMessageAt: liveInboundConfirmed
          ? inbound.lastInboundStoredAt
          : null,
        lastFailureCode: inbound.lastPersistFailureCode,
        buildIdentity: getWhatsAppWebBuildIdentity(this.env),
        connectionOpenAt: local.protocolReadiness.connectionOpenAt,
        receivedPendingNotifications: local.protocolReadiness.receivedPendingNotifications,
        pendingNotificationsReceivedAt: local.protocolReadiness.pendingNotificationsReceivedAt,
        isOnline: local.protocolReadiness.isOnline,
        isNewLogin: local.protocolReadiness.isNewLogin,
        phoneConnected: local.protocolReadiness.phoneConnected,
        lastProtocolEventAt: local.protocolReadiness.lastProtocolEventAt,
        protocolEventCounts: local.protocolReadiness.protocolEventCounts as Record<string, number> | null,
      }
    );
  }

  /** Test-only: publish diagnostics using current fence. */
  async __testPublishOwnerDiagnostics(): Promise<void> {
    await this.publishOwnerDiagnostics();
  }

  /** Test-only: access owner diagnostics store. */
  __testGetOwnerDiagnosticsStore(): WhatsAppWebOwnerDiagnosticsStore {
    return this.ownerDiagnosticsStore;
  }

  /**
   * Exclusive lease lost while a socket may still be open.
   * Tear down immediately and do not auto-reconnect until ownership is
   * acquired again by an explicit connect/startup path.
   */
  private handleLeaseLost(reason: string): void {
    // Idempotent: multiple heartbeat failures must not re-enter teardown.
    if (this.leaseLostHandled) return;
    this.leaseLostHandled = true;
    this.sessionLease?.abandonLocalOwnership(
      reason === "heartbeat_failed" ? "unavailable" : "contested"
    );
    this.connectionDesired = false;
    this.cancelHistorySync("lease_lost");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectAttemptInProgress = false;
    this.socketGeneration += 1;
    clearWhatsAppWebInboundLiveTimestamps();
    this.liveInboundSocketGeneration = null;
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
    this.lastDisconnectClassification = "unknown";
    noteConnectionUpdateDiagnostic({
      state: "close",
      reason: "unknown",
    });
    logWhatsAppWeb("error", "session_lease_lost", { reason });
    this.setState(
      "ERROR",
      "WhatsApp session ownership lost; another process holds the lease"
    );
  }

  private async handleConnectionUpdate(
    update: WhatsAppWebConnectionUpdate,
    generation?: number
  ): Promise<void> {
    // Stale sockets cannot mutate current lifecycle state.
    if (generation != null && generation !== this.socketGeneration) {
      noteConnectionUpdateDiagnostic({
        state: String(update.connection ?? "close"),
        reason: "stale_generation",
      });
      return;
    }

    if (update.connection === "open") {
      // Never resurrect CONNECTED from a closed/undesired/shutdown session.
      if (!this.connectionDesired || this.shuttingDown) {
        noteConnectionUpdateDiagnostic({
          state: "open",
          reason: this.shuttingDown ? "shutdown" : "not_desired",
        });
        return;
      }
      if (generation != null && generation !== this.socketGeneration) {
        noteConnectionUpdateDiagnostic({
          state: "open",
          reason: "stale_generation",
        });
        return;
      }
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.reconnectAttemptInProgress = false;
      this.lastDisconnectClassification = null;
      this.clearQr();
      const userId =
        update.userId ??
        this.socket?.getUserId?.() ??
        null;
      this.phoneRaw = jidToPhone(userId);
      noteAuthenticatedUserJidHash(userId);
      noteConnectionUpdateDiagnostic({ state: "open", reason: "open" });
      void refreshAuthSessionIntegrity(this.paths?.sessionDir);
      this.setState("CONNECTED", "WhatsApp Web connected");
      void this.publishOwnerDiagnostics();
      return;
    }

    if (update.connection === "logged_out") {
      noteConnectionUpdateDiagnostic({
        state: "logged_out",
        reason: "logged_out",
      });
      // Terminal: invalidate this socket generation first so late open/QR/inbound
      // callbacks from the same socket cannot overwrite LOGGED_OUT.
      this.invalidateClosedSocketGeneration(generation);
      this.connectionDesired = false;
      this.cancelHistorySync("logged_out");
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.reconnectAttemptInProgress = false;
      this.clearQr();
      this.phoneRaw = null;
      this.credentialsAvailable = false;
      this.lastDisconnectClassification = "logged_out";
      this.logConnectionClosed({
        statusCode: update.statusCode ?? 401,
        willRetry: false,
        nextState: "LOGGED_OUT",
      });
      this.setState(
        "LOGGED_OUT",
        terminalDisconnectSafeMessage(update.statusCode ?? 401)
      );
      if (this.paths) {
        try {
          await deleteWhatsAppWebSessionDir(this.paths);
        } catch {
          logWhatsAppWeb("warn", "session_dir_cleanup_failed");
        }
      }
      await this.releaseSessionLease();
      return;
    }

    if (update.connection === "close") {
      const closeReason = classifyDisconnectDiagnostic(update.statusCode);
      noteConnectionUpdateDiagnostic({
        state: "close",
        reason: closeReason,
      });
      this.cancelHistorySync("connection_close");
      // Invalidate immediately so late open/QR/inbound/creds from this socket
      // cannot pass the generation guard while reconnect is only scheduled.
      this.invalidateClosedSocketGeneration(generation);
      this.clearQr();

      // Manual stop / shutdown: close events must not reconnect.
      if (!this.connectionDesired || this.shuttingDown) {
        if (this.state !== "LOGGED_OUT" && this.state !== "DISCONNECTED") {
          this.lastDisconnectClassification = classifyDisconnectDiagnostic(
            update.statusCode
          );
          this.logConnectionClosed({
            statusCode: update.statusCode,
            willRetry: false,
            nextState: "DISCONNECTED",
          });
          this.setState("DISCONNECTED", "Disconnected");
        }
        return;
      }

      const classification = classifyDisconnect(update.statusCode);
      if (classification === "logged_out") {
        // Safety if factory mis-emits close+loggedOut code.
        // Generation already invalidated; logged_out path is idempotent for that.
        await this.handleConnectionUpdate(
          {
            connection: "logged_out",
            statusCode: update.statusCode,
          },
          this.socketGeneration
        );
        return;
      }
      if (classification === "terminal") {
        this.connectionDesired = false;
        this.clearReconnectTimer();
        this.reconnectAttempt = 0;
        this.reconnectAttemptInProgress = false;
        this.phoneRaw = null;
        this.lastDisconnectClassification = classifyDisconnectDiagnostic(
          update.statusCode
        );
        this.logConnectionClosed({
          statusCode: update.statusCode,
          willRetry: false,
          nextState: "ERROR",
        });
        this.setState(
          "ERROR",
          terminalDisconnectSafeMessage(update.statusCode)
        );
        return;
      }

      // Temporary / retryable network loss — reconnect with bounded backoff.
      // startSocket will allocate a fresh generation for the next socket.
      const willRetry = this.shouldReconnect();
      this.lastDisconnectClassification = classifyDisconnectDiagnostic(
        update.statusCode
      );
      this.logConnectionClosed({
        statusCode: update.statusCode,
        willRetry,
        nextState: "RECONNECTING",
      });
      this.setState("RECONNECTING", "Reconnect scheduled after network loss");
      this.scheduleReconnect();
    }
  }

  /**
   * After an accepted close/logged_out for the active socket, bump generation
   * so late callbacks from that socket can no longer mutate session state,
   * then tear down the handle so Baileys cannot keep receiving on an orphan.
   * Reconnect still works: startSocket allocates a newer generation.
   */
  private invalidateClosedSocketGeneration(generation?: number): void {
    if (generation != null && generation !== this.socketGeneration) {
      return;
    }
    const closing = this.socket;
    // Bump first so any events emitted during end() fail the generation guard.
    this.socketGeneration += 1;
    this.socket = null;
    if (closing) {
      try {
        closing.end();
      } catch {
        /* ignore */
      }
    }
  }

  private logConnectionClosed(input: {
    statusCode: number | undefined | null;
    willRetry: boolean;
    nextState: WhatsAppWebLifecycleState;
  }): void {
    const diagnostic = buildConnectionClosedDiagnostic(input);
    logWhatsAppWeb("info", "connection_closed", {
      statusCode: diagnostic.statusCode,
      classification: diagnostic.classification,
      willRetry: diagnostic.willRetry,
      nextState: diagnostic.nextState,
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect()) return;
    // Only one reconnect timer/socket start may exist.
    if (this.reconnectTimer != null || this.startLock) return;

    const delay = reconnectDelayMs(
      this.reconnectAttempt,
      this.reconnectDelaysMs
    );
    this.scheduledReconnectDelays.push(delay);
    this.reconnectAttempt += 1;

    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect()) return;
      if (this.startLock) return;
      void this.startSocket("RECONNECTING").catch(() => {
        // startSocket already scheduled next retry when desired.
        if (this.shouldReconnect() && this.reconnectTimer == null) {
          this.setState("RECONNECTING", "Reconnect failed; retrying");
          this.scheduleReconnect();
        }
      });
    }, delay) as ReturnType<typeof setTimeout>;
  }
}

function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const user = String(jid).split("@")[0] ?? "";
  const digits = user.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

/** Process-wide singleton used by production wiring. */
let sharedSession: WhatsAppWebSession | null = null;

export function getSharedWhatsAppWebSession(
  options?: WhatsAppWebSessionOptions
): WhatsAppWebSession {
  if (!sharedSession) {
    sharedSession = new WhatsAppWebSession(options);
  }
  return sharedSession;
}

/** Test-only reset of the process singleton. */
export function __resetSharedWhatsAppWebSession(): void {
  sharedSession = null;
}
