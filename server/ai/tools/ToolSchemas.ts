/**
 * Tool catalog — DECLARATIONS ONLY.
 *
 * Schemas + permission requirements for every platform capability. No
 * handlers: business modules bind implementations at wiring time via
 * `registry.bind(name, handler)`. Until then, calls resolve to a structured
 * "unbound" outcome (see ToolExecutor).
 *
 * Role and permission strings are configuration, not engine logic — they
 * mirror the platform's existing role taxonomy and can be edited freely.
 */

import { DEFAULT_TOOL_TIMEOUT_MS, type Tool } from "./Tool.ts";

const STAFF_ROLES = [
  "Super Admin",
  "Technical CEO",
  "Sales Manager",
  "Sales Advisor",
  "Sales Executive",
  "Admin",
  "Inventory Manager",
  "Support Agent",
];

const MANAGEMENT_ROLES = ["Super Admin", "Technical CEO", "Sales Manager", "Admin"];

function tool(definition: Omit<Tool, "timeoutMs"> & { timeoutMs?: number }): Tool {
  return { timeoutMs: DEFAULT_TOOL_TIMEOUT_MS, ...definition };
}

export const createQuotation = tool({
  name: "createQuotation",
  description:
    "Create a draft quotation for a lead. Use when the user asks to prepare, draft, or generate a quote. Returns the created quotation id and totals.",
  mutating: true,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["quotations:write"],
    requiredOwnership: { type: "policy", policy: "lead-access" },
  },
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead the quotation belongs to." },
      systemSizeKw: { type: "number", description: "Proposed system size in kW." },
      lineItems: {
        type: "array",
        description: "BOQ line items.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unitPrice: { type: "number" },
          },
          required: ["description", "quantity", "unitPrice"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "Optional internal notes." },
    },
    required: ["leadId", "lineItems"],
    additionalProperties: false,
  },
});

export const createInvoice = tool({
  name: "createInvoice",
  description:
    "Create an invoice for a customer project. Use only when explicitly asked to invoice or bill. Returns the invoice id and amount.",
  mutating: true,
  permissions: {
    requiredRoles: MANAGEMENT_ROLES,
    requiredPermissions: ["finance:write"],
    requiredOwnership: { type: "policy", policy: "customer-record-access" },
  },
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string" },
      projectId: { type: "string", description: "Project or delivery the invoice covers." },
      amount: { type: "number", description: "Invoice amount in PKR." },
      dueDate: { type: "string", description: "ISO 8601 due date." },
      lineItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            amount: { type: "number" },
          },
          required: ["description", "amount"],
          additionalProperties: false,
        },
      },
    },
    required: ["customerId", "amount"],
    additionalProperties: false,
  },
});

export const reserveInventory = tool({
  name: "reserveInventory",
  description:
    "Reserve stock for a project so it cannot be double-allocated. Use before confirming delivery timelines.",
  mutating: true,
  permissions: {
    requiredRoles: ["Super Admin", "Technical CEO", "Sales Manager", "Admin", "Inventory Manager"],
    requiredPermissions: ["inventory:write"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      productId: { type: "string" },
      quantity: { type: "number" },
      projectId: { type: "string", description: "Project the reservation is for." },
      until: { type: "string", description: "ISO 8601 expiry of the reservation." },
    },
    required: ["productId", "quantity", "projectId"],
    additionalProperties: false,
  },
});

export const createPurchaseOrder = tool({
  name: "createPurchaseOrder",
  description:
    "Raise a purchase order to a supplier for stock replenishment. Returns the PO id for approval routing.",
  mutating: true,
  permissions: {
    requiredRoles: ["Super Admin", "Technical CEO", "Admin", "Inventory Manager"],
    requiredPermissions: ["procurement:write"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      supplierName: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            productId: { type: "string" },
            quantity: { type: "number" },
            unitCost: { type: "number" },
          },
          required: ["productId", "quantity"],
          additionalProperties: false,
        },
      },
      expectedDelivery: { type: "string", description: "ISO 8601 expected delivery date." },
      notes: { type: "string" },
    },
    required: ["supplierName", "items"],
    additionalProperties: false,
  },
});

export const assignTechnician = tool({
  name: "assignTechnician",
  description:
    "Assign a technician to a job, service request, or installation. Use when scheduling field work.",
  mutating: true,
  permissions: {
    requiredRoles: MANAGEMENT_ROLES,
    requiredPermissions: ["technical:assign"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "Service request, ticket, or delivery id." },
      technicianUserId: { type: "string" },
      scheduledDate: { type: "string", description: "ISO 8601 visit date." },
      instructions: { type: "string" },
    },
    required: ["jobId", "technicianUserId"],
    additionalProperties: false,
  },
});

