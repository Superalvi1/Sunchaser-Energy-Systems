/**
 * Sunchaser Connect Phase 1B Sprint 2: Deterministic Intent Classifier.
 * Rules-based deterministic classification without direct LLM control over routing.
 */
import type { LeadIntent } from "./leadQualificationTypes.ts";

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

    const text = textBody.toLowerCase().trim();

    // 1. Complaint (high priority)
    if (text.includes("complaint") || text.includes("issue") || text.includes("not working") || text.includes("fault") || text.includes("kharab")) {
      return {
        intent: "Complaint",
        confidence: 0.95,
        reason: "Matched complaint keywords (complaint/issue/kharab)",
      };
    }

    // 2. Warranty
    if (text.includes("warranty") || text.includes("guarantee") || text.includes("claim")) {
      return {
        intent: "Warranty",
        confidence: 0.95,
        reason: "Matched warranty inquiry keywords",
      };
    }

    // 3. Support / Maintenance
    if (text.includes("support") || text.includes("service") || text.includes("repair") || text.includes("maintenance") || text.includes("cleaning")) {
      return {
        intent: "Support",
        confidence: 0.9,
        reason: "Matched technical support/service keywords",
      };
    }

    // 4. Industrial Solar
    if (text.includes("industrial") || text.includes("factory") || text.includes("mill") || text.includes("plant") || text.includes("500kw") || text.includes("1mw") || text.includes("megawatt")) {
      return {
        intent: "IndustrialSolar",
        confidence: 0.95,
        reason: "Matched industrial scale solar keywords",
      };
    }

    // 5. Commercial Solar
    if (text.includes("commercial") || text.includes("office") || text.includes("plaza") || text.includes("school") || text.includes("hospital") || text.includes("50kw") || text.includes("100kw")) {
      return {
        intent: "CommercialSolar",
        confidence: 0.9,
        reason: "Matched commercial solar keywords",
      };
    }

    // 6. Net Metering
    if (text.includes("net metering") || text.includes("green meter") || text.includes("lesco meter") || text.includes("ke meter") || text.includes("grid export")) {
      return {
        intent: "NetMetering",
        confidence: 0.92,
        reason: "Matched net metering keywords",
      };
    }

    // 7. Battery Upgrade / Backup
    if (text.includes("battery") || text.includes("backup") || text.includes("lithium") || text.includes("tubular") || text.includes("load shedding")) {
      return {
        intent: "BatteryUpgrade",
        confidence: 0.88,
        reason: "Matched battery or backup upgrade keywords",
      };
    }

    // 8. Existing Customer check
    if (isExistingCustomer || text.includes("my invoice") || text.includes("my installation") || text.includes("customer id")) {
      return {
        intent: "ExistingCustomer",
        confidence: 0.9,
        reason: "Matched existing customer context or invoice keywords",
      };
    }

    // 9. Residential Solar
    if (text.includes("residential") || text.includes("home") || text.includes("house") || text.includes("ghar") || text.includes("5kw") || text.includes("10kw") || text.includes("15kw") || text.includes("roof")) {
      return {
        intent: "ResidentialSolar",
        confidence: 0.9,
        reason: "Matched residential solar keywords",
      };
    }

    // 10. General Inquiry
    if (text.includes("hi") || text.includes("hello") || text.includes("assalam") || text.includes("price") || text.includes("rate") || text.includes("cost") || text.includes("solar")) {
      return {
        intent: "GeneralInquiry",
        confidence: 0.8,
        reason: "Matched general greeting or solar inquiry terms",
      };
    }

    return {
      intent: "Unknown",
      confidence: 0.4,
      reason: "No deterministic keywords matched",
    };
  }
}
