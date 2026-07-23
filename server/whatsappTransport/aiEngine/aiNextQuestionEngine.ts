/**
 * Sunchaser Connect Phase 1B Sprint 2: Next Question Engine.
 * Deterministically recommends the next question to ask based on missing fields.
 * NEVER sends any message.
 */

export class AiNextQuestionEngine {
  recommendNextQuestion(missingFields: string[]): string | null {
    if (missingFields.length === 0) {
      return null;
    }

    const firstMissing = missingFields[0];

    switch (firstMissing) {
      case "Monthly Bill":
        return "Ask monthly electricity bill in PKR";
      case "City":
        return "Ask city or location in Pakistan";
      case "Property Type":
        return "Ask property type (Residential / Commercial / Industrial)";
      case "Electric Phase":
        return "Ask electric phase (Single Phase vs 3-Phase)";
      case "Roof Type":
        return "Ask roof construction type (Concrete Slab / Sheet / Tile)";
      case "Battery / Backup Requirement":
        return "Ask backup requirement or battery preference";
      case "Timeline":
        return "Ask installation timeline expectation";
      case "Budget":
        return "Ask estimated budget allocation";
      default:
        return `Ask for ${firstMissing}`;
    }
  }
}
