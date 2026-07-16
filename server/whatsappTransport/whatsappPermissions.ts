import { roleHasPermission } from "../../src/lib/roles.ts";
import type { RequestActor } from "../middleware/actor.ts";
import type { ConversationBundle } from "./whatsappRepository.ts";

export type OutboundAuthDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * PR-1 outbound send policy (fail closed):
 * - Customer always denied
 * - Unknown / unmapped roles denied
 * - Suspended/rejected accounts denied
 * - Only approved internal staff with crm_leads may send
 *   (Super Admin, Director, Admin, Accounts Manager, Sales Manager,
 *    Sales Executive, and Sales Advisor alias)
 *
 * Conversation recipient/sender/channel are never taken from the browser.
 * PR-1 is single-company; authorized staff may send on any existing conversation.
 */
export function canSendOutboundWhatsApp(actor: RequestActor | null | undefined): boolean {
  if (!actor) return false;
  const role = String(actor.role || "").trim();
  if (!role || role === "Customer") return false;
  const status = String(actor.accountStatus || "").trim();
  if (status && status !== "Approved") return false;
  return roleHasPermission(role, "crm_leads");
}

/**
 * Authorize an actor for outbound WhatsApp on a conversation.
 * Call after loading the conversation bundle (null → 404 for authorized staff).
 * Role denial returns 403 before revealing conversation details when possible —
 * callers should check canSendOutboundWhatsApp first for forbidden roles.
 */
export function authorizeOutboundWhatsAppActor(
  actor: RequestActor | null | undefined,
  conversation: ConversationBundle | null
): OutboundAuthDecision {
  if (!actor) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!canSendOutboundWhatsApp(actor)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (!conversation) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  return { ok: true };
}
