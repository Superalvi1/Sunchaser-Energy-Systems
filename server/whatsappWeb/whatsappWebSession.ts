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
import { syncWhatsAppWebContact } from "./whatsappWebHistoryPersist.ts";
import {
  ContactIdentityPersistQueue,
  WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY,
} from "./whatsappWebContactIdentityQueue.ts";
import { getSharedWhatsAppLidMappingRuntime } from "./whatsappWebLidMapping.ts";
import type {
  WhatsAppWebSyncJobSnapshot,
  WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";

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
};

export type WhatsAppWebSocketHandle = {
  end: () => void;
  logout: () => Promise<void>;
  sendText: (jid: string, text: string) => Promise<{ providerMessageId: string }>;
  /** Current Baileys user id; call after connection opens. */
  getUserId?: () => string | null;
  /** Contact/chat/history source for admin sync (Baileys in-memory). */
  getSyncSource?: () => import("./whatsappWebSyncTypes.ts").WhatsAppWebSyncSource;
};

export type WhatsAppWebContactIdentityHandler = (
  contact: import("./whatsappWebSyncTypes.ts").WhatsAppWebSyncContact
) => Promise<void>;

export type WhatsAppWebSocketFactory = (input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: WhatsAppWebConnectionUpdate) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
  /** Persist useful contact identity from contacts.upsert/update (best-effort). */
  onContactIdentity?: WhatsAppWebContactIdentityHandler;
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
  /** Optional sync job store (tests inject memory-only to avoid hosted Supabase). */
  syncJobStore?: import("./whatsappWebSyncJobStore.ts").WhatsAppWebSyncJobStore;
};

