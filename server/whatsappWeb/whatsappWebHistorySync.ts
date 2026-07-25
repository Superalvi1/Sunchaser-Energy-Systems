/**
 * Admin-triggered WhatsApp Web contact sync + 7-day history backfill.
 * Single-flight job; injectable sync source; never sends messages or runs AI.
 */
import { randomUUID } from "node:crypto";
import type { WhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  persistWhatsAppWebBackfillMessage,
  syncWhatsAppWebContact,
} from "./whatsappWebHistoryPersist.ts";
import {
  emptySyncJobSnapshot,
  isEligibleSyncChat,
  isEligibleSyncContact,
  syncWindowStartMs,
  WHATSAPP_WEB_SYNC_CHAT_BATCH_SIZE,
  WHATSAPP_WEB_SYNC_CHAT_CONCURRENCY,
  WHATSAPP_WEB_SYNC_MESSAGE_LIMIT_PER_CHAT,
  WHATSAPP_WEB_SYNC_WINDOW_DAYS,
  type WhatsAppWebSyncJobSnapshot,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";

export type WhatsAppWebHistorySyncDeps = {
  source: WhatsAppWebSyncSource;
  repo: WhatsAppRepository;
  now?: () => Date;
  windowDays?: number;
  messageLimitPerChat?: number;
  chatConcurrency?: number;
  chatBatchSize?: number;
};

export class WhatsAppWebHistorySyncService {
  private readonly source: WhatsAppWebSyncSource;
  private readonly repo: WhatsAppRepository;
  private readonly now: () => Date;
  private readonly windowDays: number;
  private readonly messageLimitPerChat: number;
  private readonly chatConcurrency: number;
  private readonly chatBatchSize: number;
  private snapshot: WhatsAppWebSyncJobSnapshot = emptySyncJobSnapshot();
  private running: Promise<WhatsAppWebSyncJobSnapshot> | null = null;
  private cancelRequested = false;

  constructor(deps: WhatsAppWebHistorySyncDeps) {
    this.source = deps.source;
    this.repo = deps.repo;
    this.now = deps.now ?? (() => new Date());
    this.windowDays = deps.windowDays ?? WHATSAPP_WEB_SYNC_WINDOW_DAYS;
    this.messageLimitPerChat =
      deps.messageLimitPerChat ?? WHATSAPP_WEB_SYNC_MESSAGE_LIMIT_PER_CHAT;
    this.chatConcurrency =
      deps.chatConcurrency ?? WHATSAPP_WEB_SYNC_CHAT_CONCURRENCY;
    this.chatBatchSize = deps.chatBatchSize ?? WHATSAPP_WEB_SYNC_CHAT_BATCH_SIZE;
  }

  getSnapshot(): WhatsAppWebSyncJobSnapshot {
    return { ...this.snapshot, windowDays: this.windowDays };
  }

  /** Soft-stop: finish current chat, skip remaining work. */
  requestCancel(): void {
    this.cancelRequested = true;
  }

  /**
   * Start sync or join the in-flight job (single-flight).
   */
  startOrJoin(): {
    accepted: boolean;
    joinedExisting: boolean;
    snapshot: WhatsAppWebSyncJobSnapshot;
    done: Promise<WhatsAppWebSyncJobSnapshot>;
  } {
    if (this.running) {
      return {
        accepted: true,
        joinedExisting: true,
        snapshot: this.getSnapshot(),
        done: this.running,
      };
    }
    if (!this.source.isConnected()) {
      this.snapshot = {
        ...emptySyncJobSnapshot(),
        status: "failed",
        errorSummary: "WhatsApp Web is not connected",
        completedAt: this.now().toISOString(),
        windowDays: this.windowDays,
      };
      return {
        accepted: false,
        joinedExisting: false,
        snapshot: this.getSnapshot(),
        done: Promise.resolve(this.getSnapshot()),
      };
    }

    this.cancelRequested = false;
    const jobId = `wa_sync_${randomUUID()}`;
    this.snapshot = {
      ...emptySyncJobSnapshot(),
      jobId,
      status: "starting",
      startedAt: this.now().toISOString(),
      windowDays: this.windowDays,
    };

    this.running = this.runJob().finally(() => {
      this.running = null;
    });

    return {
      accepted: true,
      joinedExisting: false,
      snapshot: this.getSnapshot(),
      done: this.running,
    };
  }

  private async runJob(): Promise<WhatsAppWebSyncJobSnapshot> {
    this.snapshot.status = "running";
    logWhatsAppWeb("info", "history_sync_started", {
      windowDays: this.windowDays,
    });

    try {
      const selfJid = this.source.getSelfJid();
      const sinceMs = syncWindowStartMs(this.now().getTime(), this.windowDays);

      const contacts = (await this.source.listContacts()).filter((c) =>
        isEligibleSyncContact(c, selfJid)
      );
      this.snapshot.contactsDiscovered = contacts.length;

      for (const contact of contacts) {
        if (this.cancelRequested) break;
        try {
          const result = await syncWhatsAppWebContact(contact, {
            repo: this.repo,
            now: this.now,
          });
          if (result.created) this.snapshot.contactsCreated += 1;
          else if (result.updated) this.snapshot.contactsUpdated += 1;
        } catch {
          logWhatsAppWeb("warn", "history_sync_contact_failed");
        }
      }

      const chats = (await this.source.listChats()).filter((c) =>
        isEligibleSyncChat(c, selfJid)
      );

      for (let i = 0; i < chats.length; i += this.chatBatchSize) {
        if (this.cancelRequested) break;
        const batch = chats.slice(i, i + this.chatBatchSize);
        await mapPool(batch, this.chatConcurrency, async (chat) => {
          if (this.cancelRequested) return;
          this.snapshot.chatsInspected += 1;
          try {
            // Ensure contact exists for chat participants.
            if (chat.phoneE164) {
              const synced = await syncWhatsAppWebContact(
                {
                  jid: chat.jid,
                  phoneE164: chat.phoneE164,
                  savedName: chat.name,
                  pushName: null,
                  shortName: null,
                  isBusiness: false,
                },
                { repo: this.repo, now: this.now }
              );
              if (synced.created) this.snapshot.contactsCreated += 1;
              else if (synced.updated) this.snapshot.contactsUpdated += 1;
            }

            const messages = await this.source.fetchMessages(chat.jid, {
              limit: this.messageLimitPerChat,
              sinceMs,
            });
            const inWindow = messages.filter((m) => {
              const ts = Date.parse(m.occurredAt);
              return Number.isFinite(ts) && ts >= sinceMs;
            });
            inWindow.sort(
              (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
            );

            let touchedConversation = false;
            let createdConversation = false;
            for (const message of inWindow) {
              if (this.cancelRequested) break;
              const result = await persistWhatsAppWebBackfillMessage(message, {
                repo: this.repo,
                now: this.now,
              });
              if (result.kind === "imported") {
                this.snapshot.messagesImported += 1;
                touchedConversation = true;
                if (result.conversationCreated) createdConversation = true;
              } else if (result.kind === "duplicate") {
                this.snapshot.duplicatesSkipped += 1;
              }
            }
            if (touchedConversation) {
              if (createdConversation) {
                this.snapshot.conversationsCreated += 1;
              } else {
                this.snapshot.conversationsUpdated += 1;
              }
            }
          } catch {
            this.snapshot.failedChats += 1;
            logWhatsAppWeb("warn", "history_sync_chat_failed");
          }
        });
      }

      this.snapshot.status = this.cancelRequested ? "completed" : "completed";
      this.snapshot.completedAt = this.now().toISOString();
      if (this.cancelRequested && !this.snapshot.errorSummary) {
        this.snapshot.errorSummary = "Sync stopped early (session disconnect)";
      }
      logWhatsAppWeb("info", "history_sync_completed", {
        messagesImported: this.snapshot.messagesImported,
        failedChats: this.snapshot.failedChats,
        duplicatesSkipped: this.snapshot.duplicatesSkipped,
      });
      return this.getSnapshot();
    } catch {
      this.snapshot.status = "failed";
      this.snapshot.completedAt = this.now().toISOString();
      this.snapshot.errorSummary = "Sync failed";
      logWhatsAppWeb("error", "history_sync_failed");
      return this.getSnapshot();
    }
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) return;
        await worker(next);
      }
    }
  );
  await Promise.all(runners);
}
