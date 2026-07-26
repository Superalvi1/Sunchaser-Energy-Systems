/**
 * Deterministic customer-query intent classifier.
 * Rules-based; LLM does not control routing.
 * Token matching avoids substring false positives (e.g. "hi" in "this").
 */

import type { QueryIntent } from "./queryAgentTypes.ts";

export type QueryIntentClassification = {
  intent: QueryIntent;
  confidence: number;
  reason: string;
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase())
  );
}

export class QueryIntentClassifier {
  classify(textBody: string | null | undefined): QueryIntentClassification {
    if (!textBody || !String(textBody).trim()) {
      return {
        intent: "unsupported_high_risk",
        confidence: clampConfidence(0.1),
        reason: "Empty or null message text",
      };
    }

    const truncated = String(textBody).slice(0, 10_000);
    const text = truncated.toLowerCase().trim();
    const tokens = tokenize(text);
    const hasToken = (...kw: string[]) => kw.some((k) => tokens.has(k.toLowerCase()));
    const hasPhrase = (...ph: string[]) => ph.some((p) => text.includes(p.toLowerCase()));

    // High-risk / medical / legal / dangerous — escalate path
    if (
      hasToken("suicide", "kill", "bomb", "weapon", "poison") ||
      hasPhrase("self harm", "end my life", "how to die") ||
      hasToken("lawyer", "lawsuit", "sue", "court", "legal") ||
      hasPhrase("medical advice", "heart attack", "chest pain") ||
      hasToken("illegal", "bribe", "forgery")
    ) {
      return {
        intent: "unsupported_high_risk",
        confidence: clampConfidence(0.98),
        reason: "Matched legal, medical, or dangerous keywords",
      };
    }

    // Explicit human request
    if (
      hasToken("agent", "human", "manager", "representative") ||
      hasPhrase("speak to", "talk to someone", "real person", "call me")
    ) {
      return {
        intent: "human_request",
        confidence: clampConfidence(0.96),
        reason: "Customer requested a human agent",
      };
    }

    // Complaint / angry
    if (
      hasToken("complaint", "fraud", "scam", "cheat", "worst", "angry", "furious") ||
      hasPhrase("not working", "bad service", "waste of money", "file complaint")
    ) {
      return {
        intent: "complaint",
        confidence: clampConfidence(0.94),
        reason: "Matched complaint or anger keywords",
      };
    }

    // Billing / payment
    if (
      hasToken("invoice", "payment", "billing", "receipt", "refund", "overdue") ||
      hasPhrase("pay bill", "bank transfer", "advance payment")
    ) {
      return {
        intent: "billing_payment",
        confidence: clampConfidence(0.9),
        reason: "Matched billing or payment keywords",
      };
    }

    // After-sales / warranty / service
    if (
      hasToken("warranty", "maintenance", "repair", "service", "cleaning", "aftersales") ||
      hasPhrase("after sales", "already installed", "my system")
    ) {
      return {
        intent: "after_sales",
        confidence: clampConfidence(0.88),
        reason: "Matched after-sales or warranty keywords",
      };
    }

    // Net metering
    if (
      hasToken("netmetering", "lesco", "mepco", "kelectric") ||
      hasPhrase("net metering", "green meter", "grid export", "bi directional")
    ) {
      return {
        intent: "net_metering",
        confidence: clampConfidence(0.92),
        reason: "Matched net metering keywords",
      };
    }

    // Quotation request
    if (
      hasToken("quote", "quotation", "estimate", "proposal", "boq") ||
      hasPhrase("send quote", "price list", "how much for")
    ) {
      return {
        intent: "quotation_request",
        confidence: clampConfidence(0.9),
        reason: "Matched quotation request keywords",
      };
    }

    // System selection
    if (
      hasToken("ongrid", "hybrid", "offgrid", "5kw", "10kw", "15kw", "battery") ||
      hasPhrase("on grid", "off grid", "system size", "which system", "select system")
    ) {
      return {
        intent: "system_selection",
        confidence: clampConfidence(0.88),
        reason: "Matched system selection keywords",
      };
    }

    // Product question (before technical so brand/model queries do not fall through on "panel")
    if (
      hasToken("product", "brand", "model", "longi", "jinko", "canadian", "growatt", "huawei") ||
      hasPhrase("which panel", "which inverter", "product details")
    ) {
      return {
        intent: "product_question",
        confidence: clampConfidence(0.85),
        reason: "Matched product keywords",
      };
    }

    // Technical question
    if (
      hasToken("inverter", "panel", "voltage", "amperage", "mppt", "earthing", "cable") ||
      hasPhrase("technical", "wiring", "string size", "how does")
    ) {
      return {
        intent: "technical_question",
        confidence: clampConfidence(0.86),
        reason: "Matched technical keywords",
      };
    }

    // Greeting
    if (hasToken("hi", "hello", "assalam", "aoa", "salam", "hey") || hasPhrase("good morning", "good evening")) {
      return {
        intent: "greeting",
        confidence: clampConfidence(0.9),
        reason: "Matched greeting tokens",
      };
    }

    // Sales / general solar interest
    if (hasToken("solar", "price", "rate", "cost", "package", "interested", "buy")) {
      return {
        intent: "sales",
        confidence: clampConfidence(0.8),
        reason: "Matched general sales/solar inquiry tokens",
      };
    }

    return {
      intent: "unsupported_high_risk",
      confidence: clampConfidence(0.35),
      reason: "No supported intent keywords matched — treat as unsupported",
    };
  }
}
