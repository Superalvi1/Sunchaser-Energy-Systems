/**
 * Sunchaser Connect Phase 1B: AI Conversation Engine Infrastructure Types.
 * Defines states, decisions, structured memory, and prompt contexts.
 */

export type AiConversationState =
  | "GREETING"
  | "QUALIFYING"
  | "INFO_PROVIDED"
  | "NEEDS_HUMAN"
  | "ESCALATED";

export const AI_CONVERSATION_STATES: readonly AiConversationState[] = [
  "GREETING",
  "QUALIFYING",
  "INFO_PROVIDED",
  "NEEDS_HUMAN",
  "ESCALATED",
] as const;

export type AiDecisionAction =
  | "REPLY"
  | "ASK_CLARIFICATION"
  | "ESCALATE_HUMAN"
  | "NO_ACTION";

export type AiDecision = {
  action: AiDecisionAction;
  proposedReply: string | null;
  confidence: number; // 0.0 to 1.0
  suggestedStateTransition: AiConversationState | null;
  extractedMemory: Record<string, string | number | boolean | null>;
  reasoning: string;
};

export type AiStructuredMemorySlotValue = string | number | boolean | null;

export type AiStructuredMemory = {
  conversationId: string;
  slots: Record<string, AiStructuredMemorySlotValue>;
  updatedAt: string;
};

export type MessageTimelineItem = {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  textBody: string | null;
  occurredAt: string;
};

export type CrmLeadContext = {
  leadId: string;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  systemSizeInterest?: string | null;
  status?: string | null;
};

export type AiPromptContext = {
  conversationId: string;
  currentState: AiConversationState;
  contactName: string | null;
  contactPhone: string | null;
  crmLead: CrmLeadContext | null;
  memory: Record<string, AiStructuredMemorySlotValue>;
  recentMessages: MessageTimelineItem[];
};

export type AiPromptRequest = {
  context: AiPromptContext;
  systemPrompt: string;
  userPrompt: string;
};

export type AiShadowLogEntry = {
  id: string;
  conversationId: string;
  stateBefore: AiConversationState;
  stateAfter: AiConversationState;
  decision: AiDecision;
  executionTimeMs: number;
  evaluatedAt: string;
};
