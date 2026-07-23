/**
 * Sunchaser Connect Phase 1B Sprint 2: Deterministic Intent Classifier.
 * Rules-based deterministic classification without direct LLM control over routing.
 * Uses token-based matching to prevent substring false positives (e.g., "hi" inside "this").
 */
import { clampConfidence, type LeadIntent } from "./leadQualificationTypes.ts";

export type IntentClassificationResult = {
  intent: LeadIntent;
  confidence: number;
  reason: string;
};

export class AiIntentClassifier {
  classify(textBody: string | null | undefined, isExistingCustomer: boolean = false): IntentClassificationResult {
    if (!textBody || !textBody.trim()) {
      return {
        intent: "Unknown",
        confidence: 0.1,
        reason: "Empty or null message text",
      };
    }

    // Limit text length to prevent expensive operations on huge strings
    const truncatedText = textBody.slice(0, 10000);
    const text = truncatedText.toLowerCase().trim();

    // Tokenize text into distinct words
    const tokens = text
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const tokenSet = new Set(tokens);

    const hasToken = (...kw: string[]): boolean => kw.some((k) => tokenSet.has(k.toLowerCase()));
    const hasPhrase = (...ph: string[]): boolean => ph.some((p) => text.includes(p.toLowerCase()));

    // 1. Complaint (high priority)
    if (hasToken("complaint", "fault", "kharab") || hasPhrase("not working", "bad service", "issue")) {
      return {
        intent: "Complaint",
        confidence: clampConfidence(0.95),
        reason: "Matched complaint keywords or phrases",
      };
    }

    // 2. Warranty
    if (hasToken("warranty", "guarantee", "claim")) {
      return {
        intent: "Warranty",
        confidence: clampConfidence(0.95),
        reason: "Matched warranty inquiry keywords",
      };
    }

    // 3. Support / Maintenance
    if (hasToken("support", "service", "repair", "maintenance", "cleaning")) {
      return {
        intent: "Support",
        confidence: clampConfidence(0.9),
        reason: "Matched technical support/service keywords",
      };
    }

    // 4. Industrial Solar
    if (hasToken("industrial", "factory", "mill", "plant", "500kw", "1mw", "megawatt")) {
      return {
        intent: "IndustrialSolar",
        confidence: clampConfidence(0.95),
        reason: "Matched industrial scale solar keywords",
      };
    }

    // 5. Commercial Solar
    if (hasToken("commercial", "office", "plaza", "school", "hospital", "50kw", "100kw")) {
      return {
        intent: "CommercialSolar",
        confidence: clampConfidence(0.9),
        reason: "Matched commercial solar keywords",
      };
    }

    // 6. Net Metering
    if (hasPhrase("net metering", "green meter", "lesco meter", "ke meter", "grid export") || hasToken("netmetering")) {
      return {
        intent: "NetMetering",
        confidence: clampConfidence(0.92),
        reason: "Matched net metering keywords",
      };
    }

    // 7. Battery Upgrade / Backup
    if (hasToken("battery", "backup", "lithium", "tubular") || hasPhrase("load shedding")) {
      return {
        intent: "BatteryUpgrade",
        confidence: clampConfidence(0.88),
        reason: "Matched battery or backup upgrade keywords",
      };
    }

    // 8. Existing Customer check
    if (isExistingCustomer || hasPhrase("my invoice", "my installation", "customer id")) {
      return {
        intent: "ExistingCustomer",
        confidence: clampConfidence(0.9),
        reason: "Matched existing customer context or invoice keywords",
      };
    }

    // 9. Residential Solar
    if (hasToken("residential", "home", "house", "ghar", "5kw", "10kw", "15kw", "roof")) {
      return {
        intent: "ResidentialSolar",
        confidence: clampConfidence(0.9),
        reason: "Matched residential solar keywords",
      };
    }

    // 10. General Inquiry (Uses token matching so "hi" doesn't match inside "this", "white", "machine")
    if (hasToken("hi", "hello", "assalam", "oa", "aoa", "price", "rate", "cost", "solar")) {
      return {
        intent: "GeneralInquiry",
        confidence: clampConfidence(0.8),
        reason: "Matched general greeting or solar inquiry tokens",
      };
    }

    return {
      intent: "Unknown",
      confidence: clampConfidence(0.4),
      reason: "No deterministic keywords matched",
    };
  }
}
