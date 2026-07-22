/**
 * AI Provider Abstraction and Mock Implementation for Sunchaser Connect Phase 1B.
 * Requires no external API keys; includes MockAiProvider for deterministic testing.
 */
import type { AiDecision, AiPromptRequest } from "./aiEngineTypes.ts";

export interface AiProvider {
  generateDecision(request: AiPromptRequest): Promise<AiDecision>;
}

export class MockAiProvider implements AiProvider {
  private customOverride: AiDecision | null = null;

  setDecisionOverride(decision: AiDecision | null): void {
    this.customOverride = decision;
  }

  async generateDecision(request: AiPromptRequest): Promise<AiDecision> {
    if (this.customOverride) {
      return this.customOverride;
    }

    const lastMessage = [...request.context.recentMessages]
      .reverse()
      .find((m) => m.direction === "inbound");
    const text = (lastMessage?.textBody || "").toLowerCase().trim();

    if (text.includes("human") || text.includes("agent") || text.includes("speak to manager")) {
      return {
        action: "ESCALATE_HUMAN",
        proposedReply: "I will connect you with a solar consultant right away.",
        confidence: 0.98,
        suggestedStateTransition: "ESCALATED",
        extractedMemory: { customerIntent: "human_agent_requested" },
        reasoning: "Customer explicitly requested human intervention.",
      };
    }

    if (text.includes("5kw") || text.includes("10kw") || text.includes("solar")) {
      const size = text.includes("10kw") ? "10kW" : "5kW";
      return {
        action: "REPLY",
        proposedReply: `Our ${size} solar system is ideal for residential power needs. Would you like a detailed quotation?`,
        confidence: 0.92,
        suggestedStateTransition: "QUALIFYING",
        extractedMemory: { systemSizeInterest: size },
        reasoning: `Identified customer interest in ${size} solar system.`,
      };
    }

    if (text.includes("hi") || text.includes("hello") || text.includes("assalam")) {
      return {
        action: "REPLY",
        proposedReply: "Hello! Welcome to Sunchaser Energy Systems. How can we assist with your solar requirements today?",
        confidence: 0.95,
        suggestedStateTransition: "GREETING",
        extractedMemory: { customerIntent: "greeting" },
        reasoning: "Customer initiated standard greeting.",
      };
    }

    return {
      action: "ASK_CLARIFICATION",
      proposedReply: "Thank you for reaching out. Could you specify your required solar system capacity or monthly bill?",
      confidence: 0.75,
      suggestedStateTransition: "QUALIFYING",
      extractedMemory: {},
      reasoning: "Input requires further clarification to extract solar requirements.",
    };
  }
}
