/**
 * Sunchaser Connect Phase 1B Sprint 2: Deterministic Qualification Scorer.
 * Computes deterministic 0-100 score based strictly on field presence.
 * No AI-generated or arbitrary LLM scoring.
 */
import type { LeadQualificationV1 } from "./leadQualificationTypes.ts";

export class AiQualificationScorer {
  calculateScore(qual: LeadQualificationV1): number {
    let score = 0;

    // 1. Monthly Bill (20 points)
    if (qual.monthlyBillPkr.value !== null && qual.monthlyBillPkr.value > 0) {
      score += 20;
    }

    // 2. City (10 points)
    if (qual.city.value !== null && qual.city.value.trim().length > 0) {
      score += 10;
    }

    // 3. Property Type or Ownership (10 points)
    if (
      (qual.propertyType.value !== null && qual.propertyType.value.trim().length > 0) ||
      (qual.propertyOwnership.value !== null && qual.propertyOwnership.value.trim().length > 0)
    ) {
      score += 10;
    }

    // 4. Electric Phase (10 points)
    if (qual.electricPhase.value !== null && qual.electricPhase.value.trim().length > 0) {
      score += 10;
    }

    // 5. Roof Type or Roof Area (10 points)
    if (
      (qual.roofType.value !== null && qual.roofType.value.trim().length > 0) ||
      (qual.roofApproxArea.value !== null && qual.roofApproxArea.value > 0)
    ) {
      score += 10;
    }

    // 6. Battery or Backup Preference (10 points)
    if (
      qual.backupRequired.value !== null ||
      (qual.batteryPreference.value !== null && qual.batteryPreference.value.trim().length > 0)
    ) {
      score += 10;
    }

    // 7. Installation Timeline (10 points)
    if (qual.installationTimeline.value !== null && qual.installationTimeline.value.trim().length > 0) {
      score += 10;
    }

    // 8. Budget (10 points)
    if (qual.budgetPkr.value !== null && qual.budgetPkr.value > 0) {
      score += 10;
    }

    // 9. Intent (10 points)
    if (qual.customerIntent.value !== null && qual.customerIntent.value !== "Unknown") {
      score += 10;
    }

    // 10. Preferred Language (10 points)
    if (qual.preferredLanguage.value !== null && qual.preferredLanguage.value !== "Unknown") {
      score += 10;
    }

    return Math.min(100, score);
  }
}
