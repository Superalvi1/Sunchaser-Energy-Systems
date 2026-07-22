/**
 * AI Prompt Builder for Sunchaser Connect Phase 1B.
 * Formats system prompts and structured context for provider consumption.
 */
import type { AiPromptContext, AiPromptRequest } from "./aiEngineTypes.ts";

export class AiPromptBuilder {
  private readonly defaultSystemPrompt = `
You are Sunchaser AI, an assistant for Sunchaser Energy Systems — a solar solutions provider in Pakistan.
Your role is to assist potential customers, qualify solar system requirements (5kW, 10kW, 15kW, On-Grid, Hybrid), answer inquiries politely, and route complex requests to human solar consultants.

Rules:
1. Always evaluate input carefully.
2. Produce structured decisions containing action, proposedReply, confidence (0.0-1.0), suggestedStateTransition, extractedMemory, and reasoning.
3. If customer asks for human assistance or price quotes beyond standard info, set action = ESCALATE_HUMAN.
`.trim();

  buildPromptRequest(
    context: AiPromptContext,
    customSystemPrompt?: string
  ): AiPromptRequest {
    const systemPrompt = customSystemPrompt || this.defaultSystemPrompt;

    const memoryFormatted = Object.keys(context.memory).length > 0
      ? JSON.stringify(context.memory, null, 2)
      : "None";

    const crmFormatted = context.crmLead
      ? `Lead ID: ${context.crmLead.leadId}, Name: ${context.crmLead.name || "N/A"}, City: ${context.crmLead.city || "N/A"}`
      : "Not linked";

    const transcriptFormatted = context.recentMessages.length > 0
      ? context.recentMessages
          .map((m) => `[${m.occurredAt}] ${m.direction.toUpperCase()}: ${m.textBody || "(non-text message)"}`)
          .join("\n")
      : "No prior messages";

    const userPrompt = `
Conversation ID: ${context.conversationId}
Current State: ${context.currentState}
Contact: ${context.contactName || "Unknown"} (${context.contactPhone || "N/A"})
CRM Context: ${crmFormatted}
Structured Memory:
${memoryFormatted}

Recent Transcript:
${transcriptFormatted}

Evaluate the latest customer message and determine the optimal decision.
`.trim();

    return {
      context,
      systemPrompt,
      userPrompt,
    };
  }
}
