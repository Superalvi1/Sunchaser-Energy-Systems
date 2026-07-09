/**
 * Structured logging for every AI call.
 *
 * The engine emits one AICallLogRecord per execute()/stream() invocation and
 * one AIToolLogRecord per tool execution. Swap the logger via DI to ship
 * records to Supabase, Datadog, OpenTelemetry, etc.
 */

import type { AIProviderId, AIStopReason, AITokenUsage } from "./AIProvider.ts";
import type { AIToolCallStatus } from "./AIResponse.ts";

export interface AICallLogRecord {
  responseId: string;
  conversationId: string;
  agentId: string;
  actorUserId: string;
  provider: AIProviderId;
  model: string;
  latencyMs: number;
  tokens: AITokenUsage;
  costUsd: number;
  iterations: number;
  retries: number;
  stopReason: AIStopReason;
  streamed: boolean;
  error?: { code: string; message: string };
  createdAt: string;
}

export interface AIToolLogRecord {
  responseId: string;
  conversationId: string;
  actorUserId: string;
  toolName: string;
  status: AIToolCallStatus;
  durationMs: number;
  createdAt: string;
}

export interface AILogger {
  logCall(record: AICallLogRecord): void;
  logTool(record: AIToolLogRecord): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

/** Default sink: structured single-line JSON to stdout/stderr. */
export class ConsoleAILogger implements AILogger {
  logCall(record: AICallLogRecord): void {
    console.log(JSON.stringify({ kind: "ai.call", ...record }));
  }

  logTool(record: AIToolLogRecord): void {
    console.log(JSON.stringify({ kind: "ai.tool", ...record }));
  }

  warn(message: string, details?: Record<string, unknown>): void {
    console.warn(JSON.stringify({ kind: "ai.warn", message, ...details }));
  }

  error(message: string, details?: Record<string, unknown>): void {
    console.error(JSON.stringify({ kind: "ai.error", message, ...details }));
  }
}