export const createTask = tool({
  name: "createTask",
  description: "Create an internal follow-up task assigned to a staff member.",
  mutating: true,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["tasks:write"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      assigneeUserId: { type: "string" },
      dueDate: { type: "string", description: "ISO 8601 due date." },
      relatedEntity: {
        type: "object",
        description: "Optional link to a CRM record.",
        properties: {
          kind: { type: "string", enum: ["lead", "customer", "project", "ticket"] },
          id: { type: "string" },
        },
        required: ["kind", "id"],
        additionalProperties: false,
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
});

export const sendWhatsApp = tool({
  name: "sendWhatsApp",
  description:
    "Send a WhatsApp message to a customer or lead. Use only when the user explicitly asks to notify someone. The message is sent externally and cannot be recalled.",
  mutating: true,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["notifications:send"],
    requiredOwnership: { type: "policy", policy: "customer-record-access" },
  },
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Recipient customer/lead id." },
      messageType: {
        type: "string",
        description: "Template family, e.g. quotation_sent, payment_reminder, visit_scheduled.",
      },
      messageBody: { type: "string", description: "Final message text." },
    },
    required: ["customerId", "messageBody"],
    additionalProperties: false,
  },
});

export const sendEmail = tool({
  name: "sendEmail",
  description:
    "Send an email on behalf of the company. Use only when explicitly asked. The email is sent externally and cannot be recalled.",
  mutating: true,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["notifications:send"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string" },
      body: { type: "string", description: "Plain-text or markdown body." },
      attachments: {
        type: "array",
        description: "Ids of previously generated documents to attach.",
        items: { type: "string" },
      },
    },
    required: ["to", "subject", "body"],
    additionalProperties: false,
  },
});

export const generateReport = tool({
  name: "generateReport",
  description:
    "Generate a business report (sales pipeline, finance summary, service SLA, inventory) for a period. Returns a document reference.",
  mutating: false,
  permissions: {
    requiredRoles: MANAGEMENT_ROLES,
    requiredPermissions: ["reports:read"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      reportType: {
        type: "string",
        enum: ["sales", "finance", "service", "inventory", "care-plans"],
      },
      from: { type: "string", description: "ISO 8601 period start." },
      to: { type: "string", description: "ISO 8601 period end." },
      format: { type: "string", enum: ["summary", "detailed"], description: "Defaults to summary." },
    },
    required: ["reportType", "from", "to"],
    additionalProperties: false,
  },
});

export const searchCustomers = tool({
  name: "searchCustomers",
  description:
    "Search customers and leads by name, phone, email, or status. Read-only. Use before any customer-specific action to resolve ids.",
  mutating: false,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["customers:read"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text search terms." },
      status: { type: "string", description: "Optional lead/customer status filter." },
      limit: { type: "number", description: "Max results (default 10)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
});

export const searchInventory = tool({
  name: "searchInventory",
  description:
    "Search products and stock levels by name, SKU, or category. Read-only.",
  mutating: false,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["inventory:read"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      category: { type: "string" },
      inStockOnly: { type: "boolean" },
      limit: { type: "number" },
    },
    required: ["query"],
    additionalProperties: false,
  },
});

export const searchProjects = tool({
  name: "searchProjects",
  description:
    "Search projects and deliveries by customer, stage, or date range. Read-only.",
  mutating: false,
  permissions: {
    requiredRoles: STAFF_ROLES,
    requiredPermissions: ["projects:read"],
    requiredOwnership: { type: "none" },
  },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Customer name, project id, or free text." },
      stage: { type: "string", description: "Optional stage filter." },
      from: { type: "string", description: "ISO 8601 period start." },
      to: { type: "string", description: "ISO 8601 period end." },
      limit: { type: "number" },
    },
    required: ["query"],
    additionalProperties: false,
  },
});

/** The full platform catalog, in registration order. */
export const PLATFORM_TOOLS: Tool[] = [
  createQuotation,
  createInvoice,
  reserveInventory,
  createPurchaseOrder,
  assignTechnician,
  createTask,
  sendWhatsApp,
  sendEmail,
  generateReport,
  searchCustomers,
  searchInventory,
  searchProjects,
];
