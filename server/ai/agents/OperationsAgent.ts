import type { AgentDefinition } from "../core/AIRouter.ts";
import { OPERATIONS_AGENT_PROMPT } from "../prompts/agents/operations.ts";

export const OperationsAgent: AgentDefinition = {
  id: "operations",
  name: "Operations Agent",
  description: "Installation scheduling, technician assignment, and inventory reservations.",
  systemPrompt: OPERATIONS_AGENT_PROMPT,
  allowedTools: [
    "searchProjects",
    "searchInventory",
    "searchCustomers",
    "assignTechnician",
    "reserveInventory",
    "createTask",
  ],
  access: {
    requiredRoles: [
      "Super Admin",
      "Technical CEO",
      "Sales Manager",
      "Admin",
      "Inventory Manager",
    ],
    requiredPermissions: [],
    requiredOwnership: { type: "none" },
  },
  model: "claude-sonnet-5",
  fallbackModels: ["claude-opus-4-8", "gpt-5", "gemini-3.5-flash"],
  maxTokens: 4096,
};
