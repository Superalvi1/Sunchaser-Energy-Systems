/**
 * Knowledge permissions — delegates to existing OwnershipResolvers.
 *
 * Never bypasses ownership. No DB access in V5 architecture layer.
 */

import type { RequestActor } from "../middleware/actor.ts";
import { OwnershipResolver } from "../ownership/OwnershipResolver.ts";
import {
  FinanceOwnershipResolver,
  isFinanceOwnershipBypassRole,
  isFinanceStaffRole,
} from "../ownership/FinanceOwnershipResolver.ts";
import {
  isRowSalesOwnedByActor,
  isSalesOwnershipBypassRole,
  isSalesStaffRole,
} from "../ownership/SalesOwnershipResolver.ts";
import {
  isRowAssignedToActor,
  TechnicianOwnershipResolver,
} from "../ownership/TechnicianOwnershipResolver.ts";
import { resolveCollectionPermissionDomain, type KnowledgePermissionDomain } from "./KnowledgeCollections.ts";
import type { KnowledgeDocument } from "./KnowledgeDocument.ts";
import type { KnowledgeDocumentMetadata, KnowledgeLinkedResource } from "./KnowledgeMetadata.ts";
import type { KnowledgeCollection, KnowledgeVisibility } from "./KnowledgeModels.ts";

export type KnowledgePermissionAction = "read" | "write" | "delete" | "index";

export interface KnowledgePermissionContext {
  metadata?: KnowledgeDocumentMetadata;
  /** CRM row used for ownership checks when document is linked to a resource. */
  linkedResourceRow?: Record<string, unknown>;
}

export interface KnowledgePermissionDecision {
  allowed: boolean;
  reason: string;
  domain: KnowledgePermissionDomain;
}

const ADMIN_BROAD_ROLES = new Set(["Admin", "Director", "Super Admin", "Technical CEO"]);
const HR_ROLES = new Set(["Admin", "Director", "Super Admin", "HR Manager"]);
const LEGAL_ROLES = new Set(["Admin", "Director", "Super Admin", "Legal"]);

function isAdminBroadRole(role: string): boolean {
  return ADMIN_BROAD_ROLES.has(role);
}

function actorMatchesOwner(actor: RequestActor, ownerId: string): boolean {
  return actor.id === ownerId;
}

function actorInSameDepartment(actor: RequestActor, department: string, actorDepartment?: string): boolean {
  const actorDept = String(actorDepartment || "").trim().toLowerCase();
  const docDept = String(department || "").trim().toLowerCase();
  return Boolean(actorDept && docDept && actorDept === docDept);
}

function actorHasAllowedRole(actor: RequestActor, allowedRoles: string[] | undefined): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return false;
  return allowedRoles.includes(actor.role);
}

function resolveLinkedCustomerId(
  metadata: KnowledgeDocumentMetadata | undefined,
  linkedResourceRow?: Record<string, unknown>
): string {
  const fromMeta = metadata?.linkedResource?.customerId?.trim();
  if (fromMeta) return fromMeta;
  if (linkedResourceRow) {
    return String(linkedResourceRow.customer_id || linkedResourceRow.customerId || "").trim();
  }
  return "";
}

function checkCustomerScopedAccess(
  actor: RequestActor,
  metadata: KnowledgeDocumentMetadata | undefined,
  linkedResourceRow: Record<string, unknown> | undefined
): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "customer";
  if (actor.role !== "Customer") {
    return { allowed: false, reason: "customer_scoped_requires_customer_actor", domain };
  }
  try {
    const actorCustomerId = OwnershipResolver.assertCustomerActor(actor);
    const resourceCustomerId = resolveLinkedCustomerId(metadata, linkedResourceRow);
    if (!resourceCustomerId) {
      return { allowed: false, reason: "customer_scoped_missing_customer_link", domain };
    }
    if (actorCustomerId !== resourceCustomerId) {
      return { allowed: false, reason: "customer_scoped_mismatch", domain };
    }
    return { allowed: true, reason: "customer_owns_linked_resource", domain };
  } catch {
    return { allowed: false, reason: "customer_actor_invalid", domain };
  }
}

