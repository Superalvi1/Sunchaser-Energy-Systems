/**
 * AI Context Builder for Sunchaser Connect Phase 1B.
 * Aggregates conversation state, CRM lead metadata, structured memory, and transcript.
 */
import type {
  AiConversationState,
  AiPromptContext,
  AiStructuredMemorySlotValue,
  CrmLeadContext,
  MessageTimelineItem,
} from "./aiEngineTypes.ts";

export type BuildContextInput = {
  conversationId: string;
  currentState?: AiConversationState;
  contactName?: string | null;
  contactPhone?: string | null;
  crmLead?: CrmLeadContext | null;
  memorySlots?: Record<string, AiStructuredMemorySlotValue>;
  recentMessages?: MessageTimelineItem[];
};

export class AiContextBuilder {
  buildContext(input: BuildContextInput): AiPromptContext {
    return {
      conversationId: input.conversationId,
      currentState: input.currentState ?? "GREETING",
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      crmLead: input.crmLead ?? null,
      memory: input.memorySlots ?? {},
      recentMessages: input.recentMessages ?? [],
    };
  }
}
