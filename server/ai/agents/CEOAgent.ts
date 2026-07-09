import type { AgentDefinition } from "../core/AIRouter.ts";
import { CEO_AGENT_PROMPT } from "../prompts/agents/ceo.ts";
import { PLATFORM_TOOLS } from "../tools/ToolSchemas.ts";

export const CEOAgent: AgentDefinition = {
  id: "ceo",
  name: "Executive Agent",
  description: "Cross-functional executive briefings with access to every capability.",
  systemPrompt: CEO_AGENT_PROMPT,
  allowedTools: PLATFORM_TOOLS.map((tool) => tool.name),
  access: {
    requiredRoles: ["Super Admin", "Technical CEO"],
    requiredPermissions: [],
    requiredOwnership: { type: "none" },
  },
  model: "claude-opus-4-8",
  fallbackModels: ["claude-fable-5", "claude-sonnet-5", "gpt-5"],
  maxTokens: 8192,
};
