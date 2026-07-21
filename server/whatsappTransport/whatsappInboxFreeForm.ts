/**
 * Meta 24h free-form window helpers (Revision 3 / P0-3).
 * Pure functions — services inject "now" for deterministic tests.
 */
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";

export const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

export type FreeFormEligibility = {
  freeFormAllowed: boolean;
  windowExpiresAt: string | null;
  latestInboundAt: string | null;
  latestInboundMessageId: string | null;
};

export function inboundAnchorIso(message: InboxMessageRef): string {
  return message.occurredAt ?? message.createdAt;
}

export function computeFreeFormEligibility(
  latestInbound: InboxMessageRef | null,
  nowMs: number = Date.now()
): FreeFormEligibility {
  if (!latestInbound) {
    return {
      freeFormAllowed: false,
      windowExpiresAt: null,
      latestInboundAt: null,
      latestInboundMessageId: null,
    };
  }
  const anchorMs = Date.parse(inboundAnchorIso(latestInbound));
  if (!Number.isFinite(anchorMs)) {
    return {
      freeFormAllowed: false,
      windowExpiresAt: null,
      latestInboundAt: null,
      latestInboundMessageId: latestInbound.id,
    };
  }
  const expiresMs = anchorMs + FREE_FORM_WINDOW_MS;
  return {
    freeFormAllowed: nowMs < expiresMs,
    windowExpiresAt: new Date(expiresMs).toISOString(),
    latestInboundAt: new Date(anchorMs).toISOString(),
    latestInboundMessageId: latestInbound.id,
  };
}
