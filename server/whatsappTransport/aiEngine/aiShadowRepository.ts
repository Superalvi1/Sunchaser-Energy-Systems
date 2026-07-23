/**
 * AI Shadow Repository for Sunchaser Connect Phase 1B.
 * Persists AI evaluation logs during Shadow Mode without sending real messages.
 */
import type { AiShadowLogEntry } from "./aiEngineTypes.ts";

export interface AiShadowRepository {
  saveShadowLog(entry: Omit<AiShadowLogEntry, "id" | "evaluatedAt">): Promise<AiShadowLogEntry>;
  getShadowLogs(conversationId: string): Promise<AiShadowLogEntry[]>;
  clearShadowLogs(conversationId?: string): Promise<void>;
}

export class InMemoryAiShadowRepository implements AiShadowRepository {
  private readonly logs: AiShadowLogEntry[] = [];

  async saveShadowLog(
    entry: Omit<AiShadowLogEntry, "id" | "evaluatedAt">
  ): Promise<AiShadowLogEntry> {
    const fullEntry: AiShadowLogEntry = {
      ...entry,
      id: `shadow_log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      evaluatedAt: new Date().toISOString(),
    };
    this.logs.push(fullEntry);
    return fullEntry;
  }

  async getShadowLogs(conversationId: string): Promise<AiShadowLogEntry[]> {
    return this.logs.filter((log) => log.conversationId === conversationId);
  }

  async clearShadowLogs(conversationId?: string): Promise<void> {
    if (conversationId) {
      const idxs = [];
      for (let i = this.logs.length - 1; i >= 0; i--) {
        if (this.logs[i].conversationId === conversationId) {
          this.logs.splice(i, 1);
        }
      }
    } else {
      this.logs.length = 0;
    }
  }
}
