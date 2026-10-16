import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 verification for the signed CRM relay (X-Relay-Signature-256). */
export function verifyRelaySignature(raw, header, secret) {
  if (!secret || typeof header !== "string") return false;
  const digest = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(header, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Validate a normalized CRM relay event. The CRM only relays freshly recorded
 * inbound text; the worker still validates shape defensively.
 */
export function validRelayEvent(m) {
  return Boolean(
    m &&
    typeof m.conversationId === "string" &&
    m.conversationId.length > 0 &&
    typeof m.messageId === "string" &&
    /^wamid\./.test(m.messageId) &&
    typeof m.phone === "string" &&
    /^\d{8,15}$/.test(m.phone) &&
    typeof m.phoneNumberId === "string" &&
    /^\d+$/.test(m.phoneNumberId) &&
    (m.type === "text" || m.type === "interactive") &&
    Number.isFinite(m.sentAt) &&
    m.sentAt <= Date.now() + 300000
  );
}
