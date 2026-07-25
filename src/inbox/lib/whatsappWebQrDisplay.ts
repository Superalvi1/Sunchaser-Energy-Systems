/**
 * Pure helpers for WhatsApp Web QR panel display.
 * Keeps a usable QR/status visible during background polling.
 */
import type {
  WhatsAppWebQrPayload,
  WhatsAppWebSafeStatus,
} from "../api/inboxApi";

/** States where the backend has cleared / invalidated any QR. */
const QR_CLEARING_STATES = new Set<WhatsAppWebSafeStatus["state"]>([
  "CONNECTED",
  "DISCONNECTED",
  "LOGGED_OUT",
  "ERROR",
]);

export function shouldShowInitialWebLoading(
  hasLoadedOnce: boolean,
  isInitialRequestInFlight: boolean
): boolean {
  return !hasLoadedOnce && isInitialRequestInFlight;
}

/**
 * Clear displayed QR only when authoritative backend state requires it.
 * Poll failures must not call this path.
 */
export function shouldClearDisplayedQr(
  status: Pick<WhatsAppWebSafeStatus, "state" | "qrAvailable">
): boolean {
  if (QR_CLEARING_STATES.has(status.state)) return true;
  return status.qrAvailable === false;
}

/**
 * Replace displayed QR only when a newer valid QR payload arrives.
 * Missing/invalid next keeps the previous QR (caller clears separately).
 */
export function mergeDisplayedQr(
  previous: WhatsAppWebQrPayload | null,
  next: WhatsAppWebQrPayload | null | undefined
): WhatsAppWebQrPayload | null {
  if (!next?.qrDataUrl || !String(next.qrDataUrl).trim()) {
    return previous;
  }
  if (!previous?.qrDataUrl) return next;
  if (previous.qrDataUrl !== next.qrDataUrl) return next;
  if (previous.expiresAt !== next.expiresAt) return next;
  return previous;
}

export type WhatsAppWebDisplaySnapshot = {
  status: WhatsAppWebSafeStatus | null;
  qr: WhatsAppWebQrPayload | null;
  hasLoadedOnce: boolean;
  error: string | null;
};

/**
 * Apply a successful status (+ optional QR) poll to display state.
 */
export function applySuccessfulWebStatusPoll(
  previous: WhatsAppWebDisplaySnapshot,
  status: WhatsAppWebSafeStatus,
  fetchedQr: WhatsAppWebQrPayload | null | undefined
): WhatsAppWebDisplaySnapshot {
  if (shouldClearDisplayedQr(status)) {
    return {
      status,
      qr: null,
      hasLoadedOnce: true,
      error: null,
    };
  }
  return {
    status,
    qr: mergeDisplayedQr(previous.qr, fetchedQr ?? null),
    hasLoadedOnce: true,
    error: null,
  };
}

/**
 * Poll/network failure: preserve last usable status + QR; surface safe error.
 */
export function applyFailedWebStatusPoll(
  previous: WhatsAppWebDisplaySnapshot,
  safeErrorMessage: string
): WhatsAppWebDisplaySnapshot {
  return {
    ...previous,
    error: safeErrorMessage,
  };
}
