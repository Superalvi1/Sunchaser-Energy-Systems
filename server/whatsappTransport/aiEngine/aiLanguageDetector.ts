/**
 * Sunchaser Connect Phase 1B Sprint 2: Language Detector.
 * Detects English, Roman Urdu, Mixed, or Unknown language patterns deterministically.
 */
import type { DetectedLanguage } from "./leadQualificationTypes.ts";

// Pure Roman Urdu grammatical markers, pronouns, and verbs (No duplicates, No English loanwords like "panel" or "bill")
const ROMAN_URDU_KEYWORDS = [
  "mai", "main", "mera", "meri", "mere", "mujhe", "chahiye", "kitna", "kitni", "kitne",
  "lagwana", "hai", "hein", "hain", "kya", "kaise", "kahan", "batao", "bataen", "shukriya",
  "bhai", "karwana", "bijli", "ghar", "lagna", "hoga", "hogay", "hogi", "apka", "apki",
  "walay", "wale", "wala", "ziyada", "zyada", "kam", "zaroorat", "zarurat", "hum", "agar",
];

// Distinct conversational English words (used to detect genuine English phrasing vs technical loanwords in Urdu)
const ENGLISH_CONVERSATIONAL_KEYWORDS = [
  "need", "want", "for", "my", "the", "with", "please", "thank", "thanks", "quotation",
  "price", "cost", "commercial", "industrial", "residential", "support", "installation",
  "quote", "inquiry", "house", "home", "office", "factory",
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
    let englishConversationalCount = 0;

    for (const w of words) {
      if (ROMAN_URDU_KEYWORDS.includes(w)) urduCount++;
      if (ENGLISH_CONVERSATIONAL_KEYWORDS.includes(w)) englishConversationalCount++;
    }

    // Mixed is triggered only when there are BOTH distinct Roman Urdu words AND distinct English conversational words
    if (urduCount > 0 && englishConversationalCount > 0) {
      return "Mixed";
    }

    if (urduCount > 0) {
      return "Roman Urdu";
    }

    if (
      englishConversationalCount > 0 ||
      (/[a-zA-Z]/.test(text) && /^[a-zA-Z0-9\s.,?!'"()-]+$/.test(text))
    ) {
      return "English";
    }

    return "Unknown";
  }
}
