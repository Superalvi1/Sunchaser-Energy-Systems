import type { AgentDefinition } from "../core/AIRouter.ts";
import { PROCUREMENT_AGENT_PROMPT } from "../prompts/agents/procurement.ts";

export const ProcurementAgent: AgentDefinition = {
  id: "procurement",
  name: "Procurement Agent",
  description: "Supplier orders and stock replenishment planning.",
  systemPrompt: PROCUREMENT_AGENT_PROMPT,
  allowedTools: [
    "searchInventory",
    "searchProjects",
    "createPurchaseOrder",
    "reserveInventory",
    "createTask",
  ],
  access: {
    requiredRoles: ["Super Admin", "Technical CEO", "Admin", "Inventory Manager"],
    requiredPermissions: [],
    requiredOwnership: { type: "none" },
  },
  model: "claude-sonnet-5",
  fallbackModels: ["claude-opus-4-8", "gpt-5"],
  maxTokens: 4096,
};
