/**
 * AI Shadow Engine for Sunchaser Connect Phase 1B.
 * Evaluates inbound conversation context asynchronously in Shadow Mode.
 * NEVER sends outbound WhatsApp messages or alters customer delivery.
 */
import type {
  AiConversationState,
  AiDecision,
  AiPromptContext,
  AiShadowLogEntry,
  CrmLeadContext,
  MessageTimelineItem,
} from "./aiEngineTypes.ts";
import { AiContextBuilder } from "./aiContextBuilder.ts";
import { AiMemoryStore } from "./aiMemory.ts";
import { AiPromptBuilder } from "./aiPromptBuilder.ts";
import { type AiProvider, MockAiProvider } from "./aiProvider.ts";
import {
  type AiShadowRepository,
  InMemoryAiShadowRepository,
} from "./aiShadowRepository.ts";
import { AiStateMachine } from "./aiStateMachine.ts";

export type AiShadowEngineOptions = {
  enabled?: boolean;
  provider?: AiProvider;
  shadowRepo?: AiShadowRepository;
  memoryStore?: AiMemoryStore;
  contextBuilder?: AiContextBuilder;
  promptBuilder?: AiPromptBuilder;
  stateMachine?: AiStateMachine;
};

export type ShadowEvaluateInput = {
  conversationId: string;
  currentState?: AiConversationState;
  contactName?: string | null;
  contactPhone?: string | null;
  crmLead?: CrmLeadContext | null;
  recentMessages?: MessageTimelineItem[];
  messageText?: string;
};

export type ShadowEvaluateResult = {
  logEntry: AiShadowLogEntry;
  decision: AiDecision;
  stateBefore: AiConversationState;
  stateAfter: AiConversationState;
};

export class AiShadowEngine {
  private readonly enabled: boolean;
  private readonly provider: AiProvider;
  private readonly shadowRepo: AiShadowRepository;
  private readonly memoryStore: AiMemoryStore;
  private readonly contextBuilder: AiContextBuilder;
  private readonly promptBuilder: AiPromptBuilder;
  private readonly stateMachine: AiStateMachine;

  constructor(options: AiShadowEngineOptions = {}) {
    this.enabled =
      options.enabled ?? process.env.AI_SHADOW_ENGINE_ENABLED === "true";
    this.provider = options.provider ?? new MockAiProvider();
    this.shadowRepo = options.shadowRepo ?? new InMemoryAiShadowRepository();
    this.memoryStore = options.memoryStore ?? new AiMemoryStore();
    this.contextBuilder = options.contextBuilder ?? new AiContextBuilder();
    this.promptBuilder = options.promptBuilder ?? new AiPromptBuilder();
    this.stateMachine = options.stateMachine ?? new AiStateMachine();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMemoryStore(): AiMemoryStore {
    return this.memoryStore;
  }

  getShadowRepo(): AiShadowRepository {
    return this.shadowRepo;
  }

  /**
   * Evaluates an inbound conversation event in Shadow Mode.
   * Does NOT trigger outbound WhatsApp messages or alter production state.
   */
  async evaluateShadow(
    input: ShadowEvaluateInput
  ): Promise<ShadowEvaluateResult | null> {
    if (!this.enabled) {
      return null;
    }

    const startTime = Date.now();
    const currentState = input.currentState ?? "GREETING";

    // 1. Fetch existing memory slots for conversation
    const currentMemory = this.memoryStore.getMemory(input.conversationId);

    // 2. Build prompt context
    const context: AiPromptContext = this.contextBuilder.buildContext({
      conversationId: input.conversationId,
      currentState,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      crmLead: input.crmLead,
      memorySlots: currentMemory.slots,
      recentMessages: input.recentMessages ?? [],
    });

    // 3. Render prompt request
    const promptRequest = this.promptBuilder.buildPromptRequest(context);

    // 4. Query provider
    const decision = await this.provider.generateDecision(promptRequest);

    // 5. Update structured memory if extractions present
    if (
      decision.extractedMemory &&
      Object.keys(decision.extractedMemory).length > 0
    ) {
      this.memoryStore.updateMemory(
        input.conversationId,
        decision.extractedMemory
      );
    }

    // 6. Compute state transition safely
    const stateAfter = this.stateMachine.computeNextState(
      currentState,
      decision
    );
    const executionTimeMs = Date.now() - startTime;

    // 7. Save shadow evaluation log
    const logEntry = await this.shadowRepo.saveShadowLog({
      conversationId: input.conversationId,
      stateBefore: currentState,
      stateAfter,
      decision,
      executionTimeMs,
    });

    return {
      logEntry,
      decision,
      stateBefore: currentState,
      stateAfter,
    };
  }
}