function checkSalesDomainAccess(
  actor: RequestActor,
  action: KnowledgePermissionAction,
  linkedResourceRow: Record<string, unknown> | undefined
): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "sales";
  if (isSalesOwnershipBypassRole(actor.role) || isAdminBroadRole(actor.role)) {
    return { allowed: true, reason: "sales_bypass_role", domain };
  }
  if (!isSalesStaffRole(actor.role)) {
    return { allowed: false, reason: "not_sales_staff", domain };
  }
  if (action === "read" && !linkedResourceRow) {
    return { allowed: true, reason: "sales_staff_collection_read", domain };
  }
  if (linkedResourceRow && isRowSalesOwnedByActor(actor, linkedResourceRow)) {
    return { allowed: true, reason: "sales_owns_linked_resource", domain };
  }
  return { allowed: false, reason: "sales_ownership_denied", domain };
}

function checkFinanceDomainAccess(actor: RequestActor): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "finance";
  if (isFinanceOwnershipBypassRole(actor.role) || isAdminBroadRole(actor.role)) {
    return { allowed: true, reason: "finance_bypass_role", domain };
  }
  if (isFinanceStaffRole(actor.role)) {
    return { allowed: true, reason: "finance_staff", domain };
  }
  try {
    FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(actor);
    return { allowed: true, reason: "finance_route_access", domain };
  } catch {
    return { allowed: false, reason: "finance_access_denied", domain };
  }
}

function checkTechnicianDomainAccess(
  actor: RequestActor,
  linkedResourceRow: Record<string, unknown> | undefined
): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "technician";
  if (isAdminBroadRole(actor.role)) {
    return { allowed: true, reason: "admin_bypass", domain };
  }
  try {
    TechnicianOwnershipResolver.assertTechnicianActor(actor);
  } catch {
    return { allowed: false, reason: "not_technician", domain };
  }
  if (!linkedResourceRow) {
    return { allowed: true, reason: "technician_collection_read", domain };
  }
  if (isRowAssignedToActor(actor, linkedResourceRow)) {
    return { allowed: true, reason: "technician_assigned", domain };
  }
  return { allowed: false, reason: "technician_not_assigned", domain };
}

function checkHrDomainAccess(actor: RequestActor): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "hr";
  if (HR_ROLES.has(actor.role)) {
    return { allowed: true, reason: "hr_role", domain };
  }
  return { allowed: false, reason: "hr_access_denied", domain };
}

function checkLegalDomainAccess(actor: RequestActor): KnowledgePermissionDecision {
  const domain: KnowledgePermissionDomain = "legal";
  if (LEGAL_ROLES.has(actor.role)) {
    return { allowed: true, reason: "legal_role", domain };
  }
  return { allowed: false, reason: "legal_access_denied", domain };
}

function checkDomainAccess(
  actor: RequestActor,
  domain: KnowledgePermissionDomain,
  action: KnowledgePermissionAction,
  context: KnowledgePermissionContext
): KnowledgePermissionDecision {
  switch (domain) {
    case "admin":
      return isAdminBroadRole(actor.role)
        ? { allowed: true, reason: "admin_domain", domain }
        : { allowed: false, reason: "admin_access_denied", domain };
    case "sales":
      return checkSalesDomainAccess(actor, action, context.linkedResourceRow);
    case "finance":
      return checkFinanceDomainAccess(actor);
    case "technician":
      return checkTechnicianDomainAccess(actor, context.linkedResourceRow);
    case "customer":
      return checkCustomerScopedAccess(actor, context.metadata, context.linkedResourceRow);
    case "hr":
      return checkHrDomainAccess(actor);
    case "legal":
      return checkLegalDomainAccess(actor);
    case "general":
      // General/SOPs/Products are staff-only. "company" visibility on these
      // collections must mean authenticated internal staff, never Customer.
      return actor.role !== "Customer"
        ? { allowed: true, reason: "general_staff_collection", domain }
        : { allowed: false, reason: "general_requires_staff", domain };
    default:
      return { allowed: false, reason: "unknown_domain", domain: "general" };
  }
}

