/**
 * AIEngine — the orchestrator.
 *
 * One class, fully dependency-injected, zero business logic:
 *
 *   receive request
 *     → resolve route (agent + provider + model, with failover)
 *     → authorize agent access
 *     → load conversation memory + company context
 *     → assemble system prompt + permitted tool declarations
 *     → run the model/tool loop (with retry + cost/token accounting)
 *     → persist the turn, log the call
 *     → return a structured AIEngineResponse
 *
 * execute() and stream() share the loop; stream() additionally forwards
 * incremental chunks to the caller.
 */

import { randomUUID } from "node:crypto";

import { AIPermissionDeniedError, AIProviderError, AIRetryExhaustedError } from "./AIErrors.ts";
import type { AIActor, AIPermissionEvaluator } from "./AIPermissions.ts";
import {
  addUsage,
  computeCostUsd,
  emptyUsage,
  type AICitation,
  type AIMessage,
  type AIProviderRequest,
  type AIProviderResult,
  type AIStreamHandler,
  type AITokenUsage,
} from "./AIProvider.ts";
import { toActions, type AIEngineResponse, type AIToolCallRecord } from "./AIResponse.ts";
import type { AIRouter, ResolvedRoute } from "./AIRouter.ts";
import type { AIToolRegistry } from "./AIToolRegistry.ts";
import type { CompanyContextProvider } from "./AIContext.ts";
import type { ConversationMemoryStore } from "./AIMemory.ts";
import type { AILogger } from "./AILogger.ts";
import type { ToolExecutor } from "../tools/ToolExecutor.ts";
import { toDeclaration, type Tool } from "../tools/Tool.ts";
import { buildSystemPrompt } from "../prompts/system/base.ts";

export interface AIEngineRequest {
  agentId: string;
  actor: AIActor;
  /** The user's message for this turn. */
  input: string;
  /** Omit to start a new conversation. */
  conversationId?: string;
  /** Explicit model override (must exist in a configured provider). */
  model?: string;
  maxToolIterations?: number;
  abortSignal?: AbortSignal;
}

export interface AIEngineOptions {
  /** Max model turns in one tool loop (safety valve). Default 8. */
  defaultMaxToolIterations?: number;
  /** Engine-level retries on retryable provider errors. Default 2. */
  maxRetries?: number;
  /** Base backoff in ms; grows exponentially with jitter. Default 500. */
  retryBaseDelayMs?: number;
}

