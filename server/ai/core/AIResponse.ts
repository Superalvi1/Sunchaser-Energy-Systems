/**
 * The engine's public response envelope.
 *
 * Every AIEngine.execute()/stream() call resolves to an AIEngineResponse —
 * regardless of provider, agent, or whether tools ran. Consumers (HTTP
 * routes, background jobs, future MCP surface) depend only on this shape.
 */

import type { AICitation, AIProviderId, AIStopReason, AITokenUsage } from "./AIProvider.ts";

export type AIToolCallStatus =
  | "executed" // handler ran successfully
  | "failed" // handler threw
  | "denied" // permission evaluator refused
  | "unbound"; // declared tool with no handler bound yet (architecture mode)

export interface AIToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: AIToolCallStatus;
  /** Serialized tool output (or error/denial explanation). */
  result: string;
  startedAt: string;
  durationMs: number;
}

/**
 * A side effect or follow-up the host application should surface or act on.
 * The engine derives these mechanically from tool activity — it never invents
 * domain actions.
 */
export interface AIAction {
  type: "tool_executed" | "tool_denied" | "tool_failed" | "tool_proposed";
  toolName: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface AIUsage {
  provider: AIProviderId;
  model: string;
  latencyMs: number;
  tokens: AITokenUsage;
  costUsd: number;
  /** Number of model turns in the tool loop. */
  iterations: number;
  retries: number;
}

export interface AIEngineResponse {
  id: string;
  conversationId: string;
  agentId: string;

  /** Final assistant text. */
  response: string;
  /** Summarized model reasoning when available, else null. */
  reasoning: string | null;
  toolCalls: AIToolCallRecord[];
  actions: AIAction[];
  citations: AICitation[];

  usage: AIUsage;
  /** Convenience mirrors of usage fields (kept flat for dashboards/logs). */
  model: string;
  latencyMs: number;
  tokens: AITokenUsage;
  costUsd: number;

  stopReason: AIStopReason;
  createdAt: string;
}

export function toActions(toolCalls: AIToolCallRecord[]): AIAction[] {
  return toolCalls.map((call) => ({
    type:
      call.status === "executed"
        ? "tool_executed"
        : call.status === "denied"
          ? "tool_denied"
          : call.status === "failed"
            ? "tool_failed"
            : "tool_proposed",
    toolName: call.name,
    description:
      call.status === "executed"
        ? `Executed ${call.name}.`
        : call.status === "denied"
          ? `Refused ${call.name}: ${call.result}`
          : call.status === "failed"
            ? `Tool ${call.name} failed: ${call.result}`
            : `Proposed ${call.name} (no implementation bound).`,
    payload: call.input,
  }));
}
