import { Capacitor } from "@capacitor/core";

/**
 * Opt iOS alone into an edge-to-edge viewport.
 *
 * WKWebView already lays the app out behind the Dynamic Island / status bar, but
 * `env(safe-area-inset-*)` only resolves to real values once the viewport declares
 * `viewport-fit=cover`. Without it the `.safe-area-top` padding computes to 0 and the
 * header sits under the island.
 *
 * This is deliberately NOT applied in index.html. Android targets SDK 35, where
 * `viewport-fit=cover` also opts the app into edge-to-edge at the *bottom*, pushing
 * page content behind the gesture navigation bar and repainting the status bar strip
 * — a visible change to a shipping app. Android and the web therefore keep the
 * default inset viewport and are completely unaffected by this module.
 *
 * Platform check only — no device-model detection, no hardcoded pixel values.
 */
export function applyIosViewportFit(): void {
  try {
    if (Capacitor.getPlatform() !== "ios") return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const content = meta.getAttribute("content") || "";
    if (content.includes("viewport-fit")) return;
    meta.setAttribute("content", `${content}, viewport-fit=cover`);
  } catch {
    /* non-fatal: without this the app just keeps the default inset viewport */
  }
}
