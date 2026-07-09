/**
 * Memory contracts.
 *
 * ConversationMemoryStore — required; an in-memory implementation ships in
 * memory/ConversationMemory.ts and any database-backed store can replace it
 * via dependency injection.
 *
 * CompanyMemory — interface only by design. It is the future bridge to CRM
 * knowledge (customer histories, playbooks, institutional facts). The engine
 * consumes it read-only through CompanyContextProvider adapters.
 */

import type { ConversationRecord, ConversationTurn } from "./AIConversation.ts";

export interface ConversationMemoryStore {
  /** Fetch a conversation, or null when it does not exist. */
  get(conversationId: string): Promise<ConversationRecord | null>;

  /** Fetch-or-create in one step (engines call this on every request). */
  getOrCreate(args: {
    conversationId: string;
    agentId: string;
    actorUserId: string;
  }): Promise<ConversationRecord>;

  /** Append one completed turn (messages + tool records + actions). */
  appendTurn(conversationId: string, turn: ConversationTurn): Promise<ConversationRecord>;

  /** Replace older messages with a summary (context-window management). */
  compact(conversationId: string, summaryContent: string, keepLastMessages: number): Promise<void>;

  /** List a user's conversations, newest first. */
  listForActor(actorUserId: string, limit?: number): Promise<ConversationRecord[]>;

  delete(conversationId: string): Promise<void>;
}

/** One retrievable company knowledge entry. */
export interface CompanyMemoryEntry {
  id: string;
  /** Namespace, e.g. "customers", "playbooks", "policies". */
  scope: string;
  title: string;
  content: string;
  metadata: Record<string, string>;
  updatedAt: string;
}

/**
 * Company-wide long-term memory. INTERFACE ONLY — implemented later by the
 * CRM integration layer (Supabase/vector store/etc.).
 */
export interface CompanyMemory {
  search(query: string, scope?: string, limit?: number): Promise<CompanyMemoryEntry[]>;
  get(id: string): Promise<CompanyMemoryEntry | null>;
  upsert(entry: Omit<CompanyMemoryEntry, "updatedAt">): Promise<CompanyMemoryEntry>;
  delete(id: string): Promise<void>;
}
