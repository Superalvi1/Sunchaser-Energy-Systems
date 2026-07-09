/**
 * Stage 7 — Permission assignment.
 *
 * Assigns the visibility label (and, when applicable, role list) a new
 * document is written with. This does not re-implement or bypass
 * KnowledgePermissions/OwnershipResolvers — it only decides which
 * KnowledgeVisibility value the document is tagged with at write time; every
 * subsequent read is still gated by the existing KnowledgePermissions
 * evaluator, unchanged.
 */

import { isKnowledgeVisibility, type KnowledgeVisibility } from "../knowledge/KnowledgeModels.ts";
import type { KnowledgeLinkedResource } from "../knowledge/KnowledgeMetadata.ts";
import { DocumentPipelineError } from "./DocumentModels.ts";

export interface PermissionAssignmentInput {
  requestedVisibility?: string;
  linkedResource?: KnowledgeLinkedResource;
  allowedRoles?: string[];
}

export interface PermissionAssignmentResult {
  visibility: KnowledgeVisibility;
  allowedRoles?: string[];
  reason: string;
}

/** Default visibility when nothing more specific is requested or inferable. */
export const DEFAULT_KNOWLEDGE_VISIBILITY: KnowledgeVisibility = "company";

export function assignPermissions(input: PermissionAssignmentInput): PermissionAssignmentResult {
  if (input.requestedVisibility !== undefined) {
    if (!isKnowledgeVisibility(input.requestedVisibility)) {
      throw new DocumentPipelineError(
        "permission_assignment",
        `requestedVisibility is not a valid KnowledgeVisibility: ${input.requestedVisibility}`
      );
    }
    if (input.requestedVisibility === "role_restricted") {
      if (!input.allowedRoles || input.allowedRoles.length === 0) {
        throw new DocumentPipelineError(
          "permission_assignment",
          "role_restricted visibility requires a non-empty allowedRoles list"
        );
      }
      return { visibility: "role_restricted", allowedRoles: input.allowedRoles, reason: "requested_role_restricted" };
    }
    if (input.requestedVisibility === "customer_scoped" && !input.linkedResource?.customerId) {
      throw new DocumentPipelineError(
        "permission_assignment",
        "customer_scoped visibility requires linkedResource.customerId"
      );
    }
    return { visibility: input.requestedVisibility, reason: "requested_visibility" };
  }

  if (input.linkedResource?.customerId) {
    return { visibility: "customer_scoped", reason: "inferred_from_linked_customer" };
  }

  return { visibility: DEFAULT_KNOWLEDGE_VISIBILITY, reason: "default_company_visibility" };
}
