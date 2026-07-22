/**
 * Sunchaser Connect Phase 1B Sprint 2: Language Detector.
 * Detects English, Roman Urdu, Mixed, or Unknown language patterns deterministically.
 */
import type { DetectedLanguage } from "./leadQualificationTypes.ts";

const ROMAN_URDU_KEYWORDS = [
  "mai", "main", "mera", "meri", "chahiye", "kitna", "kitni", "kitne", "lagwana",
  "hai", "hein", "kya", "kaise", "kahan", "batao", "bataen", "shukriya", "bhai",
  "bataen", "karwana", "panel", "bijli", "bill", "ghar", "lagna", "hoga", "apka",
];

const ENGLISH_KEYWORDS = [
  "solar", "system", "quotation", "price", "cost", "kw", "inverter", "panel",
  "commercial", "industrial", "residential", "roof", "battery", "metering", "support",
];

export class AiLanguageDetector {
  detect(textBody: string | null | undefined): DetectedLanguage {
    if (!textBody || !textBody.trim()) {
      return "Unknown";
    }

    const words = textBody
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "Unknown";
    }

    let urduCount = 0;
    let englishCount = 0;

    for (const w of words) {
      if (ROMAN_URDU_KEYWORDS.includes(w)) urduCount++;
      if (ENGLISH_KEYWORDS.includes(w)) englishCount++;
    }

    if (urduCount > 0 && englishCount > 0) {
      return "Mixed";
    }

    if (urduCount > 0) {
      return "Roman Urdu";
    }

    if (
      englishCount > 0 ||
      (/[a-zA-Z]/.test(textBody) && /^[a-zA-Z0-9\s.,?!]+$/.test(textBody))
    ) {
      return "English";
    }

    return "Unknown";
  }
}
