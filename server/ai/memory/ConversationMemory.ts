/**
 * In-memory ConversationMemoryStore.
 *
 * The default store for development and single-process deployments. It is a
 * complete, correct implementation of the contract — swap it for a
 * Supabase/Postgres-backed store via DI without touching the engine.
 */

import {
  createConversationRecord,
  type ConversationRecord,
  type ConversationTurn,
} from "../core/AIConversation.ts";
import type { ConversationMemoryStore } from "../core/AIMemory.ts";
import { AIError } from "../core/AIErrors.ts";

export interface InMemoryConversationMemoryOptions {
  /** Oldest conversations are evicted beyond this count. Default 1000. */
  maxConversations?: number;
  /** Messages kept verbatim per conversation before compaction is advised. */
  maxMessagesPerConversation?: number;
}

export class InMemoryConversationMemory implements ConversationMemoryStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly maxConversations: number;
  private readonly maxMessages: number;

  constructor(options: InMemoryConversationMemoryOptions = {}) {
    this.maxConversations = options.maxConversations ?? 1000;
    this.maxMessages = options.maxMessagesPerConversation ?? 200;
  }

  async get(conversationId: string): Promise<ConversationRecord | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async getOrCreate(args: {
    conversationId: string;
    agentId: string;
    actorUserId: string;
  }): Promise<ConversationRecord> {
    const existing = this.conversations.get(args.conversationId);
    if (existing) return existing;

    const record = createConversationRecord({
      id: args.conversationId,
      agentId: args.agentId,
      actorUserId: args.actorUserId,
      now: new Date().toISOString(),
    });
    this.conversations.set(args.conversationId, record);
    this.evictIfNeeded();
    return record;
  }

  async appendTurn(conversationId: string, turn: ConversationTurn): Promise<ConversationRecord> {
    const record = this.conversations.get(conversationId);
    if (!record) {
      throw new AIError("conversation_not_found", `Conversation not found: ${conversationId}`);
    }
    record.messages.push(...turn.messages);
    record.toolHistory.push(...turn.toolCalls);
    record.lastActions = turn.actions;
    record.updatedAt = new Date().toISOString();

    if (record.messages.length > this.maxMessages) {
      // Hard safety valve: drop oldest verbatim messages beyond the cap.
      // Deployments needing lossless history should compact() proactively
      // or use a persistent store.
      record.messages.splice(0, record.messages.length - this.maxMessages);
    }
    return record;
  }

  async compact(
    conversationId: string,
    summaryContent: string,
    keepLastMessages: number
  ): Promise<void> {
    const record = this.conversations.get(conversationId);
    if (!record) {
      throw new AIError("conversation_not_found", `Conversation not found: ${conversationId}`);
    }
    const removable = Math.max(0, record.messages.length - keepLastMessages);
    if (removable === 0) return;
    record.messages.splice(0, removable);
    record.summaries.push({
      content: summaryContent,
      coversMessages: removable,
      createdAt: new Date().toISOString(),
    });
    record.updatedAt = new Date().toISOString();
  }

  async listForActor(actorUserId: string, limit = 20): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((c) => c.actorUserId === actorUserId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async delete(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  private evictIfNeeded(): void {
    if (this.conversations.size <= this.maxConversations) return;
    const oldestFirst = [...this.conversations.values()].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
    const excess = this.conversations.size - this.maxConversations;
    for (let i = 0; i < excess; i += 1) {
      this.conversations.delete(oldestFirst[i].id);
    }
  }
}
