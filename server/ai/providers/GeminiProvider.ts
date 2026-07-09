/**
 * Gemini provider — Google models via @google/genai (already a project
 * dependency; the same client the legacy /api/gemini/* routes use).
 *
 * Pricing defaults are estimates for cost tracking; override per deployment.
 */

import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { randomUUID } from "node:crypto";

import { AIProviderError, isRetryableStatus } from "../core/AIErrors.ts";
import { aiJsonSchemaToGeminiParameters } from "./schemaConvert.ts";
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

const DEFAULT_GEMINI_MODELS: AIModelDescriptor[] = [
  {
    id: "gemini-3.5-pro",
    displayName: "Gemini 3.5 Pro",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 10,
    supportsTools: true,
    supportsStreaming: true,
    tier: "frontier",
  },
  {
    id: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 2.5,
    supportsTools: true,
    supportsStreaming: true,
    tier: "fast",
  },
];

export interface GeminiProviderOptions {
  apiKey?: string;
  models?: AIModelDescriptor[];
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly displayName = "Google Gemini";
  readonly models: readonly AIModelDescriptor[];

  private readonly apiKey: string;
  private client: GoogleGenAI | null = null;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.models = options.models ?? DEFAULT_GEMINI_MODELS;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(request: AIProviderRequest): Promise<AIProviderResult> {
    try {
      const response = await this.getClient().models.generateContent({
        model: request.model,
        contents: this.toContents(request.messages),
        config: this.toConfig(request),
      });

      const toolCalls = this.extractToolCalls(response.functionCalls);
      return {
        text: response.text ?? "",
        reasoning: null,
        toolCalls,
        citations: [],
        stopReason: toolCalls.length > 0 ? "tool_use" : this.mapFinishReason(response),
        usage: this.extractUsage(response.usageMetadata),
        model: request.model,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async stream(request: AIProviderRequest, onChunk: AIStreamHandler): Promise<AIProviderResult> {
    try {
      const stream = await this.getClient().models.generateContentStream({
        model: request.model,
        contents: this.toContents(request.messages),
        config: this.toConfig(request),
      });

      let text = "";
      let toolCalls: AIProviderToolCall[] = [];
      let usage: AITokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      };
      let lastChunk: unknown = null;

      for await (const chunk of stream) {
        lastChunk = chunk;
        if (chunk.text) {
          text += chunk.text;
          onChunk({ type: "text_delta", text: chunk.text });
        }
        const calls = this.extractToolCalls(chunk.functionCalls);
        if (calls.length > 0) toolCalls = toolCalls.concat(calls);
        if (chunk.usageMetadata) usage = this.extractUsage(chunk.usageMetadata);
      }
      for (const call of toolCalls) onChunk({ type: "tool_call", call });

      return {
        text,
        reasoning: null,
        toolCalls,
        citations: [],
        stopReason: toolCalls.length > 0 ? "tool_use" : this.mapFinishReason(lastChunk),
        usage,
        model: request.model,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private toConfig(request: AIProviderRequest): Record<string, unknown> {
    const config: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens,
    };
    if (request.system) config.systemInstruction = request.system;
    if (request.temperature !== undefined) config.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      const declarations: FunctionDeclaration[] = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: aiJsonSchemaToGeminiParameters(tool.inputSchema),
      }));
      config.tools = [{ functionDeclarations: declarations }];
    }
    return config;
  }

  private toContents(messages: AIMessage[]): Content[] {
    return messages.map((message): Content => {
      const parts: Part[] = message.content.map((part): Part => {
        switch (part.type) {
          case "text":
            return { text: part.text };
          case "tool_use":
            return { functionCall: { name: part.name, args: part.input } };
          case "tool_result":
            return {
              functionResponse: {
                name: part.toolName,
                response: { result: part.content, isError: part.isError ?? false },
              },
            };
        }
      });
      return { role: message.role === "assistant" ? "model" : "user", parts };
    });
  }

  private extractToolCalls(
    calls: Array<{ name?: string; args?: Record<string, unknown>; id?: string }> | undefined
  ): AIProviderToolCall[] {
    if (!calls || calls.length === 0) return [];
    return calls
      .filter((c) => typeof c.name === "string" && c.name.length > 0)
      .map((c) => ({
        id: c.id && c.id.length > 0 ? c.id : `gemini-call-${randomUUID()}`,
        name: c.name as string,
        input: c.args ?? {},
      }));
  }

  private extractUsage(
    metadata:
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number }
      | undefined
  ): AITokenUsage {
    const input = metadata?.promptTokenCount ?? 0;
    const output = metadata?.candidatesTokenCount ?? 0;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: metadata?.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
      totalTokens: metadata?.totalTokenCount ?? input + output,
    };
  }

  private mapFinishReason(response: unknown): AIStopReason {
    const finish =
      (response as { candidates?: Array<{ finishReason?: string }> } | null)?.candidates?.[0]
        ?.finishReason ?? null;
    switch (finish) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      case "SAFETY":
      case "PROHIBITED_CONTENT":
        return "refusal";
      default:
        return finish === null ? "end_turn" : "other";
    }
  }

  private normalizeError(err: unknown): AIProviderError {
    if (err instanceof AIProviderError) return err;
    const status = (err as { status?: number } | null)?.status;
    return new AIProviderError({
      providerId: this.id,
      message: err instanceof Error ? err.message : String(err),
      status: typeof status === "number" ? status : undefined,
      retryable: isRetryableStatus(typeof status === "number" ? status : undefined),
    });
  }
}
