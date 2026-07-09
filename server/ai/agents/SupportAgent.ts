import type { AgentDefinition } from "../core/AIRouter.ts";
import { SUPPORT_AGENT_PROMPT } from "../prompts/agents/support.ts";

export const SupportAgent: AgentDefinition = {
  id: "support",
  name: "Support Agent",
  description: "Ticket triage, customer follow-ups, and service coordination.",
  systemPrompt: SUPPORT_AGENT_PROMPT,
  allowedTools: [
    "searchCustomers",
    "searchProjects",
    "createTask",
    "assignTechnician",
    "sendWhatsApp",
    "sendEmail",
  ],
  access: {
    requiredRoles: [
      "Super Admin",
      "Technical CEO",
      "Sales Manager",
      "Admin",
      "Support Agent",
    ],
    requiredPermissions: [],
    requiredOwnership: { type: "none" },
  },
  model: "claude-sonnet-5",
  fallbackModels: ["claude-haiku-4-5", "gpt-5-mini", "gemini-3.5-flash"],
  maxTokens: 4096,
};
