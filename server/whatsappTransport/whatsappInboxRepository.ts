/**
 * PR 2 WhatsApp Shared Inbox — repository facade (Revision 3).
 *
 * Data-access composition only. No services, routes, permissions, or OCC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import {
  InMemoryWhatsAppInboxAssignmentRepository,
  SupabaseWhatsAppInboxAssignmentRepository,
  type WhatsAppInboxAssignmentRepository,
} from "./whatsappInboxAssignmentRepository.ts";
import {
  InMemoryWhatsAppInboxConversationRepository,
  SupabaseWhatsAppInboxConversationRepository,
  type WhatsAppInboxConversationRepository,
} from "./whatsappInboxConversationRepository.ts";
import {
  InMemoryWhatsAppInboxCrmLinkRepository,
  SupabaseWhatsAppInboxCrmLinkRepository,
  type WhatsAppInboxCrmLinkRepository,
} from "./whatsappInboxCrmLinkRepository.ts";
import {
  InMemoryWhatsAppInboxIdempotencyRepository,
  SupabaseWhatsAppInboxIdempotencyRepository,
  type WhatsAppInboxIdempotencyRepository,
} from "./whatsappInboxIdempotencyRepository.ts";
import {
  InMemoryWhatsAppInboxReadWatermarkRepository,
  SupabaseWhatsAppInboxReadWatermarkRepository,
  type WhatsAppInboxReadWatermarkRepository,
} from "./whatsappInboxReadWatermarkRepository.ts";
import { WhatsAppInboxMemoryStore } from "./whatsappInboxRepoSupport.ts";
import {
  InMemoryWhatsAppInboxStatusRepository,
  SupabaseWhatsAppInboxStatusRepository,
  type WhatsAppInboxStatusRepository,
} from "./whatsappInboxStatusRepository.ts";

export type WhatsAppInboxRepositories = {
  conversations: WhatsAppInboxConversationRepository;
  readWatermarks: WhatsAppInboxReadWatermarkRepository;
  assignments: WhatsAppInboxAssignmentRepository;
  statuses: WhatsAppInboxStatusRepository;
  crmLinks: WhatsAppInboxCrmLinkRepository;
  idempotency: WhatsAppInboxIdempotencyRepository;
};

export function createInMemoryWhatsAppInboxRepositories(
  store: WhatsAppInboxMemoryStore = new WhatsAppInboxMemoryStore()
): WhatsAppInboxRepositories & { store: WhatsAppInboxMemoryStore } {
  return {
    store,
    conversations: new InMemoryWhatsAppInboxConversationRepository(store),
    readWatermarks: new InMemoryWhatsAppInboxReadWatermarkRepository(store),
    assignments: new InMemoryWhatsAppInboxAssignmentRepository(store),
    statuses: new InMemoryWhatsAppInboxStatusRepository(store),
    crmLinks: new InMemoryWhatsAppInboxCrmLinkRepository(store),
    idempotency: new InMemoryWhatsAppInboxIdempotencyRepository(store),
  };
}

export function createSupabaseWhatsAppInboxRepositories(
  clientFactory?: () => SupabaseClient | null
): WhatsAppInboxRepositories {
  return {
    conversations: new SupabaseWhatsAppInboxConversationRepository(clientFactory),
    readWatermarks: new SupabaseWhatsAppInboxReadWatermarkRepository(clientFactory),
    assignments: new SupabaseWhatsAppInboxAssignmentRepository(clientFactory),
    statuses: new SupabaseWhatsAppInboxStatusRepository(clientFactory),
    crmLinks: new SupabaseWhatsAppInboxCrmLinkRepository(clientFactory),
    idempotency: new SupabaseWhatsAppInboxIdempotencyRepository(clientFactory),
  };
}

/**
 * Production factory — Supabase only.
 * Never falls back to in-memory persistence.
 * Tests must call createInMemoryWhatsAppInboxRepositories() explicitly.
 */
export function createDefaultWhatsAppInboxRepositories(
  clientFactory?: () => SupabaseClient | null
): WhatsAppInboxRepositories {
  const factory = clientFactory ?? getSupabase;
  if (!isSupabaseActive() || factory() === null) {
    throw new Error(
      "WhatsApp inbox repositories require active Supabase persistence. " +
        "Use createInMemoryWhatsAppInboxRepositories() for tests."
    );
  }
  return createSupabaseWhatsAppInboxRepositories(factory);
}

export type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
export type { WhatsAppInboxReadWatermarkRepository } from "./whatsappInboxReadWatermarkRepository.ts";
export type { WhatsAppInboxAssignmentRepository } from "./whatsappInboxAssignmentRepository.ts";
export type { WhatsAppInboxStatusRepository } from "./whatsappInboxStatusRepository.ts";
export type { WhatsAppInboxCrmLinkRepository } from "./whatsappInboxCrmLinkRepository.ts";
export type { WhatsAppInboxIdempotencyRepository } from "./whatsappInboxIdempotencyRepository.ts";
export type { ConversationListFilters, ConversationListPage } from "./whatsappInboxConversationRepository.ts";
export type { IdempotencyClaimResult } from "./whatsappInboxIdempotencyRepository.ts";
export { WhatsAppInboxMemoryStore } from "./whatsappInboxRepoSupport.ts";
export type { KeysetCursor, InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
