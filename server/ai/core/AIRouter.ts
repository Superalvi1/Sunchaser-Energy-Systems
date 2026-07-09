/**
 * AIRouter — resolves "which agent, which provider, which model" for a
 * request, with deterministic failover when a provider is unconfigured.
 *
 * Routing inputs, in precedence order:
 *   1. request.modelOverride (explicit caller choice)
 *   2. agent.model (the agent's preferred model)
 *   3. agent.fallbackModels (ordered alternates, possibly other providers)
 */

import { AIAgentNotFoundError, AIModelNotFoundError } from "./AIErrors.ts";
import type { AIPermissionSpec } from "./AIPermissions.ts";
import { findModel, type AIModelDescriptor, type AIProvider } from "./AIProvider.ts";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Base system prompt (persona + operating rules). */
  systemPrompt: string;
  /** Names of registry tools this agent may use. */
  allowedTools: string[];
  /** Who may talk to this agent at all. */
  access: AIPermissionSpec;
  /** Preferred model id (provider inferred from the model catalog). */
  model: string;
  /** Ordered alternates used when the preferred provider is unavailable. */
  fallbackModels: string[];
  /** Advisory sampling temperature for providers that accept one. */
  temperature?: number;
  /** Per-response output budget. */
  maxTokens: number;
}

export interface ResolvedRoute {
  agent: AgentDefinition;
  provider: AIProvider;
  descriptor: AIModelDescriptor;
}

export class AIRouter {
  private readonly agents = new Map<string, AgentDefinition>();

  constructor(private readonly providers: readonly AIProvider[]) {}

  registerAgent(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  registerAgents(agents: AgentDefinition[]): void {
    for (const agent of agents) this.registerAgent(agent);
  }

  getAgent(agentId: string): AgentDefinition | null {
    return this.agents.get(agentId) ?? null;
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /**
   * Resolve the route for a request. Tries the explicit override first, then
   * the agent's preferred model, then each fallback — skipping models whose
   * provider is not configured with credentials.
   */
  resolve(agentId: string, modelOverride?: string): ResolvedRoute {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AIAgentNotFoundError(agentId);

    const candidates = modelOverride
      ? [modelOverride]
      : [agent.model, ...agent.fallbackModels];

    for (const model of candidates) {
      const match = findModel(this.providers, model);
      if (match && match.provider.isConfigured()) {
        return { agent, provider: match.provider, descriptor: match.descriptor };
      }
    }

    throw new AIModelNotFoundError(candidates.join(" | "));
  }
}
