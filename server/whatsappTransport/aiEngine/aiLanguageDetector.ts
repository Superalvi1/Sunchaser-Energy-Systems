/**
 * Sunchaser Connect Phase 1B Sprint 2: Language Detector.
 * Detects English, Roman Urdu, Mixed, or Unknown language patterns deterministically.
 * Requires positive English evidence so unknown Latin strings return Unknown.
 */
import type { DetectedLanguage } from "./leadQualificationTypes.ts";

// Pure Roman Urdu grammatical markers, pronouns, and verbs (No duplicates, No English loanwords like "panel" or "bill")
const ROMAN_URDU_KEYWORDS = [
  "mai", "main", "mera", "meri", "mere", "mujhe", "chahiye", "kitna", "kitni", "kitne",
  "lagwana", "hai", "hein", "hain", "kya", "kaise", "kahan", "batao", "bataen", "shukriya",
  "bhai", "karwana", "bijli", "ghar", "lagna", "hoga", "hogay", "hogi", "apka", "apki",
  "walay", "wale", "wala", "ziyada", "zyada", "kam", "zaroorat", "zarurat", "hum", "agar",
];

// Positive English evidence keywords (Conversational & Domain English words)
const ENGLISH_EVIDENCE_KEYWORDS = [
  "need", "want", "for", "my", "the", "this", "that", "with", "please", "thank", "thanks",
  "hello", "hi", "hey", "dear", "sir", "madam", "good", "morning", "afternoon", "evening",
  "quote", "quotation", "price", "cost", "rate", "inquiry", "info", "information", "details",
  "house", "home", "office", "factory", "building", "roof", "address", "city", "location",
  "is", "are", "have", "has", "can", "will", "would", "could", "should", "you", "your", "we", "our",
  "solar", "system", "panel", "panels", "inverter", "inverters", "battery", "batteries",
  "commercial", "industrial", "residential", "metering", "grid", "capacity", "phase",
  "kw", "mw", "watt", "watts", "kilowatt", "megawatt", "backup", "installation", "setup",
  "warranty", "claim", "complaint", "support", "service", "maintenance", "repair", "cleaning"
];

export class AiLanguageDetector {
  detect(textBody: string | null | undefined): DetectedLanguage {
    if (!textBody || !textBody.trim()) {
      return "Unknown";
    }

    const text = textBody.slice(0, 10000);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "Unknown";
    }

    let urduCount = 0;
    let englishEvidenceCount = 0;

    for (const w of words) {
      if (ROMAN_URDU_KEYWORDS.includes(w)) urduCount++;
      if (ENGLISH_EVIDENCE_KEYWORDS.includes(w)) englishEvidenceCount++;
    }

    // Mixed is triggered only when there are BOTH distinct Roman Urdu words AND English evidence words
    if (urduCount > 0 && englishEvidenceCount > 0) {
      return "Mixed";
    }

    if (urduCount > 0) {
      return "Roman Urdu";
    }

    if (englishEvidenceCount > 0) {
      return "English";
    }

    return "Unknown";
  }
}
