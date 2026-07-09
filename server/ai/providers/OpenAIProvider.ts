/**
 * OpenAI provider — GPT models via the official `openai` package
 * (Chat Completions API with function tools).
 *
 * Pricing defaults are estimates for cost-tracking convenience; verify and
 * override per deployment via the constructor.
 */

import OpenAI from "openai";

import { AIProviderError, isRetryableStatus } from "../core/AIErrors.ts";
import { aiJsonSchemaToOpenAiParameters } from "./schemaConvert.ts";
import type {
  AIMessage,
  AIModelDescriptor,
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
  AIProviderToolCall,
  AIStopReason,
  AIStreamHandler,
} from "../core/AIProvider.ts";

const DEFAULT_OPENAI_MODELS: AIModelDescriptor[] = [
  {
    id: "gpt-5",
    displayName: "GPT-5",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 10,
    supportsTools: true,
    supportsStreaming: true,
    tier: "frontier",
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5 mini",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 2,
    supportsTools: true,
    supportsStreaming: true,
    tier: "fast",
  },
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 10,
    supportsTools: true,
    supportsStreaming: true,
    tier: "balanced",
  },
];

export interface OpenAIProviderOptions {
  apiKey?: string;
  models?: AIModelDescriptor[];
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly displayName = "OpenAI";
  readonly models: readonly AIModelDescriptor[];

  private readonly apiKey: string;
  private client: OpenAI | null = null;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.models = options.models ?? DEFAULT_OPENAI_MODELS;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(request: AIProviderRequest): Promise<AIProviderResult> {
    try {
      const response = await this.getClient().chat.completions.create(
        { ...this.toParams(request), stream: false },
        { signal: request.abortSignal }
      );
      const choice = response.choices[0];
      const message = choice?.message;

      const toolCalls: AIProviderToolCall[] = (message?.tool_calls ?? [])
        .filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: "function" } =>
          c.type === "function"
        )
        .map((c) => ({
          id: c.id,
          name: c.function.name,
          input: this.parseArguments(c.function.arguments),
        }));

      return {
        text: message?.content ?? "",
        reasoning: null,
        toolCalls,
        citations: [],
        stopReason: this.mapFinishReason(choice?.finish_reason ?? null, toolCalls.length > 0),
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        model: response.model,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async stream(request: AIProviderRequest, onChunk: AIStreamHandler): Promise<AIProviderResult> {
    try {
      const stream = await this.getClient().chat.completions.create(
        {
          ...this.toParams(request),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: request.abortSignal }
      );

      let text = "";
      let finishReason: string | null = null;
      let model = request.model;
      let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
      const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        model = chunk.model || model;
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          text += choice.delta.content;
          onChunk({ type: "text_delta", text: choice.delta.content });
        }
        for (const delta of choice?.delta?.tool_calls ?? []) {
          const slot = pendingCalls.get(delta.index) ?? { id: "", name: "", args: "" };
          if (delta.id) slot.id = delta.id;
          if (delta.function?.name) slot.name += delta.function.name;
          if (delta.function?.arguments) slot.args += delta.function.arguments;
          pendingCalls.set(delta.index, slot);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }
      }

      const toolCalls: AIProviderToolCall[] = [...pendingCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, slot]) => ({
          id: slot.id || `call_${index}`,
          name: slot.name,
          input: this.parseArguments(slot.args),
        }));
      for (const call of toolCalls) onChunk({ type: "tool_call", call });

      return {
        text,
        reasoning: null,
        toolCalls,
        citations: [],
        stopReason: this.mapFinishReason(finishReason, toolCalls.length > 0),
        usage,
        model,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private toParams(
    request: AIProviderRequest
  ): Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, "stream"> {
    const messages: ChatMessage[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });

    for (const message of request.messages) {
      if (message.role === "assistant") {
        const textParts = message.content
          .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
          .map((c) => c.text)
          .join("");
        const toolUses = message.content.filter(
          (c): c is Extract<typeof c, { type: "tool_use" }> => c.type === "tool_use"
        );
        messages.push({
          role: "assistant",
          content: textParts.length > 0 ? textParts : null,
          ...(toolUses.length > 0
            ? {
                tool_calls: toolUses.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
      } else {
        for (const part of message.content) {
          if (part.type === "text") {
            messages.push({ role: "user", content: part.text });
          } else if (part.type === "tool_result") {
            messages.push({ role: "tool", tool_call_id: part.toolUseId, content: part.content });
          }
        }
      }
    }

    return {
      model: request.model,
      messages,
      max_completion_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: aiJsonSchemaToOpenAiParameters(tool.inputSchema),
              },
            })),
          }
        : {}),
    };
  }

  private parseArguments(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return { _unparsed: raw };
    }
  }

  private mapFinishReason(reason: string | null, hasToolCalls: boolean): AIStopReason {
    if (hasToolCalls || reason === "tool_calls") return "tool_use";
    switch (reason) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "content_filter":
        return "refusal";
      default:
        return "other";
    }
  }

  private normalizeError(err: unknown): AIProviderError {
    if (err instanceof AIProviderError) return err;
    const status =
      err instanceof OpenAI.APIError && typeof err.status === "number" ? err.status : undefined;
    return new AIProviderError({
      providerId: this.id,
      message: err instanceof Error ? err.message : String(err),
      status,
      retryable: isRetryableStatus(status),
    });
  }
}
