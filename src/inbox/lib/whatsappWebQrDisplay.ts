/**
 * Pure helpers for WhatsApp Web QR panel display + request ordering.
 * Keeps a usable QR/status visible during background polling and rejects
 * stale out-of-order responses.
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

export type WhatsAppWebRequestKind =
  | "initial"
  | "background"
  | "generate"
  | "disconnect"
  | "logout";

export type WhatsAppWebDisplaySnapshot = {
  status: WhatsAppWebSafeStatus | null;
  qr: WhatsAppWebQrPayload | null;
  hasLoadedOnce: boolean;
  error: string | null;
};

/**
 * Monotonic request gate: only the latest accepted generation may commit UI.
 * Background polls are single-flight; actions invalidate earlier polls.
 */
export type WhatsAppWebRequestGate = {
  begin: (kind: WhatsAppWebRequestKind) => {
    generation: number;
    accepted: boolean;
  };
  canCommit: (generation: number) => boolean;
  /** Call when a background request settles (success or failure). */
  endBackground: (generation: number) => { clearRefreshing: boolean };
  /** True while an accepted background refresh is still in flight. */
  isRefreshing: () => boolean;
  unmount: () => void;
  isMounted: () => boolean;
  /** Test seam */
  currentGeneration: () => number;
};

export function createWhatsAppWebRequestGate(): WhatsAppWebRequestGate {
  let generation = 0;
  let mounted = true;
  let backgroundInFlight = false;
  let activeBackgroundGeneration: number | null = null;

  return {
    begin(kind) {
      if (!mounted) {
        return { generation: -1, accepted: false };
      }

      if (kind === "background") {
        // Single-flight: do not start overlapping background polls.
        if (backgroundInFlight) {
          return { generation, accepted: false };
        }
        generation += 1;
        backgroundInFlight = true;
        activeBackgroundGeneration = generation;
        return { generation, accepted: true };
      }

      // initial / generate / disconnect / logout — invalidate earlier polls.
      generation += 1;
      return { generation, accepted: true };
    },

    canCommit(requestGeneration) {
      return mounted && requestGeneration === generation;
    },

    endBackground(requestGeneration) {
      if (activeBackgroundGeneration === requestGeneration) {
        backgroundInFlight = false;
        activeBackgroundGeneration = null;
      }
      return { clearRefreshing: mounted && !backgroundInFlight };
    },

    isRefreshing() {
      return mounted && backgroundInFlight;
    },

    unmount() {
      mounted = false;
      generation += 1;
      backgroundInFlight = false;
      activeBackgroundGeneration = null;
    },

    isMounted() {
      return mounted;
    },

    currentGeneration() {
      return generation;
    },
  };
}

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

/** True when incoming status is at least as new as the displayed one. */
export function isStatusAtLeastAsNew(
  previous: WhatsAppWebSafeStatus | null,
  next: WhatsAppWebSafeStatus
): boolean {
  if (!previous?.updatedAt) return true;
  const prevMs = Date.parse(previous.updatedAt);
  const nextMs = Date.parse(next.updatedAt);
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) {
    // Defer to request sequencing when timestamps are unusable.
    return true;
  }
  return nextMs >= prevMs;
}

/**
 * Replace displayed QR only when the incoming payload is proven newer
 * (expiresAt) or equally fresh with a different valid payload.
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

  const prevExp = Date.parse(previous.expiresAt);
  const nextExp = Date.parse(next.expiresAt);
  if (Number.isFinite(prevExp) && Number.isFinite(nextExp)) {
    if (nextExp < prevExp) return previous;
    if (nextExp > prevExp) return next;
    if (previous.qrDataUrl === next.qrDataUrl) return previous;
    return next;
  }

  // Unparseable expiry: keep previous unless identical (cannot prove newer).
  if (previous.qrDataUrl === next.qrDataUrl) return previous;
  return previous;
}

/**
 * Apply a successful status (+ optional QR) update to display state.
 * Older status.updatedAt snapshots are ignored entirely.
 */
export function applySuccessfulWebStatusPoll(
  previous: WhatsAppWebDisplaySnapshot,
  status: WhatsAppWebSafeStatus,
  fetchedQr: WhatsAppWebQrPayload | null | undefined
): WhatsAppWebDisplaySnapshot {
  if (!isStatusAtLeastAsNew(previous.status, status)) {
    return previous;
  }

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
