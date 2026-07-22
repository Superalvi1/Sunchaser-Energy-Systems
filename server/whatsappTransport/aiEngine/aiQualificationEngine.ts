/**
 * Sunchaser Connect Phase 1B Sprint 2: AI Lead Qualification Engine.
 * Implements Human Override Protection, Shadow Report Generation, and Field Provenance.
 * AI MUST remain in AI_SHADOW mode. Zero outbound WhatsApp, Zero CRM mutations.
 */
import type {
  FieldSource,
  LeadIntent,
  LeadQualificationV1,
  QualificationField,
  ShadowQualificationReport,
} from "./leadQualificationTypes.ts";
import { AiIntentClassifier } from "./aiIntentClassifier.ts";
import { AiLanguageDetector } from "./aiLanguageDetector.ts";
import { AiMissingFieldEngine } from "./aiMissingFieldEngine.ts";
import { AiNextQuestionEngine } from "./aiNextQuestionEngine.ts";
import { AiQualificationScorer } from "./aiQualificationScorer.ts";

function createEmptyField<T>(initialValue: T | null = null, source: FieldSource = "SYSTEM"): QualificationField<T> {
  return {
    value: initialValue,
    confidence: initialValue !== null ? 1.0 : 0.0,
    source,
    lastUpdated: new Date().toISOString(),
  };
}

export function createInitialLeadQualification(
  conversationId: string,
  phoneNumber?: string | null,
  customerName?: string | null
): LeadQualificationV1 {
  const now = new Date().toISOString();
  return {
    version: "V1",
    conversationId,
    customerName: createEmptyField(customerName ?? null, customerName ? "IMPORTED" : "SYSTEM"),
    phoneNumber: createEmptyField(phoneNumber ?? null, phoneNumber ? "IMPORTED" : "SYSTEM"),
    city: createEmptyField(),
    propertyType: createEmptyField(),
    propertyOwnership: createEmptyField(),
    monthlyBillPkr: createEmptyField(),
    electricPhase: createEmptyField(),
    backupRequired: createEmptyField(),
    batteryPreference: createEmptyField(),
    roofType: createEmptyField(),
    roofApproxArea: createEmptyField(),
    netMeteringStatus: createEmptyField(),
    installationTimeline: createEmptyField(),
    budgetPkr: createEmptyField(),
    preferredLanguage: createEmptyField("Unknown", "SYSTEM"),
    customerIntent: createEmptyField("Unknown", "SYSTEM"),
    existingCustomer: createEmptyField(false, "SYSTEM"),
    commercialScale: createEmptyField(),
    notes: createEmptyField(),
    updatedAt: now,
  };
}

export class AiQualificationEngine {
  private readonly intentClassifier = new AiIntentClassifier();
  private readonly languageDetector = new AiLanguageDetector();
  private readonly qualificationScorer = new AiQualificationScorer();
  private readonly missingFieldEngine = new AiMissingFieldEngine();
  private readonly nextQuestionEngine = new AiNextQuestionEngine();

  /**
   * Applies Human Override Protection rules:
   * If existing field source is HUMAN or SYSTEM, AI can NEVER overwrite it.
   */
  mergeField<T>(
    existing: QualificationField<T>,
    incoming: { value: T | null; confidence: number; source: FieldSource }
  ): QualificationField<T> {
    const now = new Date().toISOString();

    // 1. Human Override Protection: HUMAN source is immutable by AI
    if (existing.source === "HUMAN" && incoming.source === "AI") {
      return existing;
    }

    // 2. System Protection: SYSTEM source is immutable by AI if non-null
    if (existing.source === "SYSTEM" && existing.value !== null && incoming.source === "AI") {
      return existing;
    }

    // 3. Null incoming value does not overwrite valid existing value
    if (incoming.value === null || incoming.value === undefined) {
      return existing;
    }

    // Update field
    return {
      value: incoming.value,
      confidence: incoming.confidence,
      source: incoming.source,
      lastUpdated: now,
    };
  }

  generateReport(
    qual: LeadQualificationV1,
    latestTextBody?: string | null,
    isExistingCustomer: boolean = false
  ): ShadowQualificationReport {
    const now = new Date().toISOString();

    // 1. Detect language
    const language = this.languageDetector.detect(latestTextBody);
    if (language !== "Unknown") {
      qual.preferredLanguage = this.mergeField(qual.preferredLanguage, {
        value: language,
        confidence: 0.9,
        source: "AI",
      });
    }

    // 2. Classify intent
    const intentResult = this.intentClassifier.classify(latestTextBody, isExistingCustomer);
    qual.customerIntent = this.mergeField(qual.customerIntent, {
      value: intentResult.intent,
      confidence: intentResult.confidence,
      source: "AI",
    });

    // 3. Calculate score
    const score = this.qualificationScorer.calculateScore(qual);

    // 4. Determine missing fields
    const missingFields = this.missingFieldEngine.getMissingFields(qual);

    // 5. Recommend next question
    const recommendedNextQuestion = this.nextQuestionEngine.recommendNextQuestion(missingFields);

    // 6. Human Review Required trigger
    const humanReviewRequired =
      intentResult.confidence < 0.7 ||
      intentResult.intent === "Complaint" ||
      intentResult.intent === "Warranty" ||
      intentResult.intent === "Unknown";

    // 7. Extracted non-null fields map
    const extractedFields: Record<string, unknown> = {};
    const keys: (keyof LeadQualificationV1)[] = [
      "customerName", "phoneNumber", "city", "propertyType", "propertyOwnership",
      "monthlyBillPkr", "electricPhase", "backupRequired", "batteryPreference",
      "roofType", "roofApproxArea", "netMeteringStatus", "installationTimeline",
      "budgetPkr", "preferredLanguage", "customerIntent", "existingCustomer",
      "commercialScale", "notes",
    ];

    for (const k of keys) {
      const field = qual[k] as QualificationField<unknown>;
      if (field && field.value !== null) {
        extractedFields[k] = {
          value: field.value,
          confidence: field.confidence,
          source: field.source,
        };
      }
    }

    const qualificationSummary = `Lead qualification score: ${score}/100. Intent: ${intentResult.intent} (${Math.round(intentResult.confidence * 100)}% conf). Language: ${language}. Missing fields: ${missingFields.length > 0 ? missingFields.join(", ") : "None"}.`;

    return {
      conversationId: qual.conversationId,
      qualificationSummary,
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      intentReason: intentResult.reason,
      language,
      score,
      missingFields,
      extractedFields,
      recommendedNextQuestion,
      humanReviewRequired,
      generatedAt: now,
    };
  }
}
