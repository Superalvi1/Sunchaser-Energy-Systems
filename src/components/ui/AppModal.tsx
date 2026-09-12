import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useHistoryBackClose } from "../../lib/useHistoryBackClose";

interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Classes for the centered panel (not the backdrop). */
  panelClassName?: string;
  /** Click backdrop to close. Default true. */
  closeOnBackdrop?: boolean;
  /**
   * Opt in to an edge-to-edge full-screen sheet below `md`, while keeping the
   * centred panel from `md` up. Off by default so every existing modal is
   * untouched. Used by large configurators that cannot fit a phone as a dialog.
   */
  mobileFullScreen?: boolean;
}

export default function AppModal({
  open,
  onClose,
  children,
  panelClassName = "",
  closeOnBackdrop = true,
  mobileFullScreen = false,
}: AppModalProps) {
  useHistoryBackClose(open, onClose);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-app-modal-overlay
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden ${
mobileFullScreen ? "p-0 md:p-4" : "p-4"}`}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
      }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] cursor-default border-0 p-0"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        className={`relative z-[1] w-full overflow-y-auto ${
mobileFullScreen ? "h-full max-h-none md:h-auto md:max-h-[90vh]" : "max-h-[90vh]"} ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