async function defaultSocketFactory(input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: WhatsAppWebConnectionUpdate) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
  onContactIdentity?: WhatsAppWebContactIdentityHandler;
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
  // SYNC-14C-B: share durable LID map with inbound. Persist/hydrate is
  // best-effort — missing migration must never affect socket lifecycle.
  const lidRuntime = getSharedWhatsAppLidMappingRuntime();
  const syncSource = new BaileysInMemorySyncSource({
    lidMap: lidRuntime.memory,
  });
  syncSource.setLidMappingStore(lidRuntime.repo, lidRuntime.scope);
  syncSource.setHistoryFetcher(async (count, oldestMsgKey, oldestMsgTimestamp) =>
    sock.fetchMessageHistory(count, oldestMsgKey as never, oldestMsgTimestamp)
  );

  sock.ev.on("creds.update", () => {
    void saveCreds().then(() => input.onCredentialsSaved());
  });

  sock.ev.on("connection.update", (update) => {
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
      input.onConnectionUpdate({
        connection: "open",
        userId: sock.user?.id ?? null,
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
    }
  });

  // Persistence queue is owned by WhatsAppWebSession (reconnect-safe).
  // Socket factory only forwards resolved contacts; it never creates a queue.
  const persistContactBatch = (
    contacts: Array<Record<string, unknown>> | null | undefined
  ) => {
    const resolved = syncSource.ingestContacts(contacts ?? []);
    if (!input.onContactIdentity || resolved.length === 0) return;
    for (const contact of resolved) {
      // Isolate failures — never reject into the Baileys event loop.
      void Promise.resolve(input.onContactIdentity(contact)).catch(() => {
        logWhatsAppWeb("warn", "contact_identity_persist_failed");
      });
    }
  };
  sock.ev.on("contacts.upsert", (contacts) => {
    persistContactBatch(
      (contacts ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("contacts.update", (contacts) => {
    persistContactBatch(
      (contacts ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("chats.upsert", (chats) => {
    syncSource.ingestChats(
      (chats ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("chats.update", (chats) => {
    syncSource.ingestChats(
      (chats ?? []) as unknown as Array<Record<string, unknown>>
    );
  });
  sock.ev.on("messaging-history.set", (payload) => {
    const p = payload as unknown as {
      chats?: Array<Record<string, unknown>>;
      contacts?: Array<Record<string, unknown>>;
      messages?: Array<Record<string, unknown>>;
      peerDataRequestSessionId?: string | null;
    };
    // Ingest then correlate by request id (null/unrelated ids do not release waiters).
    syncSource.handleHistorySet(p);
  });

  sock.ev.on("messages.upsert", (upsert) => {
    const messages = upsert.messages ?? [];
    // Keep history/append traffic out of the live inbound pipeline (AI/auto-link).
    const upsertType = String((upsert as { type?: string }).type || "notify");
    syncSource.ingestMessages(
      messages as unknown as Array<Record<string, unknown>>
    );
    if (upsertType !== "notify") {
      return;
    }
    for (const msg of messages) {
      void (async () => {
        const remoteJid = String(msg.key?.remoteJid ?? "");
        const providerMessageId = String(msg.key?.id ?? "");
        if (!remoteJid || !providerMessageId) return;
        const fromMe = msg.key?.fromMe === true;
        const isGroup = remoteJid.endsWith("@g.us");
        const isStatusOrNewsletter =
          remoteJid === "status@broadcast" ||
          remoteJid.endsWith("@newsletter") ||
          remoteJid.includes("broadcast");
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          null;
        const occurredAt = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString();
        const key = msg.key as {
          remoteJidAlt?: string | null;
          participant?: string | null;
          participantAlt?: string | null;
          senderPn?: string | null;
          senderLid?: string | null;
          participantPn?: string | null;
          participantLid?: string | null;
        };
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
  });

  return {
    end: () => {
      syncSource.setConnected(false);
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    },
    logout: async () => {
      syncSource.setConnected(false);
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
  };
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
  private readonly syncRepo: WhatsAppRepository;
  private readonly historySync: WhatsAppWebHistorySyncService;
  /**
   * Single session-owned persist queue reused across socket reconnects.
   * Per-phone FIFO serialization; monotonic epoch + drain on hard close.
   */
  private contactPersistQueue: ContactIdentityPersistQueue;
  /**
   * Monotonic queue/session epoch. Bumped on create and on close so closed-epoch
   * tasks that have not yet issued a DB write cannot become current again.
   */
  private contactPersistQueueEpoch = 0;
  /**
   * Settles when a hard-closed queue has no active tasks left. Replacement
   * queues must await this before executing persistence.
   */
  private contactPersistClosedDrain: Promise<void> | null = null;
  /**
   * Test seam: awaited inside guarded updateContactSyncFields after the final
   * pre-write isCurrent check and before the real repository mutate.
   */
  private contactPersistTestBeforeWrite:
    | ((ctx: {
        id: string;
        fields: Parameters<
          NonNullable<WhatsAppRepository["updateContactSyncFields"]>
        >[1];
      }) => Promise<void>)
    | null = null;

  private state: WhatsAppWebLifecycleState = "DISCONNECTED";
  private phoneRaw: string | null = null;
  private updatedAt: string;
  private safeMessage: string | null = null;
  private qrRaw: string | null = null;
  private qrExpiresAt: string | null = null;
  private qrDataUrl: string | null = null;
  private qrGeneration = 0;

  private socket: WhatsAppWebSocketHandle | null = null;
  private startLock = false;
  /** Process-level shutdown (SIGTERM) or explicit stop. */
  private shuttingDown = false;
  /** Operator wants an active connection (connect/resume). */
  private connectionDesired = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private paths: ResolvedAuthPaths | null = null;
  /** Test observability: delays scheduled for reconnect. */
  private readonly scheduledReconnectDelays: number[] = [];

  constructor(options: WhatsAppWebSessionOptions = {}) {
    this.env = options.env ?? process.env;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date());
    this.qrTtlMs = options.qrTtlMs ?? WHATSAPP_WEB_QR_TTL_MS;
    this.inboundHandler = options.inboundHandler ?? null;
    this.syncRepo = options.syncRepo ?? createDefaultWhatsAppRepository();
    this.contactPersistQueue = this.createContactPersistQueue();
    this.reconnectDelaysMs =
      options.reconnectDelaysMs ?? WHATSAPP_WEB_RECONNECT_DELAYS_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.updatedAt = this.now().toISOString();
    const boundSource = new SessionBoundSyncSource(
      () => this.socket?.getSyncSource?.() ?? null
    );
    this.historySync = new WhatsAppWebHistorySyncService({
      source: boundSource,
      repo: this.syncRepo,
      jobStore: options.syncJobStore,
      now: this.now,
    });
  }

  setInboundHandler(handler: WhatsAppWebInboundHandler | null): void {
    this.inboundHandler = handler;
  }

  /** Test/helper: monotonic queue epoch (create + close both advance it). */
  getContactPersistQueueEpoch(): number {
    return this.contactPersistQueueEpoch;
  }

  /** Test/helper: peak concurrency observed on the current queue. */
  getContactPersistPeakActive(): number {
    return this.contactPersistQueue.peakActive;
  }

  /** Test/helper: peak same-phone concurrency on the current queue. */
  getContactPersistPeakActiveForPhone(phoneE164: string): number {
    return this.contactPersistQueue.getPeakActiveForKey(phoneE164.trim());
  }

  /** Test/helper: whether the session persist queue is closed. */
  isContactPersistQueueClosed(): boolean {
    return this.contactPersistQueue.isClosed;
  }

  /**
   * Test seam: pause inside guarded updateContactSyncFields after the final
   * pre-write isCurrent check (deterministic stale/logout races).
   */
  __testSetContactPersistBeforeWrite(
    fn:
      | ((ctx: {
          id: string;
          fields: Parameters<
            NonNullable<WhatsAppRepository["updateContactSyncFields"]>
          >[1];
        }) => Promise<void>)
      | null
  ): void {
    this.contactPersistTestBeforeWrite = fn;
  }

  private createContactPersistQueue(): ContactIdentityPersistQueue {
    this.contactPersistQueueEpoch += 1;
    return new ContactIdentityPersistQueue({
      concurrency: WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY,
      onTaskError: () => {
        logWhatsAppWeb("warn", "contact_identity_persist_failed");
      },
    });
  }

  /**
   * Reuse the same queue across soft reconnects. After hard close, wait for the
   * closed queue's active tasks to settle before creating a replacement queue.
   */
  private async ensureContactPersistQueueOpen(): Promise<void> {
    if (!this.contactPersistQueue.isClosed) return;
    if (this.contactPersistClosedDrain) {
      await this.contactPersistClosedDrain;
      this.contactPersistClosedDrain = null;
    }
    if (this.contactPersistQueue.isClosed) {
      this.contactPersistQueue = this.createContactPersistQueue();
    }
  }

  /**
   * Hard-close: drop pending work, bump epoch (invalidates not-yet-issued writes),
   * and begin draining active tasks. Replacement queues must await the drain.
   */
  private closeContactPersistQueue(reason: string): void {
    if (this.contactPersistQueue.isClosed) return;
    this.contactPersistQueue.close();
    // Invalidate not-yet-issued work from this epoch (ABA / hard-close).
    this.contactPersistQueueEpoch += 1;
    this.contactPersistClosedDrain = this.contactPersistQueue
      .whenIdle()
      .then(() => undefined);
    logWhatsAppWeb("info", "contact_identity_persist_queue_closed", {
      reason,
    });
  }

  /**
   * Enqueue contact identity persistence on the session-owned bounded queue.
   * Same phone is strictly FIFO-serialized; global concurrency stays ≤3.
   * Same-epoch tasks are not cancelled when a newer event is enqueued — FIFO
   * preserves proven business metadata. Epoch/queue identity still invalidate
   * work that has not yet issued a repository write after hard close.
   */
  private enqueueContactIdentityPersist(
    contact: import("./whatsappWebSyncTypes.ts").WhatsAppWebSyncContact
  ): Promise<void> {
    if (this.shuttingDown || this.contactPersistQueue.isClosed) {
      return Promise.resolve();
    }
    const phoneKey = String(contact.phoneE164 || "").trim();
    if (!phoneKey) return Promise.resolve();

    const epochAtEnqueue = this.contactPersistQueueEpoch;
    const queueAtEnqueue = this.contactPersistQueue;

    // Valid until hard-close bumps epoch / closes this queue instance.
    // Do NOT cancel same-epoch FIFO peers when a newer event arrives.
    const isCurrent = () =>
      !this.shuttingDown &&
      this.contactPersistQueueEpoch === epochAtEnqueue &&
      this.contactPersistQueue === queueAtEnqueue &&
      !queueAtEnqueue.isClosed;

    const baseRepo = this.syncRepo;
    const guardedRepo: WhatsAppRepository = new Proxy(baseRepo, {
      get: (target, prop, receiver) => {
        if (prop === "updateContactSyncFields") {
          const underlying = target.updateContactSyncFields;
          if (!underlying) return undefined;
          return async (
            id: string,
            fields: Parameters<
              NonNullable<WhatsAppRepository["updateContactSyncFields"]>
            >[1],
            companyId?: string
          ) => {
            // Final pre-write check — invalidates only work not yet issued.
            if (!isCurrent()) {
              return null as never;
            }
            if (this.contactPersistTestBeforeWrite) {
              await this.contactPersistTestBeforeWrite({ id, fields });
            }
            if (!isCurrent()) {
              return null as never;
            }
            // Point of no return: once the repository call starts, drain must
            // wait for it; epoch checks cannot safely cancel it mid-flight.
            return underlying.call(target, id, fields, companyId);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

    return queueAtEnqueue
      .enqueue(
        async () => {
          if (!isCurrent()) return;
          await syncWhatsAppWebContact(contact, {
            repo: guardedRepo,
            now: this.now,
            shouldContinue: isCurrent,
          });
        },
        { key: phoneKey }
      )
      .then(() => undefined);
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
    return {
      enabled: config.enabled,
      state: this.state,
      phoneMasked: maskPhoneNumber(this.phoneRaw),
      updatedAt: this.updatedAt,
      qrAvailable,
      qrExpiresAt: qrAvailable ? this.qrExpiresAt : null,
      safeMessage: this.safeMessage,
    };
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

    const hasCreds = await hasSavedBaileysCredentials(this.paths.sessionDir);
    if (!hasCreds) {
      this.connectionDesired = false;
      this.setState("DISCONNECTED", "Waiting for Admin to generate QR");
      logWhatsAppWeb("info", "startup_awaiting_admin_qr");
      return { resumed: false, state: this.state };
    }

    this.connectionDesired = true;
    this.shuttingDown = false;
    await this.ensureContactPersistQueueOpen();
    await this.startSocket("CONNECTING");
    logWhatsAppWeb("info", "startup_resume_attempted");
    return { resumed: true, state: this.state };
  }

  /**
   * Start / resume connection. Marks connection as desired.
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
    this.shuttingDown = false;
    await this.ensureContactPersistQueueOpen();

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
      return this.getSafeStatus();
    }

    await this.startSocket("CONNECTING");
    return this.getSafeStatus();
  }

  /** Soft disconnect — not desired; never auto-reconnect; keep credentials. */
  async disconnect(): Promise<WhatsAppWebSafeStatus> {
    this.connectionDesired = false;
    this.cancelHistorySync("disconnect");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    // Keep the same persist queue across soft disconnect/reconnect; do not close.
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
    this.setState("DISCONNECTED", "Disconnected (session retained)");
    return this.getSafeStatus();
  }

  /**
   * Logout — not desired; never reconnect; delete only contained session dir.
   */
  async logout(): Promise<WhatsAppWebSafeStatus> {
    this.connectionDesired = false;
    this.cancelHistorySync("logout");
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.closeContactPersistQueue("logout");

    const config = this.getConfig();
    if (!config.enabled && !config.authDir) {
      this.phoneRaw = null;
      this.clearQr();
      this.setState("LOGGED_OUT", "Logged out");
      return this.getSafeStatus();
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
    this.clearQr();
    this.setState("LOGGED_OUT", "Logged out; session removed");
    return this.getSafeStatus();
  }

  async sendText(
    jid: string,
    text: string
  ): Promise<{ providerMessageId: string }> {
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
    this.closeContactPersistQueue("shutdown");
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
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

  __testHandleConnectionUpdate(update: WhatsAppWebConnectionUpdate): Promise<void> {
    return this.handleConnectionUpdate(update);
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

    this.startLock = true;
    this.clearReconnectTimer();
    // Soft reconnect reuses the same queue; hard-close recreates only after drain.
    await this.ensureContactPersistQueueOpen();
    this.setState(initialState, "Starting WhatsApp Web connection");

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
      this.socket = await this.socketFactory({
        sessionDir,
        onQr: (qr) => {
          void this.acceptQr(qr);
        },
        onConnectionUpdate: (update) => {
          void this.handleConnectionUpdate(update);
        },
        onCredentialsSaved: () => {
          logWhatsAppWeb("info", "credentials_saved");
        },
        onInbound: async (message) => {
          if (this.inboundHandler) {
            await this.inboundHandler(message);
          }
        },
        onContactIdentity: (contact) =>
          this.enqueueContactIdentityPersist(contact),
      });
    } catch (err) {
      this.socket = null;
      this.setState("ERROR", "Connection failed");
      // Reconnect scheduling is owned by the reconnect timer callback / close handler
      // (avoids double-scheduling when startSocket rejects).
      throw err;
    } finally {
      this.startLock = false;
    }
  }

  private async handleConnectionUpdate(
    update: WhatsAppWebConnectionUpdate
  ): Promise<void> {
    if (update.connection === "open") {
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.clearQr();
      const userId =
        update.userId ??
        this.socket?.getUserId?.() ??
        null;
      this.phoneRaw = jidToPhone(userId);
      this.setState("CONNECTED", "WhatsApp Web connected");
      return;
    }

    if (update.connection === "logged_out") {
      // Terminal: clear timer first; never reconnect.
      this.connectionDesired = false;
      this.cancelHistorySync("logged_out");
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.closeContactPersistQueue("logged_out");
      this.clearQr();
      this.phoneRaw = null;
      this.socket = null;
      this.logConnectionClosed({
        statusCode: update.statusCode ?? 401,
        willRetry: false,
        nextState: "LOGGED_OUT",
      });
      this.setState("LOGGED_OUT", "WhatsApp session logged out");
      if (this.paths) {
        try {
          await deleteWhatsAppWebSessionDir(this.paths);
        } catch {
          logWhatsAppWeb("warn", "session_dir_cleanup_failed");
        }
      }
      return;
    }

    if (update.connection === "close") {
      this.cancelHistorySync("connection_close");
      this.socket = null;
      this.clearQr();

      // Manual stop / shutdown: close events must not reconnect.
      if (!this.connectionDesired || this.shuttingDown) {
        if (this.state !== "LOGGED_OUT" && this.state !== "DISCONNECTED") {
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
        await this.handleConnectionUpdate({
          connection: "logged_out",
          statusCode: update.statusCode,
        });
        return;
      }
      if (classification === "terminal") {
        this.connectionDesired = false;
        this.clearReconnectTimer();
        this.reconnectAttempt = 0;
        this.phoneRaw = null;
        this.logConnectionClosed({
          statusCode: update.statusCode,
          willRetry: false,
          nextState: "ERROR",
        });
        this.setState("ERROR", "WhatsApp Web session ended");
        return;
      }

      // Temporary / retryable network loss — reconnect policy unchanged.
      const willRetry = this.shouldReconnect();
      this.logConnectionClosed({
        statusCode: update.statusCode,
        willRetry,
        nextState: "RECONNECTING",
      });
      this.setState("RECONNECTING", "Reconnecting after network loss");
      this.scheduleReconnect();
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
