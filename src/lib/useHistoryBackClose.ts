import { useEffect, useRef } from "react";

let overlaySeq = 0;

/**
 * Capacitor WebView maps the Android hardware Back button to history.back().
 * There is no @capacitor/app plugin in this repo, so overlays must own a
 * history entry instead of a native listener.
 *
 * Each open overlay pushes one entry. Back pops the top overlay only
 * (catalog sheet inside AI Quote Builder first). Close/unmount pops the
 * extra entry without applying anything — callers still decide that.
 */
export function useHistoryBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const id = ++overlaySeq;
    window.history.pushState({ __sunchaserOverlayId: id }, "");

    const onPopState = () => {
      const current = window.history.state && window.history.state.__sunchaserOverlayId;
      if (current !== id) {
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      const current = window.history.state && window.history.state.__sunchaserOverlayId;
      if (current === id) {
        window.history.back();
      }
    };
  }, [open]);
}
