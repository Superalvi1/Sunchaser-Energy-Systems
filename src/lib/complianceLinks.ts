/**
 * Google Play compliance pages.
 *
 * These are public, no-login pages served as static files from `public/` (Vercel
 * resolves the filesystem before the catch-all rewrite in vercel.json, so they win
 * over the SPA shell). They are also the URLs registered in the Play Console.
 *
 * Always link to the hosted pages rather than a bundled copy: the live pages stay
 * current when the policy text is updated, without shipping a new APK.
 *
 * Opened with `target="_blank" rel="noopener noreferrer"` — the same external-link
 * mechanism the portal already uses for WhatsApp and Google review links. In the
 * Capacitor Android shell the WebView origin is `https://localhost`, so a different
 * host is handed to the system browser by Capacitor's default navigation handling.
 * No native plugin is involved.
 */

export const PRIVACY_POLICY_URL = "https://crm.sunchaserenergy.co/privacy-policy";

export const ACCOUNT_DELETION_URL = "https://crm.sunchaserenergy.co/account-deletion";

/** Props shared by every outbound compliance link. */
export const EXTERNAL_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
