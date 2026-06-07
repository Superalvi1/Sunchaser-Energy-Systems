import React, { useEffect } from "react";
import { createPortal } from "react-dom";

interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Classes for the centered panel (not the backdrop). */
  panelClassName?: string;
  /** Click backdrop to close. Default true. */
  closeOnBackdrop?: boolean;
}

export default function AppModal({
  open,
  onClose,
  children,
  panelClassName = "",
  closeOnBackdrop = true,
}: AppModalProps) {
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
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-hidden"
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
        className={`relative z-[1] w-full max-h-[90vh] overflow-y-auto ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
