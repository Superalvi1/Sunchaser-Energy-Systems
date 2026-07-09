/**
 * Provider abstraction — the seam that makes Anthropic / OpenAI / Gemini /
 * future local LLMs interchangeable.
 *
 * A provider translates the engine's neutral request shape into its native
 * API, and normalizes the native response back. Nothing above this layer may
 * import a vendor SDK.
 */

/** JSON Schema for tool inputs (subset every provider understands). */
export interface AIJsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export type AIMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      toolUseId: string;
      /** Tool name is required by some providers (Gemini functionResponse). */
      toolName: string;
      content: string;
      isError?: boolean;
    };

export interface AIMessage {
  role: "user" | "assistant";
  content: AIMessageContent[];
}

/** Provider-neutral tool declaration (schema only, no handler). */
export interface AIToolDeclaration {
  name: string;
  description: string;
  inputSchema: AIJsonSchema;
}

export interface AIProviderRequest {
  model: string;
  system?: string;
  messages: AIMessage[];
  tools?: AIToolDeclaration[];
  maxTokens: number;
  /**
   * Advisory sampling temperature. Providers whose current models reject
   * sampling parameters (Anthropic Opus 4.7+ family) ignore it.
   */
  temperature?: number;
  abortSignal?: AbortSignal;
}

export type AIStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "other";

export interface AITokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache reads/writes when the provider reports them (Anthropic). */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface AIProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AICitation {
  source: string;
  reference?: string;
  snippet?: string;
}

export interface AIProviderResult {
  /** Concatenated assistant text of this turn. */
  text: string;
  /** Summarized reasoning when the provider exposes it (Anthropic thinking). */
  reasoning: string | null;
  toolCalls: AIProviderToolCall[];
  citations: AICitation[];
  stopReason: AIStopReason;
  usage: AITokenUsage;
  /** The model that actually served the request (may differ under fallback). */
  model: string;
}

/** Incremental streaming callback payloads. */
export type AIStreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; call: AIProviderToolCall };

export type AIStreamHandler = (chunk: AIStreamChunk) => void;

export type AIModelTier = "frontier" | "balanced" | "fast";

export interface AIModelDescriptor {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** USD per 1M input tokens — drives cost tracking. Override per deployment. */
  inputUsdPerMTok: number;
  /** USD per 1M output tokens. */
  outputUsdPerMTok: number;
  /** USD per 1M cached input tokens read (defaults handled per provider). */
  cacheReadUsdPerMTok?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsAdaptiveThinking?: boolean;
  tier: AIModelTier;
}

export type AIProviderId = "anthropic" | "openai" | "gemini" | (string & {});

export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;
  readonly models: readonly AIModelDescriptor[];

  /** True when the provider has credentials and can serve traffic. */
  isConfigured(): boolean;

  /** One non-streaming model turn. Throws AIProviderError on failure. */
  complete(request: AIProviderRequest): Promise<AIProviderResult>;

  /**
   * One streaming model turn. Emits chunks as they arrive and resolves with
   * the same normalized result complete() would return.
   */
  stream(request: AIProviderRequest, onChunk: AIStreamHandler): Promise<AIProviderResult>;
}

export function emptyUsage(): AITokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
}

export function addUsage(a: AITokenUsage, b: AITokenUsage): AITokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Compute the USD cost of a turn from the model's published rates. */
export function computeCostUsd(descriptor: AIModelDescriptor, usage: AITokenUsage): number {
  const cacheReadRate = descriptor.cacheReadUsdPerMTok ?? descriptor.inputUsdPerMTok * 0.1;
  const cost =
    (usage.inputTokens * descriptor.inputUsdPerMTok +
      usage.outputTokens * descriptor.outputUsdPerMTok +
      usage.cacheReadTokens * cacheReadRate) /
    1_000_000;
  return Number(cost.toFixed(6));
}

/** Find a model descriptor across a set of providers. */
export function findModel(
  providers: readonly AIProvider[],
  model: string
): { provider: AIProvider; descriptor: AIModelDescriptor } | null {
  for (const provider of providers) {
    const descriptor = provider.models.find((m) => m.id === model);
    if (descriptor) return { provider, descriptor };
  }
  return null;
}
