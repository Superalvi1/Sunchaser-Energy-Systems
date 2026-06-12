/** QR + public verification URL helpers for delivery challans */

export function appPublicBase(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return (
    process.env.APP_PUBLIC_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.API_BASE_URL ||
    ""
  ).replace(/\/$/, "");
}

export function buildDeliveryVerificationPath(token: string): string {
  return `/delivery/verify/${encodeURIComponent(token)}`;
}

export function buildDeliveryVerificationUrl(token: string, base?: string): string {
  const origin = (base || appPublicBase()).replace(/\/$/, "");
  const path = buildDeliveryVerificationPath(token);
  return origin ? `${origin}${path}` : path;
}

export function qrCodeImageUrl(targetUrl: string, size = 180): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(targetUrl)}`;
}
