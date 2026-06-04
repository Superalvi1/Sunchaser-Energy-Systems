import React from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { portal } from "../lib/clientPortalUi";

type PortalScreenProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
};

export default function PortalScreen({
  title,
  subtitle,
  onBack,
  loading,
  error,
  onRetry,
  children,
}: PortalScreenProps) {
  return (
    <div className="space-y-6 pb-4">
      {(onBack || title) && (
        <div className="flex items-start gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.08]"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5 text-slate-300" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className={portal.title}>{title}</h2>
            {subtitle && <p className={portal.subtitle + " mt-1"}>{subtitle}</p>}
          </div>
        </div>
      )}

      {loading && (
        <div className="py-20 text-center">
          <Loader2 className="h-9 w-9 text-amber-400 animate-spin mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        </div>
      )}

      {!loading && error && (
        <div className={`${portal.card} ${portal.cardPad} text-center`}>
          <p className="text-sm text-red-400">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={portal.btnGhost + " mt-3"}>
              Try again
            </button>
          )}
        </div>
      )}

      {!loading && !error && children}
    </div>
  );
}
