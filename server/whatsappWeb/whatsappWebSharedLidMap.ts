/**
 * Process-local shared LID→phone map for WhatsApp Web.
 *
 * Shared by Baileys contact/chat/history ingestion and live inbound persist
 * so @lid notify events can resolve phones learned earlier in-session.
 * No durable/DB mapping — emergency hotfix only.
 */
import { WhatsAppLidPhoneMap } from "./whatsappWebIdentity.ts";

let sharedLidPhoneMap: WhatsAppLidPhoneMap | null = null;

/** Process-wide in-memory map used by sync source + inbound persist. */
export function getSharedWhatsAppLidPhoneMap(): WhatsAppLidPhoneMap {
  if (!sharedLidPhoneMap) {
    sharedLidPhoneMap = new WhatsAppLidPhoneMap();
  }
  return sharedLidPhoneMap;
}

/** Test-only reset of the process singleton. */
export function __resetSharedWhatsAppLidPhoneMap(): void {
  sharedLidPhoneMap = null;
}
