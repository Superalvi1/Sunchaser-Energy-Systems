import { qrDataUri } from "./localQr.ts";
const STORAGE_PREFIX = "sunchaser_google_review_done_";

export function googleReviewStorageKey(customerId: string): string {
  return `${STORAGE_PREFIX}${customerId}`;
}

export function isGoogleReviewMarkedComplete(customerId: string | undefined | null): boolean {
  if (!customerId || typeof localStorage === "undefined") return false;
  return localStorage.getItem(googleReviewStorageKey(customerId)) === "1";
}

export function markGoogleReviewComplete(customerId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(googleReviewStorageKey(customerId), "1");
}

export function googleReviewQrImageUrl(reviewUrl: string, size = 180): string {
  return qrDataUri(reviewUrl, size); // generated locally; the link is not sent to any QR service
}
