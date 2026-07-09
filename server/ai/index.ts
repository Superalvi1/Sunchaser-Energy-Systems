/**
 * AI Engine composition root.
 *
 * `createAIEngine()` wires the default production topology:
 *   providers (from env) → router (+ platform agents) → registry (+ platform
 *   tool declarations) → permissions → executor → engine.
 *
 * Every piece is overridable — pass any dependency to replace the default
 * without forking the wiring.
 */

import { AIEngine, type AIEngineDependencies, type AIEngineOptions } from "./core/AIEngine.ts";
import { AIRouter, type AgentDefinition } from "./core/AIRouter.ts";
import { AIToolRegistry, type ToolSource } from "./core/AIToolRegistry.ts";
import {
  DefaultPermissionEvaluator,
  type AIPermissionEvaluator,
  type OwnershipPolicyResolver,
} from "./core/AIPermissions.ts";
import { EmptyCompanyContextProvider, type CompanyContextProvider } from "./core/AIContext.ts";
import { ConsoleAILogger, type AILogger } from "./core/AILogger.ts";
import type { ConversationMemoryStore } from "./core/AIMemory.ts";
import type { AIProvider } from "./core/AIProvider.ts";
import { ToolExecutor } from "./tools/ToolExecutor.ts";
import { PLATFORM_TOOLS } from "./tools/ToolSchemas.ts";
import type { Tool, ToolHandler } from "./tools/Tool.ts";
import { InMemoryConversationMemory } from "./memory/ConversationMemory.ts";
import { AnthropicProvider } from "./providers/AnthropicProvider.ts";
import { OpenAIProvider } from "./providers/OpenAIProvider.ts";
import { GeminiProvider } from "./providers/GeminiProvider.ts";
import { PLATFORM_AGENTS } from "./agents/index.ts";

export interface CreateAIEngineOptions {
  providers?: AIProvider[];
  agents?: AgentDefinition[];
  tools?: Tool[];
  toolSources?: ToolSource[];
  /** Bind implementations to declared tools at wiring time. */
  toolHandlers?: Record<string, ToolHandler>;
  permissions?: AIPermissionEvaluator;
  ownershipResolver?: OwnershipPolicyResolver;
  conversationMemory?: ConversationMemoryStore;
  companyContext?: CompanyContextProvider;
  logger?: AILogger;
  engineOptions?: AIEngineOptions;
}

export interface AIEngineBundle {
  engine: AIEngine;
  router: AIRouter;
  registry: AIToolRegistry;
  providers: AIProvider[];
}

export function createAIEngine(options: CreateAIEngineOptions = {}): AIEngineBundle {
  const logger = options.logger ?? new ConsoleAILogger();

  const providers = options.providers ?? [
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GeminiProvider(),
  ];

  const router = new AIRouter(providers);
  router.registerAgents(options.agents ?? PLATFORM_AGENTS);

  const registry = new AIToolRegistry();
  registry.registerMany(options.tools ?? PLATFORM_TOOLS);
  for (const source of options.toolSources ?? []) registry.registerSource(source);
  for (const [name, handler] of Object.entries(options.toolHandlers ?? {})) {
    registry.bind(name, handler);
  }

  const permissions =
    options.permissions ?? new DefaultPermissionEvaluator(options.ownershipResolver);

  const deps: AIEngineDependencies = {
    router,
    registry,
    permissions,
    toolExecutor: new ToolExecutor(permissions, logger),
    conversationMemory: options.conversationMemory ?? new InMemoryConversationMemory(),
    companyContext: options.companyContext ?? new EmptyCompanyContextProvider(),
    logger,
    options: options.engineOptions,
  };

  return { engine: new AIEngine(deps), router, registry, providers };
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export { AIEngine } from "./core/AIEngine.ts";
export type { AIEngineRequest, AIEngineDependencies, AIEngineOptions } from "./core/AIEngine.ts";
export { AIRouter } from "./core/AIRouter.ts";
export type { AgentDefinition, ResolvedRoute } from "./core/AIRouter.ts";
export { AIToolRegistry } from "./core/AIToolRegistry.ts";
export type { ToolSource } from "./core/AIToolRegistry.ts";
export { DefaultPermissionEvaluator } from "./core/AIPermissions.ts";
export type {
  AIActor,
  AIPermissionEvaluator,
  AIPermissionSpec,
  OwnershipPolicyResolver,
  OwnershipRequirement,
  PermissionDecision,
} from "./core/AIPermissions.ts";
export type {
  AIMessage,
  AIMessageContent,
  AIModelDescriptor,
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
  AIStreamChunk,
  AIStreamHandler,
  AITokenUsage,
  AIToolDeclaration,
} from "./core/AIProvider.ts";
export type { AIEngineResponse, AIToolCallRecord, AIAction } from "./core/AIResponse.ts";
export type {
  AICompanyContext,
  AIContextBlock,
  CompanyContextProvider,
} from "./core/AIContext.ts";
export type { ConversationMemoryStore, CompanyMemory, CompanyMemoryEntry } from "./core/AIMemory.ts";
export type { AILogger, AICallLogRecord, AIToolLogRecord } from "./core/AILogger.ts";
export * from "./core/AIErrors.ts";
export type { Tool, ToolHandler, ToolExecutionContext } from "./tools/Tool.ts";
export { bindToolHandler } from "./tools/Tool.ts";
export { ToolExecutor } from "./tools/ToolExecutor.ts";
export { PLATFORM_TOOLS } from "./tools/ToolSchemas.ts";
export { InMemoryConversationMemory } from "./memory/ConversationMemory.ts";
export { NullCompanyMemory } from "./memory/CompanyMemory.ts";
export { AnthropicProvider } from "./providers/AnthropicProvider.ts";
export { OpenAIProvider } from "./providers/OpenAIProvider.ts";
export { GeminiProvider } from "./providers/GeminiProvider.ts";
export { PLATFORM_AGENTS } from "./agents/index.ts";