function checkVisibilityAccess(
  actor: RequestActor,
  document: KnowledgeDocument,
  context: KnowledgePermissionContext,
  actorDepartment?: string
): KnowledgePermissionDecision | null {
  const domain = resolveCollectionPermissionDomain(document.collection);

  if (document.visibility === "customer_scoped") {
    return checkCustomerScopedAccess(actor, context.metadata, context.linkedResourceRow);
  }

  if (document.visibility === "private") {
    return actorMatchesOwner(actor, document.owner)
      ? { allowed: true, reason: "document_owner", domain }
      : { allowed: false, reason: "private_not_owner", domain };
  }

  if (document.visibility === "department") {
    if (actorMatchesOwner(actor, document.owner)) {
      return { allowed: true, reason: "document_owner", domain };
    }
    if (actorInSameDepartment(actor, document.department, actorDepartment)) {
      return { allowed: true, reason: "same_department", domain };
    }
    return { allowed: false, reason: "department_mismatch", domain };
  }

  if (document.visibility === "role_restricted") {
    if (actorMatchesOwner(actor, document.owner)) {
      return { allowed: true, reason: "document_owner", domain };
    }
    if (actorHasAllowedRole(actor, context.metadata?.allowedRoles)) {
      return { allowed: true, reason: "role_allowed", domain };
    }
    return { allowed: false, reason: "role_not_allowed", domain };
  }

  // company visibility falls through to domain check
  return null;
}

export function evaluateKnowledgePermission(
  actor: RequestActor | undefined,
  document: KnowledgeDocument,
  action: KnowledgePermissionAction,
  context: KnowledgePermissionContext = {},
  actorDepartment?: string
): KnowledgePermissionDecision {
  const domain = resolveCollectionPermissionDomain(document.collection);

  if (!actor) {
    return { allowed: false, reason: "unauthenticated", domain };
  }

  if (document.status === "deleted" && action !== "delete") {
    return { allowed: false, reason: "document_deleted", domain };
  }

  if (document.companyId && actor.role !== "Customer") {
    // company scoping placeholder — actor company not on RequestActor yet
  }

  const visibilityDecision = checkVisibilityAccess(actor, document, context, actorDepartment);
  if (visibilityDecision && !visibilityDecision.allowed) {
    return visibilityDecision;
  }

  const domainDecision = checkDomainAccess(actor, domain, action, context);
  if (!domainDecision.allowed) {
    return domainDecision;
  }

  if (visibilityDecision?.allowed) {
    return visibilityDecision;
  }

  return domainDecision;
}

export function canActorReadKnowledgeDocument(
  actor: RequestActor | undefined,
  document: KnowledgeDocument,
  context?: KnowledgePermissionContext,
  actorDepartment?: string
): boolean {
  return evaluateKnowledgePermission(actor, document, "read", context, actorDepartment).allowed;
}

export function canActorWriteKnowledgeDocument(
  actor: RequestActor | undefined,
  document: KnowledgeDocument,
  context?: KnowledgePermissionContext,
  actorDepartment?: string
): boolean {
  if (!actor) return false;
  if (actorMatchesOwner(actor, document.owner)) return true;
  const decision = evaluateKnowledgePermission(actor, document, "write", context, actorDepartment);
  if (!decision.allowed) return false;
  return isAdminBroadRole(actor.role) || isSalesOwnershipBypassRole(actor.role);
}

export function canActorDeleteKnowledgeDocument(
  actor: RequestActor | undefined,
  document: KnowledgeDocument,
  context?: KnowledgePermissionContext
): boolean {
  if (!actor) return false;
  if (actorMatchesOwner(actor, document.owner)) return true;
  const decision = evaluateKnowledgePermission(actor, document, "delete", context);
  if (!decision.allowed) return false;
  return isAdminBroadRole(actor.role);
}

export function assertKnowledgeReadAccess(
  actor: RequestActor | undefined,
  document: KnowledgeDocument,
  context?: KnowledgePermissionContext
): void {
  const decision = evaluateKnowledgePermission(actor, document, "read", context);
  if (!decision.allowed) {
    throw new KnowledgePermissionError(decision.reason, 403);
  }
}

export class KnowledgePermissionError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "KnowledgePermissionError";
    this.statusCode = statusCode;
  }
}

export function knowledgeLinkedResourceToDomain(
  resource: KnowledgeLinkedResource
): KnowledgePermissionDomain {
  switch (resource.type) {
    case "lead":
    case "project":
    case "quotation":
      return "sales";
    case "invoice":
    case "purchase_order":
      return "finance";
    case "service_request":
    case "support_ticket":
    case "delivery":
      return "technician";
    case "customer":
    case "warranty":
      return "customer";
    default:
      return "general";
  }
}
