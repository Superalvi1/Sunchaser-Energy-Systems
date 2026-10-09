/** The staff-issued link token from `?link=` on the public Smart Quote URL, if any. The page works without it. */
export function readSmartQuoteLinkToken(search: string | undefined = typeof window !== "undefined" ? window.location.search : ""): string | null {
  try {
    const value = new URLSearchParams(search || "").get("link")?.trim();
    return value && value.length <= 1024 && /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function publicSmartQuoteHeaders(quoteNumber: string, linkToken: string | null, portalToken: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": `smart-quote:${quoteNumber}`,
    // Only a staff-issued link (or the logged-in portal customer's own session) can add to an existing client's record.
    ...(linkToken ? { "X-Smart-Quote-Link": linkToken } : {}),
    ...(portalToken ? { Authorization: `Bearer ${portalToken}` } : {}),
  };
}
