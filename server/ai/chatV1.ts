/**
 * AI Chat V1 — read-only HTTP surface over createAIEngine().
 * Tools are disabled and unbound; only minimal session context is injected.
 */

import type { RequestActor } from "../middleware/actor.ts";
import type { AgentDefinition } from "./core/AIRouter.ts";
import type { AIActor } from "./core/AIPermissions.ts";
import type {
  AICompanyContext,
  CompanyContextProvider,
  CompanyContextRequest,
} from "./core/AIContext.ts";
import type { AIEngine } from "./core/AIEngine.ts";
import { findModel, type AIProvider } from "./core/AIProvider.ts";
import { createAIEngine, type AIEngineBundle } from "./index.ts";
import { PLATFORM_AGENTS } from "./agents/index.ts";
import { AnthropicProvider } from "./providers/AnthropicProvider.ts";
import { OpenAIProvider } from "./providers/OpenAIProvider.ts";
import { GeminiProvider } from "./providers/GeminiProvider.ts";
import type { Database } from "../../dbManager.ts";
import { ChatBusinessContextProvider } from "./context/ChatBusinessContextProvider.ts";

export const AI_CHAT_V1_ROUTE = "/api/ai/chat";

export const AI_CHAT_V1_AGENT_IDS = [
  "sales",
  "finance",
  "operations",
  "support",
  "procurement",
  "ceo",
] as const;

export type AiChatV1AgentId = (typeof AI_CHAT_V1_AGENT_IDS)[number];

/** Roles permitted to call POST /api/ai/chat (route gate). */
export const AI_CHAT_V1_ALLOWED_ROLES = new Set([
  "Customer",
  "Sales Executive",
  "Sales Manager",
  "Sales Advisor",
  "Technician",
  "Survey Engineer",
  "Installation Team",
  "Service Technician",
  "Accounts Manager",
  "Admin",
  "Director",
  "Super Admin",
  "Technical CEO",
]);

export interface AiChatV1RequestBody {
  message?: unknown;
  conversationId?: unknown;
  agent?: unknown;
  modelPreference?: unknown;
  includeBusinessContext?: unknown;
}

export function isAiChatRoleAllowed(role: string): boolean {
  return AI_CHAT_V1_ALLOWED_ROLES.has(role);
}

export function isAiProviderConfigured(): boolean {
  return buildChatV1Providers().length > 0;
}

/** Provider priority: Gemini → OpenAI → Anthropic (only configured providers). */
export function buildChatV1Providers(): AIProvider[] {
  const providers: AIProvider[] = [];
  if (process.env.GEMINI_API_KEY?.trim()) {
    providers.push(new GeminiProvider());
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    providers.push(new OpenAIProvider());
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    providers.push(new AnthropicProvider());
  }
  return providers;
}

/**
 * V1 model selection — provider priority wins over agent defaults.
 * modelPreference is used only when explicitly provided and served by a configured provider.
 * Otherwise the first model of the first configured provider (Gemini → OpenAI → Anthropic) is used.
 */
export function resolveChatV1Model(
  providers: readonly AIProvider[],
  modelPreference?: string
): string | null {
  if (modelPreference) {
    const preferred = findModel(providers, modelPreference);
    if (preferred?.provider.isConfigured()) {
      return modelPreference;
    }
  }

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    const model = provider.models[0];
    if (model) return model.id;
  }

  return null;
}

export function buildChatV1Agents(): AgentDefinition[] {
  return PLATFORM_AGENTS.map((agent) => ({
    ...agent,
    allowedTools: [],
    access: {
      requiredRoles: [],
      requiredPermissions: [],
      requiredOwnership: { type: "none" as const },
    },
  }));
}

