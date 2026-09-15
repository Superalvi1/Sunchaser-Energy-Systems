import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { ensureNativeBackListener } from "./nativeBackButton";
import { popOverlay, pushOverlay } from "./overlayBackStack";

/**
 * Register an open overlay on the shared Android hardware-Back stack.
 *
 * Native (Capacitor Android): hardware Back is handled once by
 * @capacitor/app in nativeBackButton.ts. This hook only pushes/pops the
 * stack — it does not add another native listener.
 *
 * Browser / PWA: do not mutate browser history for transient nested UI.
 * A child picker closing must never issue history.back(), because that can
 * also dismiss its parent quotation modal during an ordinary product tap.
 */
export function useOverlayBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
      void ensureNativeBackListener();
    }
  }, []);

  useEffect(() => {
    if (!open || typeof window === "undefined" || !Capacitor.isNativePlatform()) return;

    const id = pushOverlay(() => onCloseRef.current());
    return () => popOverlay(id);
  }, [open]);
}
