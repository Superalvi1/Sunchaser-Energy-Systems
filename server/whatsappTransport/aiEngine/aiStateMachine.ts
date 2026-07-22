/**
 * AI Conversation State Machine for Sunchaser Connect Phase 1B.
 * Manages valid conversation states and state transition safety.
 */
import type { AiConversationState, AiDecision } from "./aiEngineTypes.ts";

const VALID_TRANSITIONS: Record<AiConversationState, readonly AiConversationState[]> = {
  GREETING: ["GREETING", "QUALIFYING", "NEEDS_HUMAN", "ESCALATED"],
  QUALIFYING: ["QUALIFYING", "INFO_PROVIDED", "NEEDS_HUMAN", "ESCALATED"],
  INFO_PROVIDED: ["INFO_PROVIDED", "QUALIFYING", "NEEDS_HUMAN", "ESCALATED"],
  NEEDS_HUMAN: ["NEEDS_HUMAN", "ESCALATED", "QUALIFYING"],
  ESCALATED: ["ESCALATED", "QUALIFYING"],
};

export class AiStateMachine {
  /** Check if a state transition from `fromState` to `toState` is allowed. */
  canTransition(fromState: AiConversationState, toState: AiConversationState): boolean {
    const allowed = VALID_TRANSITIONS[fromState];
    return allowed ? allowed.includes(toState) : false;
  }

  /**
   * Determine the resulting state given current state and an AI Decision.
   * Enforces transition constraints and fallback rule when escalation is triggered.
   */
  computeNextState(currentState: AiConversationState, decision: AiDecision): AiConversationState {
    if (decision.action === "ESCALATE_HUMAN") {
      return "ESCALATED";
    }

    const suggested = decision.suggestedStateTransition;
    if (suggested && this.canTransition(currentState, suggested)) {
      return suggested;
    }

    return currentState;
  }
}
