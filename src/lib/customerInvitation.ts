/** Client-side portal URL — never hardcode localhost in production builds when env is set. */
export function getCustomerPortalUrl(): string {
  const fromEnv =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_URL) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_PUBLIC_URL) ||
    "";
  const base = String(fromEnv || (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/$/,
    ""
  );
  return `${base}/`;
}

export function buildPortalInvitationMessage(customerName: string, customerCode: string): string {
  const portalUrl = getCustomerPortalUrl();
  return `Hello ${customerName}

Welcome to Sunchaser Energy Systems.

Your Customer Portal Code:

${customerCode}

Register here:
${portalUrl}

Enter this code during registration to connect your portal account with your quotation, invoices, warranties, and project updates.

Thank you.`;
}

export function buildWhatsAppInvitationUrl(phone: string, message: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const encoded = encodeURIComponent(message);
  if (!digits) return `https://wa.me/?text=${encoded}`;
  return `https://wa.me/${digits}?text=${encoded}`;
}
