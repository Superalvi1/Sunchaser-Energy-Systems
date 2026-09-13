/**
 * Official Capacitor Android hardware-Back wiring.
 *
 * Stock Capacitor 8 BridgeActivity does NOT guarantee that hardware Back
 * becomes history.back(). The proven hook is @capacitor/app:
 *
 *   Android hardware Back
 *     → BridgeActivity / OnBackPressedCallback
 *     → App.addListener("backButton")
 *     → handleHardwareBackButton()
 *     → dismissTopOverlay()  (if any overlay is open)
 *     → otherwise history.back() or App.exitApp()
 *
 * One listener for the whole app. Overlays register on overlayBackStack;
 * they do not each add a native listener.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { dismissTopOverlay } from "./overlayBackStack";

export type BackButtonEvent = { canGoBack: boolean };

export type NativeAppLike = {
  addListener: (
    eventName: "backButton",
    listener: (event: BackButtonEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
  exitApp: () => Promise<void> | void;
};

let injectedApp: NativeAppLike | null = null;
let started = false;
let handle: { remove: () => Promise<void> } | null = null;
let addListenerCalls = 0;
let exitAppCalls = 0;

export function setNativeAppForTests(impl: NativeAppLike | null): void {
  injectedApp = impl;
  started = false;
  handle = null;
  addListenerCalls = 0;
  exitAppCalls = 0;
}

export function nativeBackListenerCountForTests(): number {
  return addListenerCalls;
}

export function nativeExitAppCallsForTests(): number {
  return exitAppCalls;
}

function resolveApp(): NativeAppLike | null {
  if (injectedApp) return injectedApp;
  if (typeof window === "undefined") return null;
  if (!Capacitor.isNativePlatform()) return null;
  return App;
}

/**
 * Hardware Back entry point. Overlay dismiss is always onClose of the top
 * layer — never apply a draft, save a quote, send a customer message, or start a catalog job.
 */
export function handleHardwareBackButton(event: BackButtonEvent): "overlay" | "history" | "exit" {
  if (dismissTopOverlay()) return "overlay";
  if (event.canGoBack && typeof window !== "undefined") {
    window.history.back();
    return "history";
  }
  const app = resolveApp();
  exitAppCalls += 1;
  void app?.exitApp();
  return "exit";
}

export async function ensureNativeBackListener(): Promise<void> {
  if (started) return;
  const app = resolveApp();
  if (!app) return;
  started = true;
  addListenerCalls += 1;
  handle = await app.addListener("backButton", (event) => {
    handleHardwareBackButton(event);
  });
}

export async function stopNativeBackListenerForTests(): Promise<void> {
  if (handle) {
    await handle.remove();
  }
  handle = null;
  started = false;
}
