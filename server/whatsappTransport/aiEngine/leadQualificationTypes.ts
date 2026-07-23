/**
 * Sunchaser Connect Phase 1B Sprint 2: Lead Qualification V1 Data Models.
 * Defines versioned lead qualification model with field provenance tracking.
 */

export type FieldSource = "AI" | "HUMAN" | "SYSTEM" | "IMPORTED";

export type QualificationField<T> = {
  value: T | null;
  confidence: number; // 0.0 to 1.0
  source: FieldSource;
  lastUpdated: string;
};

export type LeadIntent =
  | "ResidentialSolar"
  | "CommercialSolar"
  | "IndustrialSolar"
  | "BatteryUpgrade"
  | "NetMetering"
  | "Support"
  | "Warranty"
  | "Complaint"
  | "GeneralInquiry"
  | "ExistingCustomer"
  | "Unknown";

export type DetectedLanguage = "English" | "Roman Urdu" | "Mixed" | "Unknown";

export type LeadQualificationV1 = {
  version: "V1";
  conversationId: string;
  customerName: QualificationField<string>;
  phoneNumber: QualificationField<string>;
  city: QualificationField<string>;
  propertyType: QualificationField<string>;
  propertyOwnership: QualificationField<string>;
  monthlyBillPkr: QualificationField<number>;
  electricPhase: QualificationField<string>;
  backupRequired: QualificationField<boolean>;
  batteryPreference: QualificationField<string>;
  roofType: QualificationField<string>;
  roofApproxArea: QualificationField<number>;
  netMeteringStatus: QualificationField<string>;
  installationTimeline: QualificationField<string>;
  budgetPkr: QualificationField<number>;
  preferredLanguage: QualificationField<DetectedLanguage>;
  customerIntent: QualificationField<LeadIntent>;
  existingCustomer: QualificationField<boolean>;
  commercialScale: QualificationField<string>;
  notes: QualificationField<string>;
  updatedAt: string;
};

export type FieldAuditMeta = {
  confidence: number;
  source: FieldSource;
  present: boolean;
};

export type ShadowQualificationReport = {
  conversationId: string;
  qualificationSummary: string;
  intent: LeadIntent;
  intentConfidence: number;
  intentReason: string;
  language: DetectedLanguage;
  score: number; // Max 100
  missingFields: string[];
  extractedFields: Record<string, FieldAuditMeta>;
  recommendedNextQuestion: string | null;
  humanReviewRequired: boolean;
  generatedAt: string;
};

/**
 * Clamps confidence score to valid range [0.0, 1.0].
 * Rejects NaN, Infinity, -Infinity and non-numbers by falling back to 0.0.
 */
export function clampConfidence(val: unknown): number {
  if (typeof val !== "number" || Number.isNaN(val) || !Number.isFinite(val)) {
    return 0.0;
  }
  if (val < 0.0) return 0.0;
  if (val > 1.0) return 1.0;
  return val;
}