export class MinimalChatContextProvider implements CompanyContextProvider {
  async load(request: CompanyContextRequest): Promise<AICompanyContext> {
    const { actor, agentId } = request;
    const now = new Date().toISOString();
    const content = [
      `Actor ID: ${actor.userId}`,
      `Role: ${actor.role}`,
      actor.username ? `Username: ${actor.username}` : null,
      `Current date/time (UTC): ${now}`,
      `Selected agent: ${agentId}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      blocks: [
        {
          key: "session-context",
          title: "Session context",
          content,
        },
      ],
      facts: {
        actorRole: actor.role,
        actorUserId: actor.userId,
        agentId,
      },
    };
  }
}

export function toAIActor(actor: RequestActor): AIActor {
  return {
    userId: actor.id,
    username: actor.username,
    displayName: actor.name,
    role: actor.role,
    permissions: [],
    customerId: actor.customerId ?? null,
  };
}

export function parseAiChatV1Body(body: AiChatV1RequestBody | null | undefined): {
  ok: true;
  message: string;
  conversationId?: string;
  agentId: AiChatV1AgentId;
  modelPreference?: string;
  includeBusinessContext: boolean;
} | { ok: false; status: 400; error: string } {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return { ok: false, status: 400, error: "message is required." };
  }

  let agentId: AiChatV1AgentId = "support";
  if (body?.agent !== undefined && body.agent !== null && body.agent !== "") {
    if (typeof body.agent !== "string" || !isAiChatV1AgentId(body.agent)) {
      return {
        ok: false,
        status: 400,
        error: `agent must be one of: ${AI_CHAT_V1_AGENT_IDS.join(", ")}.`,
      };
    }
    agentId = body.agent;
  }

  const conversationId =
    typeof body?.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : undefined;

  const modelPreference =
    typeof body?.modelPreference === "string" && body.modelPreference.trim()
      ? body.modelPreference.trim()
      : undefined;

  const includeBusinessContext = body?.includeBusinessContext === true;

  return { ok: true, message, conversationId, agentId, modelPreference, includeBusinessContext };
}

function isAiChatV1AgentId(value: string): value is AiChatV1AgentId {
  return (AI_CHAT_V1_AGENT_IDS as readonly string[]).includes(value);
}

let chatV1EngineBundle: AIEngineBundle | null = null;
let chatV1EngineOverride: ChatV1EngineLike | null = null;

/** Minimal engine surface used by the chat route (and test doubles). */
export type ChatV1EngineLike = Pick<AIEngine, "execute" | "stream">;

export function getChatV1EngineBundle(): AIEngineBundle {
  if (!chatV1EngineBundle) {
    chatV1EngineBundle = createChatV1Engine();
  }
  if (chatV1EngineOverride) {
    return { ...chatV1EngineBundle, engine: chatV1EngineOverride as AIEngine };
  }
  return chatV1EngineBundle;
}

export function createChatV1Engine(options: {
  companyContext?: CompanyContextProvider;
} = {}): AIEngineBundle {
  return createAIEngine({
    providers: buildChatV1Providers(),
    agents: buildChatV1Agents(),
    tools: [],
    toolHandlers: {},
    companyContext: options.companyContext ?? new MinimalChatContextProvider(),
    engineOptions: { defaultMaxToolIterations: 1 },
  });
}

export function createChatV1EngineForRequest(options: {
  requestActor: RequestActor;
  db: Database;
  includeBusinessContext: boolean;
}): AIEngineBundle {
  const companyContext = options.includeBusinessContext
    ? new ChatBusinessContextProvider({
        requestActor: options.requestActor,
        db: options.db,
        includeBusinessContext: true,
      })
    : new MinimalChatContextProvider();
  return createChatV1Engine({ companyContext });
}

/** @internal Test hook — inject a mock engine or reset the singleton. */
export function setChatV1EngineForTests(engine: ChatV1EngineLike | null): void {
  chatV1EngineOverride = engine;
  if (engine === null) {
    chatV1EngineBundle = null;
  }
}

export function isChatV1ToolsDisabled(bundle: AIEngineBundle): boolean {
  const agents = bundle.router.listAgents();
  if (!agents.every((agent) => agent.allowedTools.length === 0)) return false;
  return bundle.registry.list().length === 0;
}
