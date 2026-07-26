import {
  EVIDENCE_BLOCKER_VARIANT_IDS,
  type SupplierMappingRow,
} from "./adapterTypes.ts";

const BLOCKER_SET = new Set<string>(EVIDENCE_BLOCKER_VARIANT_IDS);

export function isEvidenceBlockerVariant(variantId: string): boolean {
  return BLOCKER_SET.has(variantId);
}

export function isMappingPublishEligible(mapping: SupplierMappingRow): boolean {
  return (
    mapping.active &&
    !mapping.matchLocked &&
    mapping.matchConfidence === "exact" &&
    !isEvidenceBlockerVariant(mapping.variantId)
  );
}

export function mappingRejectionReason(
  mapping: SupplierMappingRow,
): string | null {
  if (isEvidenceBlockerVariant(mapping.variantId) || mapping.matchLocked) {
    return "supplier_evidence_gap";
  }
  if (mapping.matchConfidence === "conflict") return "conflict";
  if (mapping.matchConfidence !== "exact") return "supplier_evidence_gap";
  if (!mapping.active) return "supplier_evidence_gap";
  return null;
}
