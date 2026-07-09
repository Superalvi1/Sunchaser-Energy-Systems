/**
 * ToolExecutor — the permission gate and runtime around every tool call.
 *
 * Guarantees, in order:
 *   1. the tool exists,
 *   2. the actor is authorized (roles + permissions + ownership vs args),
 *   3. the handler (if bound) runs inside a timeout,
 *   4. every outcome — success, denial, failure, unbound — returns as a
 *      structured record; the executor never throws into the engine loop.
 */

import type { AIPermissionEvaluator } from "../core/AIPermissions.ts";
import type { AILogger } from "../core/AILogger.ts";
import type { AIProviderToolCall } from "../core/AIProvider.ts";
import type { AIToolCallRecord } from "../core/AIResponse.ts";
import type { Tool, ToolExecutionContext } from "./Tool.ts";

function serializeOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tool "${toolName}" timed out after ${ms}ms.`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class ToolExecutor {
  constructor(
    private readonly evaluator: AIPermissionEvaluator,
    private readonly logger: AILogger
  ) {}

  async execute(
    tool: Tool | null,
    call: AIProviderToolCall,
    context: ToolExecutionContext
  ): Promise<AIToolCallRecord> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    const finish = (status: AIToolCallRecord["status"], result: string): AIToolCallRecord => {
      const record: AIToolCallRecord = {
        id: call.id,
        name: call.name,
        input: call.input,
        status,
        result,
        startedAt,
        durationMs: Date.now() - t0,
      };
      this.logger.logTool({
        responseId: context.responseId,
        conversationId: context.conversationId,
        actorUserId: context.actor.userId,
        toolName: call.name,
        status,
        durationMs: record.durationMs,
        createdAt: startedAt,
      });
      return record;
    };

    if (!tool) {
      return finish("failed", `Unknown tool "${call.name}". No such capability is registered.`);
    }

    const decision = await this.evaluator.authorize(context.actor, tool.permissions, call.input);
    if (!decision.allowed) {
      return finish("denied", decision.reason ?? "Permission denied.");
    }

    if (!tool.handler) {
      return finish(
        "unbound",
        `Tool "${tool.name}" is declared but has no implementation bound in this deployment. ` +
          `Report the requested parameters to the user instead of assuming the action happened.`
      );
    }

    try {
      const result = await withTimeout(tool.handler(call.input, context), tool.timeoutMs, tool.name);
      return finish("executed", serializeOutput(result.output));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return finish("failed", message);
    }
  }
}
