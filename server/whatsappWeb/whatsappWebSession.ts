/**
 * Single-organization WhatsApp Web (Baileys) connection manager.
 *
 * - One active socket for Sunchaser
 * - QR generation / expiry / regeneration
 * - Automatic reconnect after temporary network loss
 * - Explicit disconnect / logout
 * - Mutex against concurrent socket starts
 * - Graceful shutdown (close socket, preserve auth unless logout)
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

export type WhatsAppWebInboundHandler = (message: {
  providerMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  text: string | null;
  pushName: string | null;
  occurredAt: string;
  isGroup: boolean;
  isStatusOrNewsletter: boolean;
  rawType: string | null;
}) => Promise<void>;

export type WhatsAppWebSocketHandle = {
  /** End the socket without deleting auth (disconnect / shutdown). */
  end: () => void;
  /** Logout remotely and invalidate session. */
  logout: () => Promise<void>;
  sendText: (jid: string, text: string) => Promise<{ providerMessageId: string }>;
  /** Optional: expose user id for tests. */
  userId?: string | null;
};

export type WhatsAppWebSocketFactory = (input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: {
    connection?: string;
    lastDisconnect?: { error?: { output?: { statusCode?: number } } };
    isNewLogin?: boolean;
  }) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
}) => Promise<WhatsAppWebSocketHandle>;

export type WhatsAppWebSessionOptions = {
  env?: NodeJS.ProcessEnv;
  config?: WhatsAppWebConfig;
  socketFactory?: WhatsAppWebSocketFactory;
  now?: () => Date;
  qrTtlMs?: number;
  inboundHandler?: WhatsAppWebInboundHandler | null;
};

async function defaultSocketFactory(input: {
  sessionDir: string;
  onQr: (qr: string) => void;
  onConnectionUpdate: (update: {
    connection?: string;
    lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  }) => void;
  onCredentialsSaved: () => void;
  onInbound: WhatsAppWebInboundHandler;
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
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", () => {
    void saveCreds().then(() => input.onCredentialsSaved());
  });

  sock.ev.on("connection.update", (update) => {
    const qr = (update as { qr?: string }).qr;
    if (typeof qr === "string" && qr.trim()) {
      input.onQr(qr);
    }
    input.onConnectionUpdate({
      connection: update.connection,
      lastDisconnect: update.lastDisconnect as {
        error?: { output?: { statusCode?: number } };
      },
    });
    // Surface logged-out via status code when connection closes.
    const statusCode = (
      update.lastDisconnect as { error?: { output?: { statusCode?: number } } }
    )?.error?.output?.statusCode;
    if (
      update.connection === "close" &&
      statusCode === DisconnectReason.loggedOut
    ) {
      input.onConnectionUpdate({
        connection: "logged_out",
        lastDisconnect: update.lastDisconnect as {
          error?: { output?: { statusCode?: number } };
        },
      });
    }
  });

  sock.ev.on("messages.upsert", (upsert) => {
    const messages = upsert.messages ?? [];
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
        });
      })().catch(() => {
        logWhatsAppWeb("warn", "inbound_handler_failed");
      });
    }
  });

  return {
    end: () => {
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    },
    logout: async () => {
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
    userId: sock.user?.id ?? null,
  };
}

export class WhatsAppWebSession {
  private readonly env: NodeJS.ProcessEnv;
  private readonly socketFactory: WhatsAppWebSocketFactory;
  private readonly now: () => Date;
  private readonly qrTtlMs: number;
  private inboundHandler: WhatsAppWebInboundHandler | null;

  private state: WhatsAppWebLifecycleState = "DISCONNECTED";
  private phoneRaw: string | null = null;
  private updatedAt: string;
  private safeMessage: string | null = null;
  private qrRaw: string | null = null;
  private qrExpiresAt: string | null = null;
  private qrDataUrl: string | null = null;

  private socket: WhatsAppWebSocketHandle | null = null;
  private startLock = false;
  private shuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private paths: ResolvedAuthPaths | null = null;

  constructor(options: WhatsAppWebSessionOptions = {}) {
    this.env = options.env ?? process.env;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date());
    this.qrTtlMs = options.qrTtlMs ?? WHATSAPP_WEB_QR_TTL_MS;
    this.inboundHandler = options.inboundHandler ?? null;
    this.updatedAt = this.now().toISOString();
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
        Date.parse(this.qrExpiresAt) > this.now().getTime()
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
   * Start / resume connection. Generates QR when no saved session exists.
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

  /** Soft disconnect — closes socket, keeps auth for reconnect. */
  async disconnect(): Promise<WhatsAppWebSafeStatus> {
    this.clearReconnectTimer();
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
   * Logout — invalidate remote device link and delete only the session directory.
   */
  async logout(): Promise<WhatsAppWebSafeStatus> {
    this.clearReconnectTimer();
    const config = this.getConfig();
    if (!config.enabled && !config.authDir) {
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

  /** Graceful shutdown — close socket, keep credentials. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.clearReconnectTimer();
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.clearQr();
    if (this.state === "CONNECTED" || this.state === "RECONNECTING") {
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
    }
  ): void {
    if (opts?.phoneRaw !== undefined) this.phoneRaw = opts.phoneRaw;
    if (opts?.safeMessage !== undefined) this.safeMessage = opts.safeMessage;
    if (opts?.qrRaw) {
      void this.acceptQr(opts.qrRaw);
    } else if (opts?.qrRaw === null) {
      this.clearQr();
    }
    this.setState(state, opts?.safeMessage ?? this.safeMessage);
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
    this.qrRaw = null;
    this.qrExpiresAt = null;
    this.qrDataUrl = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async acceptQr(qr: string): Promise<void> {
    // Never log qr contents.
    this.qrRaw = qr;
    const expires = new Date(this.now().getTime() + this.qrTtlMs);
    this.qrExpiresAt = expires.toISOString();
    this.qrDataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });
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
    if (this.shuttingDown) {
      throw Object.assign(new Error("WhatsApp Web is shutting down"), {
        code: "shutting_down",
      });
    }
    if (!this.paths) {
      throw new Error("Auth paths not resolved");
    }

    this.startLock = true;
    this.clearReconnectTimer();
    this.setState(initialState, "Starting WhatsApp Web connection");

    try {
      if (this.socket) {
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
      });
    } catch (err) {
      this.socket = null;
      this.setState(
        "ERROR",
        err instanceof Error ? "Connection failed" : "Connection failed"
      );
      throw err;
    } finally {
      this.startLock = false;
    }
  }

  private async handleConnectionUpdate(update: {
    connection?: string;
    lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  }): Promise<void> {
    if (this.shuttingDown) return;

    if (update.connection === "open") {
      this.clearQr();
      if (this.socket?.userId) {
        this.phoneRaw = jidToPhone(this.socket.userId);
      }
      this.setState("CONNECTED", "WhatsApp Web connected");
      return;
    }

    if (update.connection === "logged_out") {
      this.clearQr();
      this.phoneRaw = null;
      this.socket = null;
      this.setState("LOGGED_OUT", "WhatsApp session logged out");
      // Best-effort delete session files.
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
      this.socket = null;
      this.clearQr();
      if (this.shuttingDown) {
        this.setState("DISCONNECTED", "Disconnected");
        return;
      }
      this.setState("RECONNECTING", "Reconnecting after network loss");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shuttingDown) return;
      if (!this.getConfig().enabled) return;
      void this.startSocket("RECONNECTING").catch(() => {
        this.setState("ERROR", "Reconnect failed");
      });
    }, 2_000);
  }
}

function jidToPhone(jid: string): string | null {
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
