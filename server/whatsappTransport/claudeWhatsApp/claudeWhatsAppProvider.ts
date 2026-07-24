/**
 * Baileys socket lifecycle for Claude WhatsApp.
 * Distinguishes temporary disconnect (reconnecting) from logged-out (re-scan).
 */
import type { ClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import { getClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import { useClaudeWhatsAppAuthStore } from "./claudeWhatsAppAuthStore.ts";
import {
  CLAUDE_WHATSAPP_RECONNECT_BASE_MS,
  CLAUDE_WHATSAPP_RECONNECT_MAX_MS,
  type ClaudeWhatsAppDisconnectKind,
  type ClaudeWhatsAppLiveStatus,
} from "./claudeWhatsAppConstants.ts";
import { handleClaudeWhatsAppMessagesUpsert } from "./claudeWhatsAppInboundAdapter.ts";
import type { WhatsAppRepository } from "../whatsappRepository.ts";
import { createDefaultWhatsAppRepository } from "../whatsappRepository.ts";

export type ClaudeWhatsAppProviderStatus = {
  status: ClaudeWhatsAppLiveStatus;
  enabled: boolean;
  disconnectKind: ClaudeWhatsAppDisconnectKind;
  qr: string | null;
  lastError: string | null;
  phoneNumber: string | null;
  reconnectAttempt: number;
};

type WASocketLike = {
  ev: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    off?: (event: string, handler: (...args: any[]) => void) => void;
  };
  end?: (error?: Error) => void;
  logout?: () => Promise<void>;
  sendMessage: (
    jid: string,
    content: { text: string }
  ) => Promise<{ key?: { id?: string | null } } | undefined>;
  user?: { id?: string } | null;
};

export type ClaudeWhatsAppProviderDeps = {
  killSwitch?: ClaudeWhatsAppKillSwitch;
  repo?: WhatsAppRepository;
  autoLinkLead?: (conversationId: string) => Promise<unknown>;
  /** Disable auto-start reconnect loops in unit tests. */
  autoReconnect?: boolean;
  makeSocket?: (auth: unknown) => Promise<WASocketLike>;
  loadAuth?: () => ReturnType<typeof useClaudeWhatsAppAuthStore>;
};

export class ClaudeWhatsAppProvider {
  private socket: WASocketLike | null = null;
  private status: ClaudeWhatsAppLiveStatus = "disconnected";
  private disconnectKind: ClaudeWhatsAppDisconnectKind = "none";
  private qr: string | null = null;
  private lastError: string | null = null;
  private phoneNumber: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private starting = false;
  private stopped = true;
  private saveCreds: (() => Promise<void>) | null = null;
  private clearSession: (() => Promise<void>) | null = null;
  private readonly killSwitch: ClaudeWhatsAppKillSwitch;
  private readonly repo: WhatsAppRepository;
  private readonly autoLinkLead?: (conversationId: string) => Promise<unknown>;
  private readonly autoReconnect: boolean;
  private readonly makeSocket?: ClaudeWhatsAppProviderDeps["makeSocket"];
  private readonly loadAuth: NonNullable<ClaudeWhatsAppProviderDeps["loadAuth"]>;

  constructor(deps: ClaudeWhatsAppProviderDeps = {}) {
    this.killSwitch = deps.killSwitch ?? getClaudeWhatsAppKillSwitch();
    this.repo = deps.repo ?? createDefaultWhatsAppRepository();
    this.autoLinkLead = deps.autoLinkLead;
    this.autoReconnect = deps.autoReconnect !== false;
    this.makeSocket = deps.makeSocket;
    this.loadAuth = deps.loadAuth ?? (() => useClaudeWhatsAppAuthStore());
  }

  getStatus(): ClaudeWhatsAppProviderStatus {
    return {
      status: this.status,
      enabled: this.killSwitch.isEnabled(),
      disconnectKind: this.disconnectKind,
      qr: this.qr,
      lastError: this.lastError,
      phoneNumber: this.phoneNumber,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  getSocket(): WASocketLike | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.status === "connected" && this.socket != null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.killSwitch.start();
    await this.killSwitch.refresh();
    await this.connect();
  }

  async stop(opts?: { logout?: boolean }): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    if (opts?.logout && this.socket?.logout) {
      try {
        await this.socket.logout();
      } catch {
        /* ignore */
      }
      if (this.clearSession) await this.clearSession();
    } else if (this.socket?.end) {
      try {
        this.socket.end(undefined);
      } catch {
        /* ignore */
      }
    }
    this.socket = null;
    this.status = "disconnected";
    this.disconnectKind = "idle";
    this.qr = null;
  }

  /**
   * Kill-switch OFF: keep socket connected but idle (no new sends handled by
   * outbound port). Optionally soft-disconnect without clearing session.
   */
  async applyKillSwitch(enabled: boolean): Promise<void> {
    if (enabled) {
      if (this.stopped) {
        this.stopped = false;
        await this.connect();
      } else if (!this.socket && this.status !== "awaiting_qr") {
        await this.connect();
      }
      return;
    }
    // Idle mode — do not clear session / do not lose queued data.
    this.disconnectKind = "idle";
    this.qr = null;
  }

  async forceNewQr(): Promise<void> {
    await this.stop({ logout: true });
    this.stopped = false;
    await this.connect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.autoReconnect) return;
    if (this.disconnectKind === "logged_out") return;
    this.clearReconnectTimer();
    const delay = Math.min(
      CLAUDE_WHATSAPP_RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      CLAUDE_WHATSAPP_RECONNECT_MAX_MS
    );
    this.reconnectAttempt += 1;
    this.disconnectKind = "reconnecting";
    this.status = "disconnected";
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private async connect(): Promise<void> {
    if (this.starting || this.stopped) return;
    this.starting = true;
    this.clearReconnectTimer();
    try {
      const auth = await this.loadAuth();
      this.saveCreds = auth.saveCreds;
      this.clearSession = auth.clearSession;

      const socket = this.makeSocket
        ? await this.makeSocket(auth.state)
        : await this.createDefaultSocket(auth.state);

      this.socket = socket;
      this.status =
        this.status === "connected" ? "connected" : "awaiting_qr";

      socket.ev.on("creds.update", async () => {
        try {
          await this.saveCreds?.();
        } catch (err) {
          console.error("[claude-whatsapp] saveCreds failed:", err);
        }
      });

      socket.ev.on("connection.update", (update: Record<string, unknown>) => {
        void this.onConnectionUpdate(update);
      });

      // Inbound persistence is never gated by the kill switch — staff must see
      // customer messages that arrived while OFF. Only outbound send is gated
      // (claudeWhatsAppOutboundPort). No AI auto-reply hook rides this handler.
      socket.ev.on(
        "messages.upsert",
        (upsert: { type?: string; messages?: unknown[] }) => {
          void handleClaudeWhatsAppMessagesUpsert(
            upsert as {
              type?: string;
              messages?: Parameters<
                typeof handleClaudeWhatsAppMessagesUpsert
              >[0]["messages"];
            },
            {
              repo: this.repo,
              autoLinkLead: this.autoLinkLead,
              displayPhoneNumber: this.phoneNumber,
            }
          );
        }
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.status = "disconnected";
      this.disconnectKind = "reconnecting";
      this.scheduleReconnect();
    } finally {
      this.starting = false;
    }
  }

  private async createDefaultSocket(authState: unknown): Promise<WASocketLike> {
    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const version = await baileys.fetchLatestBaileysVersion().catch(() => null);
    return makeWASocket({
      auth: authState,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      ...(version ? { version: version.version } : {}),
    }) as WASocketLike;
  }

  private async onConnectionUpdate(
    update: Record<string, unknown>
  ): Promise<void> {
    const connection = update.connection as string | undefined;
    const qr = typeof update.qr === "string" ? update.qr : null;
    const lastDisconnect = update.lastDisconnect as
      | { error?: { output?: { statusCode?: number }; message?: string } }
      | undefined;

    if (qr) {
      this.qr = qr;
      this.status = "awaiting_qr";
      this.disconnectKind = "none";
      this.lastError = null;
    }

    if (connection === "open") {
      this.status = "connected";
      this.disconnectKind = "none";
      this.qr = null;
      this.reconnectAttempt = 0;
      this.lastError = null;
      const userId = this.socket?.user?.id;
      if (userId) {
        this.phoneNumber = String(userId).split(":")[0]?.split("@")[0] || null;
      }
      return;
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      let DisconnectReason: Record<string, number> = {};
      try {
        const baileys = await import("@whiskeysockets/baileys");
        DisconnectReason = baileys.DisconnectReason as Record<string, number>;
      } catch {
        DisconnectReason = { loggedOut: 401 };
      }
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      this.socket = null;
      this.qr = null;
      if (loggedOut) {
        this.status = "disconnected";
        this.disconnectKind = "logged_out";
        this.lastError =
          "Logged out — re-scan the QR code to reconnect Claude WhatsApp.";
        if (this.clearSession) {
          try {
            await this.clearSession();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      this.lastError =
        lastDisconnect?.error?.message ||
        "Temporarily disconnected — reconnecting…";
      this.disconnectKind = "reconnecting";
      this.status = "disconnected";
      this.scheduleReconnect();
    }
  }

  async sendText(toWaId: string, text: string): Promise<{ waMessageId: string }> {
    if (!this.socket || this.status !== "connected") {
      throw new Error("Claude WhatsApp socket is not connected");
    }
    const jid = toWaId.includes("@")
      ? toWaId
      : `${toWaId.replace(/\D/g, "")}@s.whatsapp.net`;
    const result = await this.socket.sendMessage(jid, { text });
    const id = result?.key?.id;
    if (!id) {
      throw new Error("Baileys send returned no message id");
    }
    return { waMessageId: `claude_${id}` };
  }
}

let providerSingleton: ClaudeWhatsAppProvider | null = null;

export function getClaudeWhatsAppProvider(
  deps?: ClaudeWhatsAppProviderDeps
): ClaudeWhatsAppProvider {
  if (!providerSingleton) {
    providerSingleton = new ClaudeWhatsAppProvider(deps);
  }
  return providerSingleton;
}

export function resetClaudeWhatsAppProviderForTests(): void {
  providerSingleton = null;
}
