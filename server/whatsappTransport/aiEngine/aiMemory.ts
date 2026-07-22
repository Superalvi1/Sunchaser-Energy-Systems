/**
 * Structured Memory Model for Sunchaser Connect Phase 1B.
 * Stores extracted slots/parameters per conversation separate from chat transcript.
 */
import type {
  AiStructuredMemory,
  AiStructuredMemorySlotValue,
} from "./aiEngineTypes.ts";

export class AiMemoryStore {
  private readonly memories = new Map<string, Map<string, AiStructuredMemorySlotValue>>();

  getMemory(conversationId: string): AiStructuredMemory {
    const slotsMap = this.memories.get(conversationId);
    const slots: Record<string, AiStructuredMemorySlotValue> = {};
    if (slotsMap) {
      for (const [k, v] of slotsMap.entries()) {
        slots[k] = v;
      }
    }
    return {
      conversationId,
      slots,
      updatedAt: new Date().toISOString(),
    };
  }

  updateMemory(
    conversationId: string,
    extractions: Record<string, AiStructuredMemorySlotValue>
  ): AiStructuredMemory {
    let slotsMap = this.memories.get(conversationId);
    if (!slotsMap) {
      slotsMap = new Map();
      this.memories.set(conversationId, slotsMap);
    }

    for (const [key, value] of Object.entries(extractions)) {
      if (value !== undefined) {
        slotsMap.set(key, value);
      }
    }

    return this.getMemory(conversationId);
  }

  clearMemory(conversationId: string): void {
    this.memories.delete(conversationId);
  }
}
