import React, { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AppModal from "./AppModal";

/**
 * Shared mobile disclosure primitives.
 *
 * Mobile CRM screens follow: SUMMARY FIRST → TAP TO EXPAND → DETAILS/ACTIONS SECOND.
 * Desktop/tablet keep their existing dense layouts, so every consumer gates this
 * behaviour behind `useIsMobile()` (or a `md:` utility) rather than branching on
 * business logic.
 */

/** Matches Tailwind's `md` breakpoint: mobile is anything below 768px. */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

export function useIsMobile(query: string = MOBILE_MEDIA_QUERY): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    // Re-read the query rather than trusting the event, so both listeners agree.
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    // Fallback: some WebViews (and emulated viewport resizes) do not deliver the
    // matchMedia change event, which would strand the app in the wrong shell after
    // a rotation. `resize` always fires, and sync() is idempotent.
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      mql.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [query]);

  return isMobile;
}

/**
 * Single-open accordion helper. Returns the currently open id plus a toggler.
 * `null` means every section is collapsed.
 */
export function useSingleOpen<T extends string>(initial: T | null = null) {
  const [openId, setOpenId] = useState<T | null>(initial);
  const toggle = (id: T) => setOpenId((current) => (current === id ? null : id));
  return { openId, setOpenId, toggle };
}

type DisclosureSectionProps = {
  /** Declared to satisfy the repo's strict JSX prop checking when used in lists. */
  key?: React.Key;
  title: string;
  subtitle?: string;
  count?: number;
  icon?: LucideIcon;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Wrapper classes for the whole section. */
  className?: string;
  /** Extra classes for the tappable header. */
  headerClassName?: string;
  /** Extra classes for the expanded panel. */
  panelClassName?: string;
};

/**
 * Accessible collapsible section: a real <button> header (so keyboard and screen
 * readers work for free), `aria-expanded` + `aria-controls`, a rotating chevron
 * so open state is never conveyed by colour alone, and a >=48px touch target.
 */
export function DisclosureSection({
  title,
  subtitle,
  count,
  icon: Icon,
  open,
  onToggle,
  children,
  className = "",
  headerClassName = "",
  panelClassName = "",
}: DisclosureSectionProps) {
  const panelId = useId();

  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${headerClassName}`}
      >
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-amber-400">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-100">{title}</span>
          {subtitle && <span className="block truncate text-[10px] text-slate-500">{subtitle}</span>}
        </span>
        {typeof count === "number" && (
          <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
            {count}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className={open ? `border-t border-slate-800 p-3 ${panelClassName}` : undefined}>
        {open ? children : null}
      </div>
    </section>
  );
}

type MobileActionSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

/**
 * Secondary-action panel for narrow screens. Built on AppModal so it inherits
 * scroll-lock, Escape handling and the z-[9999] layer that already sits above
 * the floating AI assistant (z-[60]).
 */
export function MobileActionSheet({ open, onClose, title, children }: MobileActionSheetProps) {
  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-md">
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs font-bold text-slate-300 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="space-y-2">{children}</div>
      </div>
    </AppModal>
  );
}
