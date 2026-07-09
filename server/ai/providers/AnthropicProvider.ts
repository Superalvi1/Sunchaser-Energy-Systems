/**
 * Anthropic provider — Claude via the official @anthropic-ai/sdk.
 *
 * Notes that encode current API behavior (2026):
 *  - Opus 4.8 / Sonnet 5 / Fable 5 reject sampling params; `temperature` from
 *    the neutral request is intentionally not forwarded.
 *  - Adaptive thinking with `display: "summarized"` populates the engine's
 *    `reasoning` field on models that support it.
 *  - Pricing below mirrors published rates and is overridable per deployment
 *    via the constructor.
 */

import Anthropic from "@anthropic-ai/sdk";

import { AIProviderError, isRetryableStatus } from "../core/AIErrors.ts";
import type {
  AIMessage,
  AIModelDescriptor,
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
  AIProviderToolCall,
  AIStopReason,
  AIStreamHandler,
  AITokenUsage,
} from "../core/AIProvider.ts";

const DEFAULT_ANTHROPIC_MODELS: AIModelDescriptor[] = [
  {
    id: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    cacheReadUsdPerMTok: 0.5,
    supportsTools: true,
    supportsStreaming: true,
    supportsAdaptiveThinking: true,
    tier: "frontier",
  },
  {
    id: "claude-fable-5",
    displayName: "Claude Fable 5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputUsdPerMTok: 10,
    outputUsdPerMTok: 50,
    cacheReadUsdPerMTok: 1,
    supportsTools: true,
    supportsStreaming: true,
    supportsAdaptiveThinking: true,
    tier: "frontier",
  },
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheReadUsdPerMTok: 0.3,
    supportsTools: true,
    supportsStreaming: true,
    supportsAdaptiveThinking: true,
    tier: "balanced",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    cacheReadUsdPerMTok: 0.1,
    supportsTools: true,
    supportsStreaming: true,
    supportsAdaptiveThinking: false,
    tier: "fast",
  },
];

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Override the built-in catalog (ids, pricing, limits). */
  models?: AIModelDescriptor[];
}

type AnthropicMessageParamsBase = Omit<Anthropic.MessageCreateParamsNonStreaming, "stream">;

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly displayName = "Anthropic Claude";
  readonly models: readonly AIModelDescriptor[];

  private readonly apiKey: string;
  private client: Anthropic | null = null;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.models = options.models ?? DEFAULT_ANTHROPIC_MODELS;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(request: AIProviderRequest): Promise<AIProviderResult> {
    try {
      const response = await this.getClient().messages.create(this.toNonStreamingParams(request), {
        signal: request.abortSignal,
      });
      return this.fromResponse(response);
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async stream(request: AIProviderRequest, onChunk: AIStreamHandler): Promise<AIProviderResult> {
    try {
      const stream = this.getClient().messages.stream(this.toStreamParams(request), {
        signal: request.abortSignal,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            onChunk({ type: "text_delta", text: event.delta.text });
          } else if (event.delta.type === "thinking_delta") {
            onChunk({ type: "reasoning_delta", text: event.delta.thinking });
          }
        }
      }
      const final = await stream.finalMessage();
      const result = this.fromResponse(final);
      for (const call of result.toolCalls) onChunk({ type: "tool_call", call });
      return result;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private buildMessageParams(request: AIProviderRequest): AnthropicMessageParamsBase {
    const descriptor = this.models.find((m) => m.id === request.model);
    const params: AnthropicMessageParamsBase = {
      model: request.model,
      max_tokens: Math.min(request.maxTokens, descriptor?.maxOutputTokens ?? request.maxTokens),
      messages: request.messages.map((m) => this.toAnthropicMessage(m)),
    };
    if (request.system) params.system = request.system;
    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));
    }
    if (descriptor?.supportsAdaptiveThinking) {
      params.thinking = { type: "adaptive", display: "summarized" };
    }
    return params;
  }

  private toNonStreamingParams(request: AIProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
    return { ...this.buildMessageParams(request), stream: false };
  }

  private toStreamParams(request: AIProviderRequest): Anthropic.MessageStreamParams {
    return this.buildMessageParams(request);
  }

  private toAnthropicMessage(message: AIMessage): Anthropic.MessageParam {
    return {
      role: message.role,
      content: message.content.map((part): Anthropic.ContentBlockParam => {
        switch (part.type) {
          case "text":
            return { type: "text", text: part.text };
          case "tool_use":
            return { type: "tool_use", id: part.id, name: part.name, input: part.input };
          case "tool_result":
            return {
              type: "tool_result",
              tool_use_id: part.toolUseId,
              content: part.content,
              is_error: part.isError ?? false,
            };
        }
      }),
    };
  }

  private fromResponse(response: Anthropic.Message): AIProviderResult {
    let text = "";
    let reasoning = "";
    const toolCalls: AIProviderToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "thinking") {
        reasoning += block.thinking;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    const usage: AITokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      totalTokens:
        response.usage.input_tokens +
        response.usage.output_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
    };

    return {
      text,
      reasoning: reasoning.trim().length > 0 ? reasoning.trim() : null,
      toolCalls,
      citations: [],
      stopReason: this.mapStopReason(response.stop_reason),
      usage,
      model: response.model,
    };
  }

  private mapStopReason(reason: string | null): AIStopReason {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "end_turn";
      case "tool_use":
        return "tool_use";
      case "max_tokens":
      case "model_context_window_exceeded":
        return "max_tokens";
      case "refusal":
        return "refusal";
      default:
        return "other";
    }
  }

  private normalizeError(err: unknown): AIProviderError {
    if (err instanceof AIProviderError) return err;
    const status =
      err instanceof Anthropic.APIError && typeof err.status === "number" ? err.status : undefined;
    return new AIProviderError({
      providerId: this.id,
      message: err instanceof Error ? err.message : String(err),
      status,
      retryable: isRetryableStatus(status),
    });
  }
}
