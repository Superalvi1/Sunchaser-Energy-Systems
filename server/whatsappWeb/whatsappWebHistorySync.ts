/**
 * Admin-triggered WhatsApp Web contact sync + available-history backfill.
 * Single-flight job; injectable sync source; never sends messages or runs AI.
 * History coverage/outcomes are reported truthfully (never claims a full 7-day import).
 */
import { randomUUID } from "node:crypto";
import type { WhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { DEFAULT_COMPANY_ID } from "../whatsappTransport/whatsappConstants.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  persistWhatsAppWebBackfillMessage,
  syncWhatsAppWebContact,
} from "./whatsappWebHistoryPersist.ts";
import {
  createWhatsAppWebSyncJobStore,
  jobRecordToSnapshot,
  snapshotToJobRecord,
  type WhatsAppWebSyncJobStore,
} from "./whatsappWebSyncJobStore.ts";
import {
  deriveSyncOutcome,
  emptySyncJobSnapshot,
  isEligibleSyncChat,
  isEligibleSyncContact,
  syncWindowStartMs,
  WHATSAPP_WEB_SYNC_CHAT_BATCH_SIZE,
  WHATSAPP_WEB_SYNC_CHAT_CONCURRENCY,
  WHATSAPP_WEB_SYNC_MESSAGE_LIMIT_PER_CHAT,
  WHATSAPP_WEB_SYNC_WINDOW_DAYS,
  type WhatsAppWebHistoryAvailability,
  type WhatsAppWebHistoryCoverageMeta,
  type WhatsAppWebSyncJobSnapshot,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";
import type { BaileysInMemorySyncSource } from "./whatsappWebBaileysSyncSource.ts";

export type WhatsAppWebHistorySyncDeps = {
  source: WhatsAppWebSyncSource;
  repo: WhatsAppRepository;
  now?: () => Date;
  windowDays?: number;
  messageLimitPerChat?: number;
  chatConcurrency?: number;
  chatBatchSize?: number;
  jobStore?: WhatsAppWebSyncJobStore;
  companyId?: string;
};

export class WhatsAppWebHistorySyncService {
  private readonly source: WhatsAppWebSyncSource;
  private readonly repo: WhatsAppRepository;
  private readonly now: () => Date;
  private readonly windowDays: number;
  private readonly messageLimitPerChat: number;
  private readonly chatConcurrency: number;
  private readonly chatBatchSize: number;
  private readonly jobStore: WhatsAppWebSyncJobStore;
  private readonly companyId: string;
  private snapshot: WhatsAppWebSyncJobSnapshot = emptySyncJobSnapshot();
  private running: Promise<WhatsAppWebSyncJobSnapshot> | null = null;
  /** True when cancel was accepted for the active operation. */
  private cancelRequested = false;
  /** Operation identity for the in-flight (or last accepted) job. */
  private activeOperationId: string | null = null;
  private durableLoaded = false;

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
    this.jobStore = deps.jobStore ?? createWhatsAppWebSyncJobStore();
    this.companyId = deps.companyId ?? DEFAULT_COMPANY_ID;
  }

  getSnapshot(): WhatsAppWebSyncJobSnapshot {
    return { ...this.snapshot, windowDays: this.windowDays };
  }

  /** Load durable latest result when in-memory snapshot is idle. */
  async getDurableSnapshot(): Promise<WhatsAppWebSyncJobSnapshot> {
    if (this.running) return this.getSnapshot();
    if (
      this.snapshot.status !== "idle" &&
      this.snapshot.status !== "starting" &&
      this.snapshot.status !== "running"
    ) {
      return this.getSnapshot();
    }
    const latest = await this.jobStore.getLatest(this.companyId);
    if (latest) {
      this.snapshot = jobRecordToSnapshot(latest);
      this.durableLoaded = true;
    }
    return this.getSnapshot();
  }

  /**
   * Request cancellation of the in-flight sync.
   * Idempotent; safe to call repeatedly. No-ops when idle or already terminal.
   * Once accepted while starting/running, observable snapshot.cancelled becomes
   * true immediately and cannot later be overwritten by a success outcome.
   */
  requestCancel(): void {
    if (!this.running) return;
    // Do not rewrite a job that already finalized without cancellation.
    if (
      this.snapshot.status !== "starting" &&
      this.snapshot.status !== "running"
    ) {
      return;
    }
    this.cancelRequested = true;
    if (
      this.snapshot.jobId &&
      this.snapshot.jobId === this.activeOperationId
    ) {
      this.snapshot.cancelled = true;
    }
  }

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
      const jobId = `wa_sync_${randomUUID()}`;
      this.activeOperationId = jobId;
      this.snapshot = {
        ...emptySyncJobSnapshot(),
        jobId,
        status: "failed",
        outcome: "failed",
        errorSummary: "WhatsApp Web is not connected",
        completedAt: this.now().toISOString(),
        windowDays: this.windowDays,
        historyCoverage: "unknown",
        historyAvailability: "history_not_available",
        historySourceReady: false,
      };
      void this.persistDurable(jobId);
      return {
        accepted: false,
        joinedExisting: false,
        snapshot: this.getSnapshot(),
        done: Promise.resolve(this.getSnapshot()),
      };
    }

    this.cancelRequested = false;
    const jobId = `wa_sync_${randomUUID()}`;
    this.activeOperationId = jobId;
    this.snapshot = {
      ...emptySyncJobSnapshot(),
      jobId,
      status: "starting",
      startedAt: this.now().toISOString(),
      windowDays: this.windowDays,
    };

    const operationId = jobId;
    this.running = this.runJob(operationId).finally(() => {
      if (this.activeOperationId === operationId) {
        this.running = null;
      }
    });

    return {
      accepted: true,
      joinedExisting: false,
      snapshot: this.getSnapshot(),
      done: this.running,
    };
  }

  private isActiveOperation(operationId: string): boolean {
    return this.activeOperationId === operationId;
  }

  private isCancelAccepted(operationId: string): boolean {
    return (
      this.isActiveOperation(operationId) &&
      (this.cancelRequested || this.snapshot.cancelled)
    );
  }

  private applyCoverage(meta: WhatsAppWebHistoryCoverageMeta): void {
    this.snapshot.historySourceReady = meta.sourceReady;
    this.snapshot.historyCoverage = meta.coverage;
    this.snapshot.historyProviderEventObserved =
      meta.providerHistoryEventObserved;
    this.snapshot.historyOldestAvailableAt = meta.oldestAvailableAt;
    this.snapshot.historyNewestAvailableAt = meta.newestAvailableAt;
    this.snapshot.historyOnDemandSupported = meta.onDemandHistorySupported;
  }

  private resolveCoverage(sinceMs: number): WhatsAppWebHistoryCoverageMeta {
    if (this.source.getHistoryCoverageMeta) {
      return this.source.getHistoryCoverageMeta(sinceMs);
    }
    return {
      sourceReady: false,
      coverage: "unknown",
      providerHistoryEventObserved: false,
      oldestAvailableAt: null,
      newestAvailableAt: null,
      onDemandHistorySupported: false,
    };
  }

  private readAvailability(): WhatsAppWebHistoryAvailability {
    const src = this.source as Partial<BaileysInMemorySyncSource>;
    if (typeof src.getLastHistoryAvailability === "function") {
      return src.getLastHistoryAvailability();
    }
    if (!this.snapshot.historySourceReady) {
      return this.snapshot.historyProviderEventObserved
        ? "history_not_available"
        : "empty_companion_cache";
    }
    if (this.snapshot.historyCoverage === "partial") return "partially_available";
    if (this.snapshot.historyCoverage === "empty") return "history_not_available";
    if (this.snapshot.historyCoverage === "available_only") return "ready";
    return "unknown";
  }

  private async persistDurable(operationId: string): Promise<void> {
    if (!this.isActiveOperation(operationId)) return;
    const record = snapshotToJobRecord(this.snapshot, this.companyId);
    if (!record) return;
    const result = await this.jobStore.saveLatest(record);
    if (!this.isActiveOperation(operationId)) return;
    if (result.warning) {
      this.snapshot.durabilityWarning = result.warning;
    }
  }

  private finalizeTerminal(operationId: string): void {
    if (!this.isActiveOperation(operationId)) return;

    if (this.cancelRequested || this.snapshot.cancelled) {
      this.snapshot.cancelled = true;
    }

    this.snapshot.historyAvailability = this.readAvailability();
    this.snapshot.outcome = deriveSyncOutcome(this.snapshot);

    // Cancelled jobs must never be reported as ordinary success.
    if (
      this.snapshot.cancelled &&
      (this.snapshot.outcome === "completed_with_imports" ||
        this.snapshot.outcome === "completed_no_changes")
    ) {
      this.snapshot.outcome =
        this.snapshot.messagesImported > 0 ||
        this.snapshot.contactsCreated > 0 ||
        this.snapshot.contactsUpdated > 0 ||
        this.snapshot.conversationsCreated > 0 ||
        this.snapshot.conversationsUpdated > 0 ||
        this.snapshot.duplicatesSkipped > 0 ||
        this.snapshot.failedChats > 0
          ? "partial"
          : "history_not_available";
    }

    if (this.snapshot.cancelled) {
      this.snapshot.errorSummary =
        this.snapshot.errorSummary ||
        (this.snapshot.outcome === "partial"
          ? "Sync interrupted (cancel/disconnect) after partial imports."
          : "Sync interrupted (cancel/disconnect); no imports completed.");
      return;
    }

    if (this.snapshot.outcome === "history_not_available") {
      this.snapshot.errorSummary =
        this.snapshot.errorSummary ||
        "No session-available WhatsApp history/contacts were ready to import (empty companion cache or missing history cursor). This is not a full 7-day archive.";
    } else if (this.snapshot.outcome === "partial") {
      this.snapshot.errorSummary =
        this.snapshot.errorSummary ||
        "Sync finished with partial results; some chats failed or history was incomplete.";
    } else if (this.snapshot.outcome === "completed_with_imports") {
      this.snapshot.errorSummary =
        this.snapshot.errorSummary ||
        "Imported available WhatsApp history for this session (not a guaranteed full 7-day archive)";
    } else if (this.snapshot.outcome === "completed_no_changes") {
      this.snapshot.errorSummary =
        this.snapshot.errorSummary ||
        "Sync completed with no new imports (duplicates or metadata-only updates).";
    }
  }

  private async runJob(
    operationId: string,
  ): Promise<WhatsAppWebSyncJobSnapshot> {
    // Persist starting state before any contact/message processing.
    await this.persistDurable(operationId);
    if (!this.isActiveOperation(operationId)) {
      return this.getSnapshot();
    }
    if (this.isCancelAccepted(operationId)) {
      return this.finishCancelled(operationId);
    }

    this.snapshot.status = "running";
    logWhatsAppWeb("info", "history_sync_started", {
      windowDays: this.windowDays,
    });

    try {
      const selfJid = this.source.getSelfJid();
      const sinceMs = syncWindowStartMs(this.now().getTime(), this.windowDays);

      this.applyCoverage(this.resolveCoverage(sinceMs));

      const contacts = (await this.source.listContacts()).filter((c) =>
        isEligibleSyncContact(c, selfJid),
      );
      if (!this.isActiveOperation(operationId)) return this.getSnapshot();
      this.snapshot.contactsDiscovered = contacts.length;

      for (const contact of contacts) {
        if (this.isCancelAccepted(operationId)) break;
        try {
          const result = await syncWhatsAppWebContact(contact, {
            repo: this.repo,
            now: this.now,
          });
          if (!this.isActiveOperation(operationId)) return this.getSnapshot();
          if (result.created) this.snapshot.contactsCreated += 1;
          else if (result.updated) this.snapshot.contactsUpdated += 1;
          else this.snapshot.contactsSkipped += 1;
        } catch {
          if (!this.isActiveOperation(operationId)) return this.getSnapshot();
          this.snapshot.contactsSkipped += 1;
          logWhatsAppWeb("warn", "history_sync_contact_failed");
        }
      }

      if (this.isCancelAccepted(operationId)) {
        return this.finishCancelled(operationId);
      }

      const chats = (await this.source.listChats()).filter((c) =>
        isEligibleSyncChat(c, selfJid),
      );
      if (!this.isActiveOperation(operationId)) return this.getSnapshot();

      for (let i = 0; i < chats.length; i += this.chatBatchSize) {
        if (this.isCancelAccepted(operationId)) break;
        const batch = chats.slice(i, i + this.chatBatchSize);
        await mapPool(batch, this.chatConcurrency, async (chat) => {
          if (this.isCancelAccepted(operationId)) return;
          if (!this.isActiveOperation(operationId)) return;
          this.snapshot.chatsInspected += 1;
          try {
            if (chat.phoneE164) {
              const synced = await syncWhatsAppWebContact(
                {
                  jid: chat.jid,
                  phoneE164: chat.phoneE164,
                  savedName: null,
                  pushName: chat.name,
                  shortName: null,
                  isBusiness: false,
                },
                { repo: this.repo, now: this.now },
              );
              if (!this.isActiveOperation(operationId)) return;
              if (synced.created) this.snapshot.contactsCreated += 1;
              else if (synced.updated) this.snapshot.contactsUpdated += 1;
            }

            const messages = await this.source.fetchMessages(chat.jid, {
              limit: this.messageLimitPerChat,
              sinceMs,
            });
            if (!this.isActiveOperation(operationId)) return;
            this.snapshot.messagesDiscovered += messages.length;
            const inWindow = messages.filter((m) => {
              const ts = Date.parse(m.occurredAt);
              return Number.isFinite(ts) && ts >= sinceMs;
            });
            inWindow.sort(
              (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
            );

            let touchedConversation = false;
            let createdConversation = false;
            for (const message of inWindow) {
              if (this.isCancelAccepted(operationId)) break;
              const result = await persistWhatsAppWebBackfillMessage(message, {
                repo: this.repo,
                now: this.now,
              });
              if (!this.isActiveOperation(operationId)) return;
              if (result.kind === "imported") {
                this.snapshot.messagesImported += 1;
                touchedConversation = true;
                if (result.conversationCreated) createdConversation = true;
              } else if (result.kind === "duplicate") {
                this.snapshot.duplicatesSkipped += 1;
                this.snapshot.messagesSkipped += 1;
              } else {
                this.snapshot.messagesSkipped += 1;
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
            if (!this.isActiveOperation(operationId)) return;
            this.snapshot.failedChats += 1;
            logWhatsAppWeb("warn", "history_sync_chat_failed");
          }
        });
      }

      if (!this.isActiveOperation(operationId)) return this.getSnapshot();

      if (this.isCancelAccepted(operationId)) {
        return this.finishCancelled(operationId);
      }

      this.applyCoverage(this.resolveCoverage(sinceMs));

      // Re-check cancel after coverage work — late cancel must win over success.
      if (this.isCancelAccepted(operationId)) {
        return this.finishCancelled(operationId);
      }

      this.snapshot.status = "completed";
      this.snapshot.completedAt = this.now().toISOString();
      this.finalizeTerminal(operationId);

      logWhatsAppWeb("info", "history_sync_completed", {
        messagesImported: this.snapshot.messagesImported,
        failedChats: this.snapshot.failedChats,
        duplicatesSkipped: this.snapshot.duplicatesSkipped,
        historyCoverage: this.snapshot.historyCoverage,
        outcome: this.snapshot.outcome,
        cancelled: this.snapshot.cancelled,
      });
      await this.persistDurable(operationId);
      return this.getSnapshot();
    } catch {
      if (!this.isActiveOperation(operationId)) return this.getSnapshot();
      // Prefer cancel semantics over operational failure when cancel was accepted.
      if (this.isCancelAccepted(operationId)) {
        return this.finishCancelled(operationId);
      }
      this.snapshot.status = "failed";
      this.snapshot.outcome = "failed";
      this.snapshot.completedAt = this.now().toISOString();
      this.snapshot.errorSummary = "Sync failed";
      this.snapshot.historyAvailability = "history_not_available";
      logWhatsAppWeb("error", "history_sync_failed");
      await this.persistDurable(operationId);
      return this.getSnapshot();
    }
  }

  private async finishCancelled(
    operationId: string,
  ): Promise<WhatsAppWebSyncJobSnapshot> {
    if (!this.isActiveOperation(operationId)) return this.getSnapshot();
    this.snapshot.cancelled = true;
    // Cancellation is not an operational failure — terminal status stays completed.
    this.snapshot.status = "completed";
    this.snapshot.completedAt = this.now().toISOString();
    this.finalizeTerminal(operationId);
    logWhatsAppWeb("info", "history_sync_completed", {
      messagesImported: this.snapshot.messagesImported,
      failedChats: this.snapshot.failedChats,
      duplicatesSkipped: this.snapshot.duplicatesSkipped,
      historyCoverage: this.snapshot.historyCoverage,
      outcome: this.snapshot.outcome,
      cancelled: this.snapshot.cancelled,
    });
    await this.persistDurable(operationId);
    return this.getSnapshot();
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
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
    },
  );
  await Promise.all(runners);
}