export interface AIEngineDependencies {
  router: AIRouter;
  registry: AIToolRegistry;
  permissions: AIPermissionEvaluator;
  toolExecutor: ToolExecutor;
  conversationMemory: ConversationMemoryStore;
  companyContext: CompanyContextProvider;
  logger: AILogger;
  options?: AIEngineOptions;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AIEngine {
  private readonly deps: AIEngineDependencies;
  private readonly maxIterations: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(deps: AIEngineDependencies) {
    this.deps = deps;
    this.maxIterations = deps.options?.defaultMaxToolIterations ?? 8;
    this.maxRetries = deps.options?.maxRetries ?? 2;
    this.retryBaseDelayMs = deps.options?.retryBaseDelayMs ?? 500;
  }

  /** Non-streaming execution. */
  execute(request: AIEngineRequest): Promise<AIEngineResponse> {
    return this.run(request, undefined);
  }

  /** Streaming execution: chunks via onChunk, full envelope on resolve. */
  stream(request: AIEngineRequest, onChunk: AIStreamHandler): Promise<AIEngineResponse> {
    return this.run(request, onChunk);
  }

  private async run(
    request: AIEngineRequest,
    onChunk: AIStreamHandler | undefined
  ): Promise<AIEngineResponse> {
    const t0 = Date.now();
    const responseId = `air-${randomUUID()}`;
    const route = this.deps.router.resolve(request.agentId, request.model);

    const access = this.deps.permissions.canAccess(request.actor, route.agent.access);
    if (!access.allowed) {
      throw new AIPermissionDeniedError(
        `Actor may not use agent "${route.agent.id}": ${access.reason}`
      );
    }

    const conversationId = request.conversationId ?? `conv-${randomUUID()}`;
    const conversation = await this.deps.conversationMemory.getOrCreate({
      conversationId,
      agentId: route.agent.id,
      actorUserId: request.actor.userId,
    });

    const context = await this.deps.companyContext.load({
      actor: request.actor,
      agentId: route.agent.id,
      conversationId,
    });

    const tools = await this.deps.registry.resolveFor(
      request.actor,
      route.agent.allowedTools,
      this.deps.permissions
    );

    const system = buildSystemPrompt({
      agentPrompt: route.agent.systemPrompt,
      actor: request.actor,
      contextBlocks: context.blocks,
      summaries: conversation.summaries.map((s) => s.content),
      toolNames: tools.map((t) => t.name),
    });

    const turnMessages: AIMessage[] = [
      { role: "user", content: [{ type: "text", text: request.input }] },
    ];
    const toolRecords: AIToolCallRecord[] = [];
    const citations: AICitation[] = [];
    const reasoningParts: string[] = [];

    let usage: AITokenUsage = emptyUsage();
    let retries = 0;
    let iterations = 0;
    let lastResult: AIProviderResult | null = null;
    let finalText = "";

    const maxIterations = request.maxToolIterations ?? this.maxIterations;
    const toolByName = new Map<string, Tool>(tools.map((t) => [t.name, t]));

    try {
      while (iterations < maxIterations) {
        iterations += 1;

        const providerRequest: AIProviderRequest = {
          model: route.descriptor.id,
          system,
          messages: [...conversation.messages, ...turnMessages],
          tools: tools.map(toDeclaration),
          maxTokens: route.agent.maxTokens,
          temperature: route.agent.temperature,
          abortSignal: request.abortSignal,
        };

        const attempt = await this.callWithRetry(route, providerRequest, onChunk);
        retries += attempt.retries;
        lastResult = attempt.result;

        usage = addUsage(usage, attempt.result.usage);
        citations.push(...attempt.result.citations);
        if (attempt.result.reasoning) reasoningParts.push(attempt.result.reasoning);
        if (attempt.result.text) finalText = attempt.result.text;

        turnMessages.push(this.toAssistantMessage(attempt.result));

        if (attempt.result.stopReason !== "tool_use" || attempt.result.toolCalls.length === 0) {
          break;
        }

        const outcomes = await Promise.all(
          attempt.result.toolCalls.map((call) =>
            this.deps.toolExecutor.execute(toolByName.get(call.name) ?? null, call, {
              actor: request.actor,
              conversationId,
              agentId: route.agent.id,
              responseId,
              abortSignal: request.abortSignal,
            })
          )
        );
        toolRecords.push(...outcomes);

        turnMessages.push({
          role: "user",
          content: outcomes.map((outcome) => ({
            type: "tool_result" as const,
            toolUseId: outcome.id,
            toolName: outcome.name,
            content: outcome.result,
            isError: outcome.status !== "executed",
          })),
        });
      }

      const latencyMs = Date.now() - t0;
      const costUsd = computeCostUsd(route.descriptor, usage);
      const actions = toActions(toolRecords);

      await this.deps.conversationMemory.appendTurn(conversationId, {
        messages: turnMessages,
        toolCalls: toolRecords,
        actions,
      });

      const response: AIEngineResponse = {
        id: responseId,
        conversationId,
        agentId: route.agent.id,
        response: finalText,
        reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
        toolCalls: toolRecords,
        actions,
        citations,
        usage: {
          provider: route.provider.id,
          model: route.descriptor.id,
          latencyMs,
          tokens: usage,
          costUsd,
          iterations,
          retries,
        },
        model: route.descriptor.id,
        latencyMs,
        tokens: usage,
        costUsd,
        stopReason: lastResult?.stopReason ?? "other",
        createdAt: new Date().toISOString(),
      };

      this.logCall(response, request.actor, onChunk !== undefined);
      return response;
    } catch (err) {
      this.deps.logger.logCall({
        responseId,
        conversationId,
        agentId: route.agent.id,
        actorUserId: request.actor.userId,
        provider: route.provider.id,
        model: route.descriptor.id,
        latencyMs: Date.now() - t0,
        tokens: usage,
        costUsd: computeCostUsd(route.descriptor, usage),
        iterations,
        retries,
        stopReason: lastResult?.stopReason ?? "other",
        streamed: onChunk !== undefined,
        error: {
          code: err instanceof AIProviderError ? err.code : "provider_error",
          message: err instanceof Error ? err.message : String(err),
        },
        createdAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  /** Retry wrapper: exponential backoff + jitter on retryable provider errors. */
  private async callWithRetry(
    route: ResolvedRoute,
    providerRequest: AIProviderRequest,
    onChunk: AIStreamHandler | undefined
  ): Promise<{ result: AIProviderResult; retries: number }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = onChunk
          ? await route.provider.stream(providerRequest, onChunk)
          : await route.provider.complete(providerRequest);
        return { result, retries: attempt };
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AIProviderError && err.retryable;
        if (!retryable || attempt === this.maxRetries) {
          if (err instanceof AIProviderError) throw err;
          throw new AIRetryExhaustedError(attempt + 1, err);
        }
        const backoff = this.retryBaseDelayMs * 2 ** attempt + Math.random() * 250;
        this.deps.logger.warn("Retrying provider call after transient error.", {
          provider: route.provider.id,
          model: route.descriptor.id,
          attempt: attempt + 1,
          backoffMs: Math.round(backoff),
        });
        await sleep(backoff);
      }
    }
    throw new AIRetryExhaustedError(this.maxRetries + 1, lastError);
  }

  private toAssistantMessage(result: AIProviderResult): AIMessage {
    const content: AIMessage["content"] = [];
    if (result.text) content.push({ type: "text", text: result.text });
    for (const call of result.toolCalls) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
    return { role: "assistant", content };
  }

  private logCall(response: AIEngineResponse, actor: AIActor, streamed: boolean): void {
    this.deps.logger.logCall({
      responseId: response.id,
      conversationId: response.conversationId,
      agentId: response.agentId,
      actorUserId: actor.userId,
      provider: response.usage.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      tokens: response.tokens,
      costUsd: response.costUsd,
      iterations: response.usage.iterations,
      retries: response.usage.retries,
      stopReason: response.stopReason,
      streamed,
      createdAt: response.createdAt,
    });
  }
}
