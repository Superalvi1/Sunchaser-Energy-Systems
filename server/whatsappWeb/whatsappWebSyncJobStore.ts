/**
 * Durable WhatsApp Web sync job results (non-PII operational fields only).
 * Supabase when active; in-memory fallback for tests / local JSON mode.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { DEFAULT_COMPANY_ID } from "../whatsappTransport/whatsappConstants.ts";
import type {
  WhatsAppWebHistoryAvailability,
  WhatsAppWebHistoryCoverage,
  WhatsAppWebSyncJobSnapshot,
  WhatsAppWebSyncJobStatus,
  WhatsAppWebSyncOutcome,
} from "./whatsappWebSyncTypes.ts";

export type WhatsAppWebSyncJobRecord = {
  companyId: string;
  jobId: string;
  status: WhatsAppWebSyncJobStatus;
  outcome: WhatsAppWebSyncOutcome;
  startedAt: string | null;
  completedAt: string | null;
  contactsDiscovered: number;
  contactsCreated: number;
  contactsUpdated: number;
  contactsSkipped: number;
  messagesDiscovered: number;
  messagesImported: number;
  messagesSkipped: number;
  duplicatesSkipped: number;
  failedChats: number;
  chatsInspected: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  historyCoverage: WhatsAppWebHistoryCoverage;
  historyAvailability: WhatsAppWebHistoryAvailability;
  historySourceReady: boolean;
  historyProviderEventObserved: boolean;
  historyOnDemandSupported: boolean;
  historyOldestAvailableAt: string | null;
  historyNewestAvailableAt: string | null;
  windowDays: number;
  errorSummary: string | null;
};

const memoryLatestByCompany = new Map<string, WhatsAppWebSyncJobRecord>();

export function __resetWhatsAppWebSyncJobMemoryStore(): void {
  memoryLatestByCompany.clear();
}

export function snapshotToJobRecord(
  snapshot: WhatsAppWebSyncJobSnapshot,
  companyId = DEFAULT_COMPANY_ID
): WhatsAppWebSyncJobRecord | null {
  if (!snapshot.jobId) return null;
  return {
    companyId,
    jobId: snapshot.jobId,
    status: snapshot.status,
    outcome: snapshot.outcome,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    contactsDiscovered: snapshot.contactsDiscovered,
    contactsCreated: snapshot.contactsCreated,
    contactsUpdated: snapshot.contactsUpdated,
    contactsSkipped: snapshot.contactsSkipped,
    messagesDiscovered: snapshot.messagesDiscovered,
    messagesImported: snapshot.messagesImported,
    messagesSkipped: snapshot.messagesSkipped,
    duplicatesSkipped: snapshot.duplicatesSkipped,
    failedChats: snapshot.failedChats,
    chatsInspected: snapshot.chatsInspected,
    conversationsCreated: snapshot.conversationsCreated,
    conversationsUpdated: snapshot.conversationsUpdated,
    historyCoverage: snapshot.historyCoverage,
    historyAvailability: snapshot.historyAvailability,
    historySourceReady: snapshot.historySourceReady,
    historyProviderEventObserved: snapshot.historyProviderEventObserved,
    historyOnDemandSupported: snapshot.historyOnDemandSupported,
    historyOldestAvailableAt: snapshot.historyOldestAvailableAt,
    historyNewestAvailableAt: snapshot.historyNewestAvailableAt,
    windowDays: snapshot.windowDays,
    errorSummary: snapshot.errorSummary,
  };
}

export function jobRecordToSnapshot(
  record: WhatsAppWebSyncJobRecord
): WhatsAppWebSyncJobSnapshot {
  return {
    jobId: record.jobId,
    status: record.status,
    outcome: record.outcome,
    contactsDiscovered: record.contactsDiscovered,
    contactsCreated: record.contactsCreated,
    contactsUpdated: record.contactsUpdated,
    contactsSkipped: record.contactsSkipped,
    chatsInspected: record.chatsInspected,
    conversationsCreated: record.conversationsCreated,
    conversationsUpdated: record.conversationsUpdated,
    messagesDiscovered: record.messagesDiscovered,
    messagesImported: record.messagesImported,
    duplicatesSkipped: record.duplicatesSkipped,
    messagesSkipped: record.messagesSkipped,
    failedChats: record.failedChats,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    errorSummary: record.errorSummary,
    windowDays: record.windowDays,
    historySourceReady: record.historySourceReady,
    historyCoverage: record.historyCoverage,
    historyAvailability: record.historyAvailability,
    historyProviderEventObserved: record.historyProviderEventObserved,
    historyOldestAvailableAt: record.historyOldestAvailableAt,
    historyNewestAvailableAt: record.historyNewestAvailableAt,
    historyOnDemandSupported: record.historyOnDemandSupported,
  };
}

function rowToRecord(row: Record<string, unknown>): WhatsAppWebSyncJobRecord {
  return {
    companyId: String(row.company_id),
    jobId: String(row.job_id),
    status: String(row.status) as WhatsAppWebSyncJobStatus,
    outcome: (row.outcome as WhatsAppWebSyncOutcome) ?? null,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    contactsDiscovered: Number(row.contacts_discovered ?? 0),
    contactsCreated: Number(row.contacts_created ?? 0),
    contactsUpdated: Number(row.contacts_updated ?? 0),
    contactsSkipped: Number(row.contacts_skipped ?? 0),
    messagesDiscovered: Number(row.messages_discovered ?? 0),
    messagesImported: Number(row.messages_imported ?? 0),
    messagesSkipped: Number(row.messages_skipped ?? 0),
    duplicatesSkipped: Number(row.duplicates_skipped ?? 0),
    failedChats: Number(row.failed_chats ?? 0),
    chatsInspected: Number(row.chats_inspected ?? 0),
    conversationsCreated: Number(row.conversations_created ?? 0),
    conversationsUpdated: Number(row.conversations_updated ?? 0),
    historyCoverage: String(
      row.history_coverage ?? "unknown"
    ) as WhatsAppWebHistoryCoverage,
    historyAvailability: String(
      row.history_availability ?? "unknown"
    ) as WhatsAppWebHistoryAvailability,
    historySourceReady: Boolean(row.history_source_ready),
    historyProviderEventObserved: Boolean(row.history_provider_event_observed),
    historyOnDemandSupported: Boolean(row.history_on_demand_supported),
    historyOldestAvailableAt: (row.history_oldest_available_at as string) ?? null,
    historyNewestAvailableAt: (row.history_newest_available_at as string) ?? null,
    windowDays: Number(row.window_days ?? 7),
    errorSummary: (row.error_summary as string) ?? null,
  };
}

export type WhatsAppWebSyncJobStore = {
  saveLatest(record: WhatsAppWebSyncJobRecord): Promise<void>;
  getLatest(companyId?: string): Promise<WhatsAppWebSyncJobRecord | null>;
};

export function createWhatsAppWebSyncJobStore(deps?: {
  client?: SupabaseClient | null;
}): WhatsAppWebSyncJobStore {
  return {
    async saveLatest(record) {
      memoryLatestByCompany.set(record.companyId, record);
      if (!isSupabaseActive() && !deps?.client) return;
      const client = deps?.client ?? getSupabase();
      if (!client) return;
      const payload = {
        company_id: record.companyId,
        job_id: record.jobId,
        status: record.status,
        outcome: record.outcome,
        started_at: record.startedAt,
        completed_at: record.completedAt,
        contacts_discovered: record.contactsDiscovered,
        contacts_created: record.contactsCreated,
        contacts_updated: record.contactsUpdated,
        contacts_skipped: record.contactsSkipped,
        messages_discovered: record.messagesDiscovered,
        messages_imported: record.messagesImported,
        messages_skipped: record.messagesSkipped,
        duplicates_skipped: record.duplicatesSkipped,
        failed_chats: record.failedChats,
        chats_inspected: record.chatsInspected,
        conversations_created: record.conversationsCreated,
        conversations_updated: record.conversationsUpdated,
        history_coverage: record.historyCoverage,
        history_availability: record.historyAvailability,
        history_source_ready: record.historySourceReady,
        history_provider_event_observed: record.historyProviderEventObserved,
        history_on_demand_supported: record.historyOnDemandSupported,
        history_oldest_available_at: record.historyOldestAvailableAt,
        history_newest_available_at: record.historyNewestAvailableAt,
        window_days: record.windowDays,
        error_summary: record.errorSummary,
        updated_at: new Date().toISOString(),
      };
      const { error } = await client
        .from("whatsapp_web_sync_jobs")
        .upsert(payload, { onConflict: "company_id" });
      if (error) {
        // Table may be unapplied — memory still holds the latest result.
      }
    },

    async getLatest(companyId = DEFAULT_COMPANY_ID) {
      if (isSupabaseActive() || deps?.client) {
        const client = deps?.client ?? getSupabase();
        if (client) {
          const { data, error } = await client
            .from("whatsapp_web_sync_jobs")
            .select("*")
            .eq("company_id", companyId)
            .maybeSingle();
          if (!error && data) {
            const record = rowToRecord(data as Record<string, unknown>);
            memoryLatestByCompany.set(companyId, record);
            return record;
          }
        }
      }
      return memoryLatestByCompany.get(companyId) ?? null;
    },
  };
}
