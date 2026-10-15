/** Select the CRM backend explicitly for native Capacitor WebViews.
 * On Android Capacitor's web origin is https://localhost, so relative /api is local,
 * not the deployed CRM backend. Do not trust the WebView hostname for native API routing.
 */
export const NATIVE_CRM_API_ORIGIN = "https://crm.sunchaserenergy.co";
const LEGACY_RENDER_API_ORIGIN = "https://sunchaser-energy-systems.onrender.com";
export function resolveCrmApiBaseUrl(
  hostname: string | undefined,
  configuredBaseUrl: string | undefined,
  nativeApp: boolean
): string {
  const fromEnv = String(configuredBaseUrl || "").trim().replace(/\/+$/, "");
  if (nativeApp) return fromEnv || NATIVE_CRM_API_ORIGIN;
  if (hostname && ["crm.sunchaserenergy.co", "smartquote.sunchaserenergy.co"].includes(hostname)) return "";
  if (fromEnv) return fromEnv;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "";
  return LEGACY_RENDER_API_ORIGIN; // Preserve behavior for non-native, non-primary web domains.
}
