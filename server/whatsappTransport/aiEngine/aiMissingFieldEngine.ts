/**
 * Sunchaser Connect Phase 1B Sprint 2: Missing Field Engine.
 * Generates deterministic list of uncollected qualification fields.
 * Zero LLM reasoning.
 */
import type { LeadQualificationV1 } from "./leadQualificationTypes.ts";

export class AiMissingFieldEngine {
  getMissingFields(qual: LeadQualificationV1): string[] {
    const missing: string[] = [];

    if (qual.monthlyBillPkr.value === null || qual.monthlyBillPkr.value <= 0) {
      missing.push("Monthly Bill");
    }
    if (!qual.city.value || !qual.city.value.trim()) {
      missing.push("City");
    }
    if (!qual.propertyType.value || !qual.propertyType.value.trim()) {
      missing.push("Property Type");
    }
    if (!qual.electricPhase.value || !qual.electricPhase.value.trim()) {
      missing.push("Electric Phase");
    }
    if (!qual.roofType.value || !qual.roofType.value.trim()) {
      missing.push("Roof Type");
    }
    if (qual.backupRequired.value === null) {
      missing.push("Battery / Backup Requirement");
    }
    if (!qual.installationTimeline.value || !qual.installationTimeline.value.trim()) {
      missing.push("Timeline");
    }
    if (qual.budgetPkr.value === null || qual.budgetPkr.value <= 0) {
      missing.push("Budget");
    }

    return missing;
  }
}
