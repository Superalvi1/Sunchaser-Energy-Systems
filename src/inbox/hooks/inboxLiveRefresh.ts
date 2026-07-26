/**
 * Shared helpers for WHATSAPP-LIVE-01 presentation refresh.
 *
 * Incoming WhatsApp messages continue to persist on the backend even when no
 * CRM browser tab is open. These helpers only refresh the open CRM UI.
 *
 * SSE/fetch-stream push is intentionally deferred: authenticated EventSource
 * cannot put JWTs in URLs safely without a cookie-auth redesign. Reliable
 * 2-second polling is the LIVE-01 fallback.
 */

export const INBOX_LIVE_REFRESH_MS = 2_000;

/** True when the document is visible (or visibility API unavailable). */
export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/**
 * Subscribe to focus / visibility / online events that should trigger an
 * immediate CRM presentation refresh. Returns an unsubscribe function.
 */
export function subscribeImmediateRefresh(onRefresh: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onFocus = () => onRefresh();
  const onOnline = () => onRefresh();
  const onVisibility = () => {
    if (isDocumentVisible()) onRefresh();
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
