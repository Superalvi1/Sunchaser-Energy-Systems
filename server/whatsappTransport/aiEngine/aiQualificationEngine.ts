/**
 * Sunchaser Connect Phase 1B Sprint 2: AI Lead Qualification Engine.
 * Implements Strict Field Immutability, Privacy-Safe Shadow Reports, and Dependency Injection.
 * AI MUST remain in AI_SHADOW mode. Zero outbound WhatsApp, Zero CRM mutations.
 */
import {
  clampConfidence,
  type FieldAuditMeta,
  type FieldSource,
  type LeadQualificationV1,
  type QualificationField,
  type ShadowQualificationReport,
} from "./leadQualificationTypes.ts";
import { AiIntentClassifier } from "./aiIntentClassifier.ts";
import { AiLanguageDetector } from "./aiLanguageDetector.ts";
import { AiMissingFieldEngine } from "./aiMissingFieldEngine.ts";
import { AiNextQuestionEngine } from "./aiNextQuestionEngine.ts";
import { AiQualificationScorer } from "./aiQualificationScorer.ts";

function createEmptyField<T>(
  initialValue: T | null = null,
  source: FieldSource = "AI"
): QualificationField<T> {
  const now = new Date().toISOString();
  return {
    value: initialValue,
    confidence: initialValue !== null ? 1.0 : 0.0,
    source,
    lastUpdated: now,
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
    customerName: createEmptyField(customerName ?? null, customerName ? "IMPORTED" : "AI"),
    phoneNumber: createEmptyField(phoneNumber ?? null, phoneNumber ? "IMPORTED" : "AI"),
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
    preferredLanguage: createEmptyField("Unknown", "AI"),
    customerIntent: createEmptyField("Unknown", "AI"),
    existingCustomer: createEmptyField(false, "AI"),
    commercialScale: createEmptyField(),
    notes: createEmptyField(),
    updatedAt: now,
  };
}

export type AiQualificationEngineOptions = {
  intentClassifier?: AiIntentClassifier;
  languageDetector?: AiLanguageDetector;
  qualificationScorer?: AiQualificationScorer;
  missingFieldEngine?: AiMissingFieldEngine;
  nextQuestionEngine?: AiNextQuestionEngine;
};

export class AiQualificationEngine {
  private readonly intentClassifier: AiIntentClassifier;
  private readonly languageDetector: AiLanguageDetector;
  private readonly qualificationScorer: AiQualificationScorer;
  private readonly missingFieldEngine: AiMissingFieldEngine;
  private readonly nextQuestionEngine: AiNextQuestionEngine;

  constructor(options: AiQualificationEngineOptions = {}) {
    this.intentClassifier = options.intentClassifier ?? new AiIntentClassifier();
    this.languageDetector = options.languageDetector ?? new AiLanguageDetector();
    this.qualificationScorer = options.qualificationScorer ?? new AiQualificationScorer();
    this.missingFieldEngine = options.missingFieldEngine ?? new AiMissingFieldEngine();
    this.nextQuestionEngine = options.nextQuestionEngine ?? new AiNextQuestionEngine();
  }

  /**
   * Applies Strict Field Immutability rules:
   * AI may ONLY update fields where existing.source == "AI".
   * If existing.source is HUMAN, SYSTEM, or IMPORTED, AI MUST NEVER overwrite
   * even when existing.value is null.
   * Human edits always win. System values are immutable. Imported values are immutable.
   */
  mergeField<T>(
    existing: QualificationField<T>,
    incoming: { value: T | null; confidence: number; source: FieldSource }
  ): QualificationField<T> {
    const now = new Date().toISOString();
    const clampedConf = clampConfidence(incoming.confidence);

    // Strict Immutability Rule: If incoming source is AI, AI may ONLY update fields where existing.source === "AI"
    if (incoming.source === "AI" && existing.source !== "AI") {
      return existing; // NEVER overwrite HUMAN, SYSTEM, or IMPORTED
    }

    // Do not overwrite valid existing value with null/undefined incoming value
    if (incoming.value === null || incoming.value === undefined) {
      return existing;
    }

    return {
      value: incoming.value,
      confidence: clampedConf,
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

    // 7. Privacy-safe extractedFields metadata map (NO PII / NO raw values stored!)
    const extractedFields: Record<string, FieldAuditMeta> = {};
    const keys: (keyof LeadQualificationV1)[] = [
      "customerName", "phoneNumber", "city", "propertyType", "propertyOwnership",
      "monthlyBillPkr", "electricPhase", "backupRequired", "batteryPreference",
      "roofType", "roofApproxArea", "netMeteringStatus", "installationTimeline",
      "budgetPkr", "preferredLanguage", "customerIntent", "existingCustomer",
      "commercialScale", "notes",
    ];

    for (const k of keys) {
      const field = qual[k] as QualificationField<unknown>;
      if (field) {
        const isPresent = field.value !== null && field.value !== undefined && field.value !== "";
        extractedFields[k] = {
          confidence: clampConfidence(field.confidence),
          source: field.source,
          present: isPresent,
        };
      }
    }

    // Qualification Summary (NO PII: no names, no phone numbers, no budgets, no bills, no notes)
    const qualificationSummary = `Lead qualification score: ${score}/100. Intent: ${intentResult.intent} (${Math.round(clampConfidence(intentResult.confidence) * 100)}% conf). Language: ${language}. Missing fields: ${missingFields.length > 0 ? missingFields.join(", ") : "None"}.`;

    return {
      conversationId: qual.conversationId,
      qualificationSummary,
      intent: intentResult.intent,
      intentConfidence: clampConfidence(intentResult.confidence),
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
