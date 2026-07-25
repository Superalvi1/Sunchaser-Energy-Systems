/**
 * WhatsApp Web QR Admin authorization helpers.
 * Pure functions — use JWT-hydrated RequestActor only (never request body/headers).
 */
import type { RequestActor } from "../middleware/actor.ts";
import { isApprovedStaff } from "../whatsappTransport/whatsappInboxPermissions.ts";

/** Roles allowed to manage WhatsApp Web QR (in addition to Approved status). */
export const WHATSAPP_WEB_ADMIN_ROLES = new Set(["Super Admin", "Admin"]);

export function isWhatsAppWebAdminRole(role: string | null | undefined): boolean {
  return WHATSAPP_WEB_ADMIN_ROLES.has(String(role || "").trim());
}

/**
 * Only Approved Admin / Approved Super Admin may manage WhatsApp Web QR.
 * accountStatus must be exactly "Approved" (same policy family as Inbox).
 */
export function canManageWhatsAppWebQr(
  actor: RequestActor | null | undefined
): boolean {
  if (!actor) return false;
  if (!isApprovedStaff(actor)) return false;
  return isWhatsAppWebAdminRole(actor.role);
}
