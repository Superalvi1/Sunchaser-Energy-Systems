import type { AgentDefinition } from "../core/AIRouter.ts";
import { FINANCE_AGENT_PROMPT } from "../prompts/agents/finance.ts";

export const FinanceAgent: AgentDefinition = {
  id: "finance",
  name: "Finance Agent",
  description: "Invoicing, receivables, and financial reporting for authorized staff.",
  systemPrompt: FINANCE_AGENT_PROMPT,
  allowedTools: [
    "searchCustomers",
    "searchProjects",
    "createInvoice",
    "generateReport",
    "createTask",
    "sendEmail",
  ],
  access: {
    requiredRoles: ["Super Admin", "Technical CEO", "Sales Manager", "Admin"],
    requiredPermissions: ["finance:read"],
    requiredOwnership: { type: "none" },
  },
  model: "claude-opus-4-8",
  fallbackModels: ["claude-sonnet-5", "gpt-5"],
  maxTokens: 4096,
};
