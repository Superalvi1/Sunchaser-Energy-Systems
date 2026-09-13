import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { ensureNativeBackListener } from "./nativeBackButton";
import { hasOverlay, popOverlay, pushOverlay } from "./overlayBackStack";

/**
 * Register an open overlay on the shared back stack.
 *
 * Native (Capacitor Android): hardware Back is handled once by
 * @capacitor/app in nativeBackButton.ts. This hook only pushes/pops the
 * stack — it does not add another native listener.
 *
 * Browser / PWA: there is no hardware Back. Browser Back is modelled with
 * one history entry per overlay, kept separate from the native path so a
 * WebView history assumption is never used to claim Android Back is fixed.
 */
export function useOverlayBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    void ensureNativeBackListener();
  }, []);

  useEffect(() => {
    if (!open) return;

    const id = pushOverlay(() => onCloseRef.current());
    const native = typeof window !== "undefined" && Capacitor.isNativePlatform();

    if (native) {
      return () => popOverlay(id);
    }

    if (typeof window === "undefined") {
      return () => popOverlay(id);
    }

    window.history.pushState({ __sunchaserOverlayId: id }, "");
    const onPopState = () => {
      if (hasOverlay(id)) {
        popOverlay(id);
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      const stillOurs =
        hasOverlay(id) && window.history.state && window.history.state.__sunchaserOverlayId === id;
      popOverlay(id);
      if (stillOurs) window.history.back();
    };
  }, [open]);
}
