import type { AgentDefinition } from "../core/AIRouter.ts";
import { SALES_AGENT_PROMPT } from "../prompts/agents/sales.ts";

export const SalesAgent: AgentDefinition = {
  id: "sales",
  name: "Sales Agent",
  description: "Lead qualification, quotations, and pipeline assistance for the sales team.",
  systemPrompt: SALES_AGENT_PROMPT,
  allowedTools: [
    "searchCustomers",
    "searchInventory",
    "searchProjects",
    "createQuotation",
    "createTask",
    "sendWhatsApp",
    "sendEmail",
  ],
  access: {
    requiredRoles: [
      "Super Admin",
      "Technical CEO",
      "Sales Manager",
      "Sales Advisor",
      "Sales Executive",
      "Admin",
    ],
    requiredPermissions: [],
    requiredOwnership: { type: "none" },
  },
  model: "claude-opus-4-8",
  fallbackModels: ["claude-sonnet-5", "gpt-5", "gemini-3.5-pro"],
  maxTokens: 4096,
};
