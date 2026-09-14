/**
 * Official Capacitor Android hardware-Back wiring.
 *
 * Installing @capacitor/app is not enough by itself. AppPlugin.load()
 * registers an OnBackPressedCallback that:
 *   - with no JS "backButton" listeners: WebView.goBack() if the WebView
 *     can go back, otherwise the press is swallowed (the Activity does
 *     not finish)
 *   - with a JS listener: notifyListeners("backButton", { canGoBack })
 *
 * That is why this module registers one App.addListener("backButton") at
 * app boot (see main.tsx). Overlay components only push/pop overlayBackStack;
 * they do not add their own native listeners.
 *
 *   Android hardware Back
 *     → OnBackPressedDispatcher
 *     → AppPlugin OnBackPressedCallback
 *     → App.addListener("backButton")
 *     → handleHardwareBackButton()
 *     → dismissTopOverlay()  (if any overlay is open)
 *     → otherwise history.back() or App.exitApp()
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
