/**
 * Conversation model — the durable record of one actor↔agent thread.
 *
 * Storage is abstracted behind ConversationMemoryStore (see AIMemory.ts);
 * these are the shapes every store must persist.
 */

import type { AIMessage } from "./AIProvider.ts";
import type { AIToolCallRecord } from "./AIResponse.ts";
import type { AIAction } from "./AIResponse.ts";

export interface ConversationSummary {
  /** Compressed representation of older turns, oldest first. */
  content: string;
  /** How many messages this summary replaced. */
  coversMessages: number;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  agentId: string;
  actorUserId: string;
  /** Full ordered transcript (post-summarization tail). */
  messages: AIMessage[];
  /** Every tool call ever made in this conversation, oldest first. */
  toolHistory: AIToolCallRecord[];
  summaries: ConversationSummary[];
  /** Actions produced by the most recent turn. */
  lastActions: AIAction[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurn {
  messages: AIMessage[];
  toolCalls: AIToolCallRecord[];
  actions: AIAction[];
}

export function createConversationRecord(args: {
  id: string;
  agentId: string;
  actorUserId: string;
  now: string;
}): ConversationRecord {
  return {
    id: args.id,
    agentId: args.agentId,
    actorUserId: args.actorUserId,
    messages: [],
    toolHistory: [],
    summaries: [],
    lastActions: [],
    createdAt: args.now,
    updatedAt: args.now,
  };
}
