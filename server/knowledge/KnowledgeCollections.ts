/**
 * Collection taxonomy and collection-to-permission-domain mapping.
 */

import {
  isKnowledgeCollection,
  KNOWLEDGE_COLLECTIONS,
  type KnowledgeCollection,
} from "./KnowledgeModels.ts";

/** Permission domain used by KnowledgePermissions to delegate to OwnershipResolvers. */
export type KnowledgePermissionDomain =
  | "admin"
  | "sales"
  | "finance"
  | "technician"
  | "customer"
  | "hr"
  | "legal"
  | "general";

export interface KnowledgeCollectionDefinition {
  id: KnowledgeCollection;
  label: string;
  description: string;
  permissionDomain: KnowledgePermissionDomain;
  /** Future: document types this collection typically holds. */
  typicalMimeTypes: string[];
}

const COLLECTION_DEFINITIONS: Record<KnowledgeCollection, KnowledgeCollectionDefinition> = {
  Policies: {
    id: "Policies",
    label: "Policies",
    description: "Company-wide and departmental policies",
    permissionDomain: "hr",
    typicalMimeTypes: ["application/pdf"],
  },
  SOPs: {
    id: "SOPs",
    label: "Standard Operating Procedures",
    description: "Operational SOPs and runbooks",
    permissionDomain: "general",
    typicalMimeTypes: ["application/pdf"],
  },
  Projects: {
    id: "Projects",
    label: "Projects",
    description: "Project files, drawings, and deliverables",
    permissionDomain: "sales",
    typicalMimeTypes: ["application/pdf", "image/png"],
  },
  Customers: {
    id: "Customers",
    label: "Customers",
    description: "Customer-facing and customer-owned documents",
    permissionDomain: "customer",
    typicalMimeTypes: ["application/pdf"],
  },
  Finance: {
    id: "Finance",
    label: "Finance",
    description: "Invoices, purchase orders, and finance records",
    permissionDomain: "finance",
    typicalMimeTypes: ["application/pdf", "application/vnd.ms-excel"],
  },
  Engineering: {
    id: "Engineering",
    label: "Engineering",
    description: "Technical drawings, specs, and engineering manuals",
    permissionDomain: "technician",
    typicalMimeTypes: ["application/pdf", "image/png"],
  },
  Products: {
    id: "Products",
    label: "Products",
    description: "Product catalogues and datasheets",
    permissionDomain: "general",
    typicalMimeTypes: ["application/pdf"],
  },
  Inventory: {
    id: "Inventory",
    label: "Inventory",
    description: "Inventory and procurement reference documents",
    permissionDomain: "finance",
    typicalMimeTypes: ["application/pdf", "application/vnd.ms-excel"],
  },
  Sales: {
    id: "Sales",
    label: "Sales",
    description: "Quotations, proposals, and sales collateral",
    permissionDomain: "sales",
    typicalMimeTypes: ["application/pdf"],
  },
  Support: {
    id: "Support",
    label: "Support",
    description: "Support tickets, warranty docs, and service manuals",
    permissionDomain: "technician",
    typicalMimeTypes: ["application/pdf"],
  },
  Procurement: {
    id: "Procurement",
    label: "Procurement",
    description: "Purchase orders and supplier documents",
    permissionDomain: "finance",
    typicalMimeTypes: ["application/pdf"],
  },
  HR: {
    id: "HR",
    label: "Human Resources",
    description: "HR policies, contracts, and employee documents",
    permissionDomain: "hr",
    typicalMimeTypes: ["application/pdf"],
  },
  Legal: {
    id: "Legal",
    label: "Legal",
    description: "Contracts, agreements, and legal filings",
    permissionDomain: "legal",
    typicalMimeTypes: ["application/pdf"],
  },
  General: {
    id: "General",
    label: "General",
    description: "Uncategorized company knowledge",
    permissionDomain: "general",
    typicalMimeTypes: ["application/octet-stream"],
  },
};

export function listKnowledgeCollections(): KnowledgeCollectionDefinition[] {
  return KNOWLEDGE_COLLECTIONS.map((id) => COLLECTION_DEFINITIONS[id]);
}

export function getKnowledgeCollectionDefinition(
  collection: KnowledgeCollection
): KnowledgeCollectionDefinition {
  return COLLECTION_DEFINITIONS[collection];
}

export function resolveCollectionPermissionDomain(collection: KnowledgeCollection): KnowledgePermissionDomain {
  return COLLECTION_DEFINITIONS[collection].permissionDomain;
}

export function assertValidKnowledgeCollection(value: string): KnowledgeCollection {
  if (!isKnowledgeCollection(value)) {
    throw new Error(`Invalid knowledge collection: ${value}`);
  }
  return value;
}
