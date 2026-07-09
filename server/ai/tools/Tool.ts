/**
 * Tool contract.
 *
 * A Tool is a DECLARATION (name + schema + permission spec) plus an OPTIONAL
 * handler binding. The AI Engine ships declarations only — business modules
 * bind handlers later via `bindToolHandler`, keeping the engine free of any
 * CRM logic. An unbound tool is still visible to the model; executing it
 * yields a structured "unbound" outcome instead of a crash.
 */

import type { AIJsonSchema, AIToolDeclaration } from "../core/AIProvider.ts";
import type { AIActor, AIPermissionSpec } from "../core/AIPermissions.ts";

export interface ToolExecutionContext {
  actor: AIActor;
  conversationId: string;
  agentId: string;
  /** Correlates all tool logs of one engine response. */
  responseId: string;
  abortSignal?: AbortSignal;
}

export interface ToolHandlerResult {
  /** Serializable payload returned to the model as the tool result. */
  output: unknown;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolHandlerResult>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: AIJsonSchema;
  permissions: AIPermissionSpec;
  /** Hard wall-clock limit for the handler. */
  timeoutMs: number;
  /**
   * True when the tool mutates business state. Hosts can use this to route
   * such calls through confirmation flows before binding real handlers.
   */
  mutating: boolean;
  /** Optional implementation. Absent in the pure-architecture deliverable. */
  handler?: ToolHandler;
}

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export function toDeclaration(tool: Tool): AIToolDeclaration {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

/** Attach an implementation to a declared tool (immutably). */
export function bindToolHandler(tool: Tool, handler: ToolHandler): Tool {
  return { ...tool, handler };
}
